import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';

/**
 * SIPZY Marketing Bot - Contact Suppression Service
 *
 * Permanent do-not-contact registry. A contact enters this table when an
 * enquiry is classified as opted-out and can never be removed through the
 * dashboard. Every future outreach path is expected to ask
 * `checkOutreachAllowed()` / `findSuppressionForContact()` first.
 *
 * Matching is deliberately conservative:
 *  - Phone numbers are reduced to digits. Indian mobiles are canonicalised
 *    to `91XXXXXXXXXX`, so `9876543210`, `+91 9876543210`, `91-9876543210`,
 *    `09876543210` and `0091 9876543210` all match. A bare 10-digit number
 *    starting 6-9 is treated as Indian (the national format has no country
 *    code); numbers with any other explicit country code keep it, so a
 *    `+1 555...` number is never rewritten as Indian.
 *  - Emails are trimmed and lower-cased.
 *  - The same phone or email is never stored twice: repeat opt-outs enrich
 *    the existing row instead of creating a new one.
 *  - Anonymous opt-outs (no phone/email anywhere) are still recorded, keyed
 *    by their enquiry, so the event is not lost; they simply cannot match a
 *    lead until contact details are supplied.
 */

const OPT_OUT_REASON = 'opted_out';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_IN_TEXT = /\+?\d[\d\s().-]{5,}\d/g;
const INDIAN_COUNTRY_CODE = '91';
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/**
 * Reduce a phone number to a stable identifier.
 *
 * Indian mobiles always become 12 digits with the country code: `+91`,
 * `91`, `0091`, a leading national `0`, and a bare 10-digit number are all
 * the same contact. Numbers with another country code (or an Indian
 * landline) keep their digits unchanged, so international numbers are not
 * silently converted to Indian ones.
 *
 * @param {*} value
 * @returns {string} canonical digits, or '' when unusable
 */
function normalizePhone(value) {
  if (value === null || value === undefined) return '';
  let digits = String(value).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!digits) return '';

  // +91 / 91 / 0091 followed by a valid Indian mobile.
  if (
    digits.length === 12 &&
    digits.startsWith(INDIAN_COUNTRY_CODE) &&
    INDIAN_MOBILE.test(digits.slice(2))
  ) {
    return digits;
  }

  // National trunk prefix: 0 followed by a valid Indian mobile.
  if (digits.length === 11 && digits.startsWith('0') && INDIAN_MOBILE.test(digits.slice(1))) {
    return `${INDIAN_COUNTRY_CODE}${digits.slice(1)}`;
  }

  // Bare Indian mobile (national format, no country code). A 10-digit
  // number starting 6-9 has no other reliable reading; explicit foreign
  // country codes above have already been ruled out.
  if (digits.length === 10 && INDIAN_MOBILE.test(digits)) {
    return `${INDIAN_COUNTRY_CODE}${digits}`;
  }

  if (digits.length < 7 || digits.length > 15) return '';
  return digits;
}

/**
 * All stored-phone spellings that should match a value. Used so records
 * written before Indian canonicalisation (e.g. `9876543210`) still block
 * the canonical form and vice versa, even if migration could not rewrite
 * them because of a duplicate.
 * @param {*} value
 * @returns {string[]}
 */
function phoneMatchVariants(value) {
  const canonical = normalizePhone(value);
  if (!canonical) return [];

  const variants = new Set([canonical]);
  if (canonical.length === 12 && canonical.startsWith(INDIAN_COUNTRY_CODE)) {
    const national = canonical.slice(2);
    if (INDIAN_MOBILE.test(national)) {
      variants.add(national);
      variants.add(`0${national}`);
    }
  }
  return [...variants];
}

/**
 * SQL fragment matching every stored spelling of a phone number.
 * @param {*} value
 * @returns {{ sql: string, params: string[] }|null}
 */
function phoneCondition(value) {
  const variants = phoneMatchVariants(value);
  if (!variants.length) return null;
  return {
    sql: `phone IN (${variants.map(() => '?').join(', ')})`,
    params: variants,
  };
}

/**
 * Normalize an email address. Returns '' when it is not a valid address.
 * @param {*} value
 * @returns {string}
 */
function normalizeEmail(value) {
  if (value === null || value === undefined) return '';
  const email = String(value).trim().toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : '';
}

/**
 * Pull phone numbers and email addresses out of a free-text customer
 * message. Quantities such as "5000" are far below the 7-digit phone
 * minimum, so they are ignored.
 * @param {string} message
 * @returns {{ phones: string[], emails: string[] }}
 */
function extractContactDetails(message) {
  const text = String(message ?? '');
  const emails = [];
  for (const match of text.match(EMAIL_IN_TEXT) || []) {
    const email = normalizeEmail(match);
    if (email && !emails.includes(email)) emails.push(email);
  }

  const phones = [];
  for (const match of text.match(PHONE_IN_TEXT) || []) {
    const phone = normalizePhone(match);
    if (phone && !phones.includes(phone)) phones.push(phone);
  }

  return { phones, emails };
}

/**
 * Build the unique key for a suppression row. Phone wins over email because
 * it is the stronger identifier; anonymous opt-outs are keyed by enquiry.
 * @param {{ phone?: string, email?: string, enquiry_id?: string|null }} contact
 * @returns {string}
 */
function buildContactKey({ phone = '', email = '', enquiry_id = null } = {}) {
  if (phone) return `phone:${phone}`;
  if (email) return `email:${email}`;
  if (enquiry_id) return `enquiry:${enquiry_id}`;
  return `anon:${randomUUID()}`;
}

/**
 * Read one suppression row.
 * @param {string} id
 * @returns {Object|null}
 */
function readSuppression(id) {
  return getDb().prepare('SELECT * FROM contact_suppressions WHERE id = ?').get(id) || null;
}

/**
 * Find an existing suppression row matching the supplied contact details,
 * the enquiry that triggered the opt-out, or both. Oldest row wins so the
 * original opt-out evidence is preserved.
 * @param {{ phone?: string, email?: string, enquiry_id?: string|null }} contact
 * @returns {Object|null}
 */
function findMatchingSuppression({ phone = '', email = '', enquiry_id = null } = {}) {
  const conditions = [];
  const params = [];
  const phoneMatch = phoneCondition(phone);
  if (phoneMatch) {
    conditions.push(phoneMatch.sql);
    params.push(...phoneMatch.params);
  }
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) {
    conditions.push('email = ?');
    params.push(normalizedEmail);
  }
  if (enquiry_id) {
    conditions.push('enquiry_id = ?');
    params.push(enquiry_id);
  }
  if (!conditions.length) return null;

  return (
    getDb()
      .prepare(
        `SELECT * FROM contact_suppressions
         WHERE ${conditions.join(' OR ')}
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get(...params) || null
  );
}

/**
 * Record a permanent opt-out. Idempotent: repeat opt-outs for the same
 * phone/email enrich the existing row and return `created: false`.
 *
 * @param {Object} input
 * @param {string} [input.phone]
 * @param {string} [input.email]
 * @param {string} [input.customer_name]
 * @param {string} [input.business_name]
 * @param {string} [input.source_message] - the original customer message
 * @param {string|null} [input.enquiry_id]
 * @param {string} [input.reason]
 * @returns {{ suppression: Object, created: boolean }}
 */
function registerOptOut({
  phone = '',
  email = '',
  customer_name = '',
  business_name = '',
  source_message = '',
  enquiry_id = null,
  reason = OPT_OUT_REASON,
} = {}) {
  const db = getDb();
  const extracted = extractContactDetails(source_message);
  const normalizedPhone = normalizePhone(phone) || extracted.phones[0] || '';
  const normalizedEmail = normalizeEmail(email) || extracted.emails[0] || '';
  const name = String(customer_name ?? '').trim();
  const business = String(business_name ?? '').trim();
  const message = String(source_message ?? '').trim();
  const now = new Date().toISOString();

  const existing = findMatchingSuppression({
    phone: normalizedPhone,
    email: normalizedEmail,
    enquiry_id,
  });

  if (existing) {
    // Enrich missing details only: never overwrite the first opt-out
    // message or its date, and never move to a conflicting key.
    const mergedPhone = normalizePhone(existing.phone) || normalizedPhone;
    const mergedEmail = existing.email || normalizedEmail;
    const canUpgradeKey =
      existing.contact_key.startsWith('enquiry:') && Boolean(mergedPhone || mergedEmail);
    let nextKey = canUpgradeKey
      ? buildContactKey({ phone: mergedPhone, email: mergedEmail })
      : existing.contact_key;

    // Bring an old national-format key up to the canonical spelling, but
    // never collide with another row: duplicate evidence must be preserved.
    if (nextKey.startsWith('phone:') && mergedPhone) {
      const canonicalKey = `phone:${mergedPhone}`;
      if (canonicalKey !== nextKey) {
        const conflict = db
          .prepare('SELECT id FROM contact_suppressions WHERE contact_key = ? AND id <> ?')
          .get(canonicalKey, existing.id);
        if (!conflict) nextKey = canonicalKey;
      }
    }
    if (nextKey !== existing.contact_key) {
      const conflict = db
        .prepare('SELECT id FROM contact_suppressions WHERE contact_key = ? AND id <> ?')
        .get(nextKey, existing.id);
      if (conflict) nextKey = existing.contact_key;
    }

    db.prepare(
      `UPDATE contact_suppressions
       SET phone = ?, email = ?, customer_name = ?, business_name = ?,
           source_message = ?, contact_key = ?, reason = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      mergedPhone,
      mergedEmail,
      existing.customer_name || name,
      existing.business_name || business,
      existing.source_message || message,
      nextKey,
      existing.reason || reason,
      now,
      existing.id
    );

    return { suppression: readSuppression(existing.id), created: false };
  }

  const id = randomUUID();
  try {
    db.prepare(
      `INSERT INTO contact_suppressions
        (id, contact_key, phone, email, customer_name, business_name, reason,
         source_message, enquiry_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      buildContactKey({ phone: normalizedPhone, email: normalizedEmail, enquiry_id }),
      normalizedPhone,
      normalizedEmail,
      name,
      business,
      reason,
      message,
      enquiry_id,
      now,
      now
    );
  } catch (err) {
    // Two opt-outs can race; a unique-key collision means it already exists.
    if (String(err.message).includes('UNIQUE')) {
      const raced = findMatchingSuppression({
        phone: normalizedPhone,
        email: normalizedEmail,
        enquiry_id,
      });
      if (raced) return { suppression: raced, created: false };
    }
    throw err;
  }

  return { suppression: readSuppression(id), created: true };
}

/**
 * List suppression records, newest first, with an optional free-text search.
 * @param {{ q?: string }} [filters]
 * @returns {Array}
 */
function listSuppressions(filters = {}) {
  const db = getDb();
  const q = String(filters.q ?? '').trim();
  if (!q) {
    return db.prepare('SELECT * FROM contact_suppressions ORDER BY created_at DESC').all();
  }

  const like = `%${q}%`;
  const digits = q.replace(/\D/g, '');
  const phoneLike = digits ? `%${digits}%` : like;

  return db
    .prepare(
      `SELECT * FROM contact_suppressions
       WHERE phone LIKE ? OR email LIKE ? OR customer_name LIKE ?
          OR business_name LIKE ? OR source_message LIKE ?
       ORDER BY created_at DESC`
    )
    .all(phoneLike, like, like, like, like);
}

/**
 * Count suppression records.
 * @returns {number}
 */
function countSuppressions() {
  return getDb().prepare('SELECT COUNT(*) AS n FROM contact_suppressions').get().n;
}

/**
 * Find the suppression row blocking a contact, if any.
 * @param {{ phone?: string, email?: string }} contact
 * @returns {Object|null}
 */
function findSuppressionForContact({ phone = '', email = '' } = {}) {
  // Matching (not just storage) understands legacy spellings, so an old
  // `9876543210` row still blocks `+91 98765 43210` and vice versa.
  return findMatchingSuppression({ phone, email });
}

/**
 * The guard every future outreach path must call before sending anything.
 * Blocks on a contact suppression, or when the lead already has an
 * opted-out enquiry (covers anonymous opt-outs that carry no contact).
 *
 * @param {{ phone?: string, email?: string, lead_id?: string|null }} contact
 * @returns {{ allowed: boolean, reason: string|null, suppression: Object|null, enquiry_id?: string }}
 */
function checkOutreachAllowed({ phone = '', email = '', lead_id = null } = {}) {
  const suppression = findSuppressionForContact({ phone, email });
  if (suppression) {
    return { allowed: false, reason: 'contact_suppressed', suppression };
  }

  if (lead_id) {
    const optedOut = getDb()
      .prepare(
        `SELECT id FROM enquiries
         WHERE lead_id = ? AND enquiry_status = 'opted-out'
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(lead_id);
    if (optedOut) {
      return { allowed: false, reason: 'lead_opted_out', suppression: null, enquiry_id: optedOut.id };
    }
  }

  return { allowed: true, reason: null, suppression: null };
}

/**
 * Register suppressions for opted-out enquiries that predate this table.
 * Idempotent; runs once at startup and never modifies enquiries or leads.
 * @returns {{ scanned: number, added: number }}
 */
function backfillFromOptOuts() {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM enquiries WHERE enquiry_status = 'opted-out'")
    .all();
  let added = 0;

  for (const row of rows) {
    try {
      const result = registerOptOut({
        phone: row.phone,
        email: row.email,
        customer_name: row.customer_name,
        business_name: row.business_name,
        source_message: row.original_message,
        enquiry_id: row.id,
      });
      if (result.created) added += 1;
    } catch (err) {
      console.error(`[sipzy] could not backfill suppression for enquiry ${row.id}: ${err.message}`);
    }
  }

  return { scanned: rows.length, added };
}

/**
 * Rewrite pre-canonical Indian phone numbers in place.
 *
 * Rows are only updated when the new `phone:<canonical>` key is free. If a
 * canonical row already exists, both rows are left untouched and matching
 * falls back to phone variants, so no suppression evidence is ever lost or
 * deleted. Idempotent.
 * @returns {{ updated: number, conflicts: number }}
 */
function migrateSuppressionPhones() {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM contact_suppressions ORDER BY created_at ASC')
    .all();
  let updated = 0;
  let conflicts = 0;

  for (const row of rows) {
    if (!row.phone) continue;
    const canonical = normalizePhone(row.phone);
    if (!canonical || canonical === row.phone) continue;

    let nextKey = row.contact_key;
    if (row.contact_key.startsWith('phone:')) {
      nextKey = `phone:${canonical}`;
      const conflict = db
        .prepare('SELECT id FROM contact_suppressions WHERE contact_key = ? AND id <> ?')
        .get(nextKey, row.id);
      if (conflict) {
        conflicts += 1;
        continue;
      }
    }

    db.prepare(
      `UPDATE contact_suppressions
       SET phone = ?, contact_key = ?, updated_at = ?
       WHERE id = ?`
    ).run(canonical, nextKey, new Date().toISOString(), row.id);
    updated += 1;
  }

  return { updated, conflicts };
}

export {
  normalizePhone,
  normalizeEmail,
  extractContactDetails,
  phoneMatchVariants,
  buildContactKey,
  registerOptOut,
  readSuppression,
  listSuppressions,
  countSuppressions,
  findSuppressionForContact,
  findMatchingSuppression,
  checkOutreachAllowed,
  backfillFromOptOuts,
  migrateSuppressionPhones,
  OPT_OUT_REASON,
};
