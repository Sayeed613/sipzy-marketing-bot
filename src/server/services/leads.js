import { getDb } from '../db/index.js';
import { randomUUID } from 'node:crypto';
import { normalizeEmail, normalizePhone, phoneMatchVariants } from './suppressions.js';

/**
 * SIPZY Marketing Bot - Leads Service
 *
 * CRUD for business leads, backed by SQLite.
 * All queries are parameterized - no string concatenation of user input.
 */

const db = getDb();

/**
 * Helper: build a valid lead object + audit timestamp from the raw input.
 * Calls validateLead() and throws a descriptive error on invalid fields.
 */
function toLead(input, createdAt = new Date().toISOString()) {
  const { errors, data } = validateLead(input);
  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join('; '));
  }
  return {
    id: data.id || crypto.randomUUID(),
    business_name: data.business_name,
    // Optional columns are NOT NULL in SQLite, so omitted fields default
    // to '' instead of reaching the insert as undefined.
    business_cat: data.business_cat || '',
    contact_person: data.contact_person || '',
    email: data.email || '',
    phone: data.phone || '',
    city: data.city || '',
    address: data.address || '',
    website: data.website || '',
    lead_source: data.lead_source || '',
    permission_notes: data.permission_notes || '',
    outreach_status: data.outreach_status || 'new',
    lead_qualification: data.lead_qualification || 'not_reviewed',
    verification_status: data.verification_status || 'unverified',
    website_verified: data.website_verified ? 1 : 0,
    phone_verified: data.phone_verified ? 1 : 0,
    address_verified: data.address_verified ? 1 : 0,
    business_active: data.business_active === null || data.business_active === undefined
      ? null
      : data.business_active ? 1 : 0,
    verification_source: data.verification_source || '',
    verification_notes: data.verification_notes || '',
    last_verified_at: data.last_verified_at || null,
    verified_by: data.verified_by || '',
    place_id: data.place_id || '',
    approved_for_outreach: data.approved_for_outreach ? 1 : 0,
    approved_by: data.approved_by || '',
    approved_at: data.approved_at || (data.approved_for_outreach ? createdAt : null),
    whatsapp_opt_in: data.whatsapp_opt_in ? 1 : 0,
    whatsapp_permission_source: data.whatsapp_permission_source || '',
    whatsapp_opt_in_at: data.whatsapp_opt_in_at || null,
    created_at: data.created_at || createdAt,
  };
}

/**
 * Insert or update a lead. If the `id` already exists, INSERT OR IGNORE
 * keeps the existing row - no duplicates.
 * @param {Object} input - raw request body
 * @returns {Object} the inserted/updated lead row
 */
function upsertLead(input) {
  const lead = toLead(input);
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO leads
      (id, business_name, business_cat, contact_person, email, phone, city,
       address, website, lead_source, permission_notes, outreach_status,
       lead_qualification, verification_status, website_verified, phone_verified,
       address_verified, business_active, verification_source, verification_notes,
       last_verified_at, verified_by, place_id, approved_for_outreach,
       approved_by, approved_at, whatsapp_opt_in, whatsapp_permission_source,
       whatsapp_opt_in_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    lead.id,
    lead.business_name,
    lead.business_cat,
    lead.contact_person,
    lead.email,
    lead.phone,
    lead.city,
    lead.address,
    lead.website,
    lead.lead_source,
    lead.permission_notes,
    lead.outreach_status,
    lead.lead_qualification,
    lead.verification_status,
    lead.website_verified,
    lead.phone_verified,
    lead.address_verified,
    lead.business_active,
    lead.verification_source,
    lead.verification_notes,
    lead.last_verified_at,
    lead.verified_by,
    lead.place_id,
    lead.approved_for_outreach,
    lead.approved_by,
    lead.approved_at,
    lead.whatsapp_opt_in,
    lead.whatsapp_permission_source,
    lead.whatsapp_opt_in_at,
    lead.created_at,
  );

  return readLead(lead.id);
}

/**
 * Insert a lead. Throws if the id already exists.
 * @param {Object} input
 * @returns {Object} the inserted lead row
 */
function createLead(input) {
  const lead = toLead(input);
  const info = db.prepare(`
    INSERT INTO leads
      (id, business_name, business_cat, contact_person, email, phone, city,
       address, website, lead_source, permission_notes, outreach_status,
       lead_qualification, verification_status, website_verified, phone_verified,
       address_verified, business_active, verification_source, verification_notes,
       last_verified_at, verified_by, place_id, approved_for_outreach,
       approved_by, approved_at, whatsapp_opt_in, whatsapp_permission_source,
       whatsapp_opt_in_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    lead.id,
    lead.business_name,
    lead.business_cat,
    lead.contact_person,
    lead.email,
    lead.phone,
    lead.city,
    lead.address,
    lead.website,
    lead.lead_source,
    lead.permission_notes,
    lead.outreach_status,
    lead.lead_qualification,
    lead.verification_status,
    lead.website_verified,
    lead.phone_verified,
    lead.address_verified,
    lead.business_active,
    lead.verification_source,
    lead.verification_notes,
    lead.last_verified_at,
    lead.verified_by,
    lead.place_id,
    lead.approved_for_outreach,
    lead.approved_by,
    lead.approved_at,
    lead.whatsapp_opt_in,
    lead.whatsapp_permission_source,
    lead.whatsapp_opt_in_at,
    lead.created_at,
  );
  if (info.changes === 0) {
    throw new Error(`Lead with id "${lead.id}" already exists`);
  }
  return readLead(lead.id);
}

/**
 * Validate a lead object. Returns { errors: [], data: {...} }.
 * On success, `data` is cleaned and ready for DB insertion.
 */
function validateLead(input) {
  const errors = [];
  const data = {};

  // business_name (required)
  if (input === undefined || input === null) {
    errors.push({ field: 'business_name', message: 'Business name is required' });
  } else if (String(input.business_name).trim() === '') {
    errors.push({ field: 'business_name', message: 'Business name is required' });
  } else {
    data.business_name = String(input.business_name).trim();
  }

  // business_cat
  if (input !== undefined && input !== null && input.business_cat !== undefined && input.business_cat !== null) {
    data.business_cat = String(input.business_cat).trim();
  }

  // contact_person
  if (input !== undefined && input !== null && input.contact_person !== undefined && input.contact_person !== null) {
    data.contact_person = String(input.contact_person).trim();
  }

  // email - must look like an email
  if (input !== undefined && input !== null && input.email !== undefined && input.email !== null) {
    const email = String(input.email).trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push({ field: 'email', message: 'Email must be a valid email address' });
    }
    data.email = email;
  }

  // phone
  if (input !== undefined && input !== null && input.phone !== undefined && input.phone !== null) {
    data.phone = String(input.phone).trim();
  }

  // city
  if (input !== undefined && input !== null && input.city !== undefined && input.city !== null) {
    data.city = String(input.city).trim();
  }

  // address
  if (input !== undefined && input !== null && input.address !== undefined && input.address !== null) {
    data.address = String(input.address).trim();
  }

  // website
  if (input !== undefined && input !== null && input.website !== undefined && input.website !== null) {
    data.website = String(input.website).trim();
  }

  // lead_source
  if (input !== undefined && input !== null && input.lead_source !== undefined && input.lead_source !== null) {
    data.lead_source = String(input.lead_source).trim();
  }

  // permission_notes
  if (input !== undefined && input !== null && input.permission_notes !== undefined && input.permission_notes !== null) {
    data.permission_notes = String(input.permission_notes).trim();
  }

  // outreach_status
  const validStatuses = ['new', 'contacted', 'quoted', 'won', 'lost'];
  if (input !== undefined && input !== null && input.outreach_status !== undefined && input.outreach_status !== null) {
    const status = String(input.outreach_status).trim();
    if (!validStatuses.includes(status)) {
      errors.push({ field: 'outreach_status', message: `outreach_status must be one of: ${validStatuses.join(', ')}` });
    }
    data.outreach_status = status;
  }

  // lead_qualification (internal assessment, not customer intent)
  const validQualifications = ['high', 'medium', 'low', 'not_reviewed'];
  if (input !== undefined && input !== null && input.lead_qualification !== undefined && input.lead_qualification !== null) {
    const qualification = String(input.lead_qualification).trim();
    if (!validQualifications.includes(qualification)) {
      errors.push({
        field: 'lead_qualification',
        message: `lead_qualification must be one of: ${validQualifications.join(', ')}`,
      });
    }
    data.lead_qualification = qualification;
  }

  // verification_status
  const validVerificationStatuses = ['unverified', 'pending_review', 'verified', 'rejected'];
  if (input !== undefined && input !== null && input.verification_status !== undefined && input.verification_status !== null) {
    const status = String(input.verification_status).trim();
    if (!validVerificationStatuses.includes(status)) {
      errors.push({
        field: 'verification_status',
        message: `verification_status must be one of: ${validVerificationStatuses.join(', ')}`,
      });
    }
    data.verification_status = status;
  }

  // boolean verification flags
  const parseBooleanFlag = (field, value) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === true || value === 1 || value === '1' || value === 'true' || value === 'yes' || value === 'on') return 1;
    if (value === false || value === 0 || value === '0' || value === 'false' || value === 'no' || value === 'off') return 0;
    errors.push({ field, message: `${field} must be true or false` });
    return undefined;
  };
  for (const field of ['website_verified', 'phone_verified', 'address_verified']) {
    if (input !== undefined && input !== null && input[field] !== undefined && input[field] !== null && input[field] !== '') {
      const parsed = parseBooleanFlag(field, input[field]);
      if (parsed !== undefined) data[field] = parsed;
    }
  }

  // business_active: boolean or unknown
  if (input !== undefined && input !== null && input.business_active !== undefined && input.business_active !== null && input.business_active !== '') {
    const value = input.business_active;
    if (value === 'unknown' || value === 'null') {
      data.business_active = null;
    } else if (value === true || value === 1 || value === '1' || value === 'true' || value === 'yes' || value === 'on') {
      data.business_active = 1;
    } else if (value === false || value === 0 || value === '0' || value === 'false' || value === 'no' || value === 'off') {
      data.business_active = 0;
    } else {
      errors.push({ field: 'business_active', message: 'business_active must be true, false, or unknown' });
    }
  }

  for (const field of ['verification_source', 'verification_notes', 'verified_by']) {
    if (input !== undefined && input !== null && input[field] !== undefined && input[field] !== null) {
      data[field] = String(input[field]).trim();
    }
  }

  if (input !== undefined && input !== null && input.last_verified_at !== undefined && input.last_verified_at !== null && input.last_verified_at !== '') {
    data.last_verified_at = String(input.last_verified_at).trim();
  }

  // place_id (Google Places identifier; other Google fields remain review-only)
  if (input !== undefined && input !== null && input.place_id !== undefined && input.place_id !== null) {
    data.place_id = String(input.place_id).trim();
  }

  // approval for outreach
  if (input !== undefined && input !== null && input.approved_for_outreach !== undefined && input.approved_for_outreach !== null && input.approved_for_outreach !== '') {
    const value = input.approved_for_outreach;
    if (value === true || value === 1 || value === '1' || value === 'true' || value === 'yes' || value === 'on') {
      data.approved_for_outreach = 1;
    } else if (value === false || value === 0 || value === '0' || value === 'false' || value === 'no' || value === 'off') {
      data.approved_for_outreach = 0;
    } else {
      errors.push({ field: 'approved_for_outreach', message: 'approved_for_outreach must be true or false' });
    }
  }

  if (input !== undefined && input !== null && input.approved_by !== undefined && input.approved_by !== null) {
    data.approved_by = String(input.approved_by).trim();
  }

  if (input !== undefined && input !== null && input.approved_at !== undefined && input.approved_at !== null && input.approved_at !== '') {
    data.approved_at = String(input.approved_at).trim();
  }

  // WhatsApp opt-in / permission basis. Accept common aliases for compatibility.
  const optInAliases = ['whatsapp_opt_in', 'whatsapp_permission', 'whatsapp_consent', 'opt_in', 'consent'];
  for (const alias of optInAliases) {
    if (input !== undefined && input !== null && input[alias] !== undefined && input[alias] !== null && input[alias] !== '') {
      const value = input[alias];
      if (value === true || value === 1 || value === '1' || value === 'true' || value === 'yes' || value === 'on') {
        data.whatsapp_opt_in = 1;
      } else if (value === false || value === 0 || value === '0' || value === 'false' || value === 'no' || value === 'off') {
        data.whatsapp_opt_in = 0;
      }
    }
  }
  for (const field of ['whatsapp_permission_source', 'permission_basis']) {
    if (input !== undefined && input !== null && input[field] !== undefined && input[field] !== null) {
      data.whatsapp_permission_source = String(input[field]).trim();
    }
  }
  if (input !== undefined && input !== null && input.whatsapp_opt_in_at !== undefined && input.whatsapp_opt_in_at !== null && input.whatsapp_opt_in_at !== '') {
    data.whatsapp_opt_in_at = String(input.whatsapp_opt_in_at).trim();
  }

  // created_at (optional)
  if (input !== undefined && input !== null && input.created_at !== undefined && input.created_at !== null) {
    data.created_at = String(input.created_at);
  }

  return { errors, data };
}

/**
 * Read a single lead by id.
 * @param {string} id
 * @returns {Object|null}
 */
function readLead(id) {
  const stmt = db.prepare('SELECT * FROM leads WHERE id = ?');
  const row = stmt.get(id) || null;
  return row ? withQuality(row) : null;
}

/**
 * List all leads. Optionally filter by outreach_status.
 * @param {string} [status]
 * @returns {Array}
 */
function listLeads(filters = {}) {
  if (typeof filters === 'string') filters = { status: filters };
  const {
    status,
    city,
    category,
    qualification,
    search,
    verification_status,
    quality,
  } = filters;

  const conditions = [];
  const params = [];
  if (status) {
    conditions.push('outreach_status = ?');
    params.push(status);
  }
  if (city) {
    conditions.push('city = ?');
    params.push(city);
  }
  if (category) {
    conditions.push('business_cat = ?');
    params.push(category);
  }
  if (qualification) {
    conditions.push('lead_qualification = ?');
    params.push(qualification);
  }
  if (verification_status) {
    conditions.push('verification_status = ?');
    params.push(verification_status);
  }
  if (search) {
    conditions.push('LOWER(business_name) LIKE ?');
    params.push(`%${String(search).trim().toLowerCase()}%`);
  }

  let sql = 'SELECT * FROM leads';
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY created_at DESC';

  const rows = db.prepare(sql).all(...params).map((row) => withQuality(row));
  if (quality) {
    const wanted = String(quality).trim().toLowerCase();
    return rows.filter((row) => String(row.quality_label || '').toLowerCase() === wanted);
  }
  return rows;
}

/**
 * Update a lead (partial). The merged result is re-validated so an edit
 * can never store an invalid business name or email address.
 * @param {string} id
 * @param {Object} patch
 * @returns {Object|null} the updated lead row, or null if it does not exist
 */
function updateLead(id, patch) {
  const existing = readLead(id);
  if (!existing) return null;
  if (patch === undefined || patch === null || typeof patch !== 'object') {
    throw new Error('Request body is required');
  }

  const workingPatch = { ...patch };
  if (
    workingPatch.verification_status !== undefined &&
    workingPatch.last_verified_at === undefined
  ) {
    workingPatch.last_verified_at = new Date().toISOString();
  }
  if (
    (workingPatch.approved_for_outreach === true ||
      workingPatch.approved_for_outreach === 1 ||
      workingPatch.approved_for_outreach === 'true' ||
      workingPatch.approved_for_outreach === '1') &&
    workingPatch.approved_at === undefined
  ) {
    workingPatch.approved_at = new Date().toISOString();
  }
  const merged = { ...existing, ...workingPatch };
  const { errors, data } = validateLead(merged);
  if (errors.length) {
    throw new Error(errors.map((e) => `${e.field}: ${e.message}`).join('; '));
  }

  const editable = [
    'business_name',
    'business_cat',
    'contact_person',
    'email',
    'phone',
    'city',
    'address',
    'website',
    'lead_source',
    'permission_notes',
    'outreach_status',
    'lead_qualification',
    'verification_status',
    'website_verified',
    'phone_verified',
    'address_verified',
    'business_active',
    'verification_source',
    'verification_notes',
    'last_verified_at',
    'verified_by',
    'place_id',
    'approved_for_outreach',
    'approved_by',
    'approved_at',
    'whatsapp_opt_in',
    'whatsapp_permission_source',
    'whatsapp_opt_in_at',
  ];

  const fields = [];
  const params = [];
  for (const key of editable) {
    if (workingPatch[key] !== undefined || (key === 'last_verified_at' && workingPatch.verification_status !== undefined)) {
      fields.push(`${key} = ?`);
      params.push(data[key] ?? '');
    }
  }
  if (!fields.length) return existing;

  params.push(id);
  db.prepare(`UPDATE leads SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return readLead(id);
}

/**
 * Delete a lead by id.
 * @param {string} id
 * @returns {boolean} true if a row was deleted
 */
function deleteLead(id) {
  const stmt = db.prepare('DELETE FROM leads WHERE id = ?');
  return stmt.run(id).changes > 0;
}

const LEAD_CSV_COLUMNS = [
  'id',
  'business_name',
  'business_cat',
  'lead_qualification',
  'verification_status',
  'website_verified',
  'phone_verified',
  'address_verified',
  'business_active',
  'verification_source',
  'verification_notes',
  'last_verified_at',
  'verified_by',
  'contact_person',
  'email',
  'phone',
  'city',
  'address',
  'website',
  'lead_source',
  'permission_notes',
  'outreach_status',
  'created_at',
];

const CSV_ALIASES = {
  business_name: ['business_name', 'business', 'name', 'company'],
  business_cat: ['business_cat', 'category', 'business_category', 'cat'],
  lead_qualification: ['lead_qualification', 'qualification', 'potential'],
  verification_status: ['verification_status', 'verification'],
  website_verified: ['website_verified'],
  phone_verified: ['phone_verified'],
  address_verified: ['address_verified'],
  business_active: ['business_active', 'active'],
  verification_source: ['verification_source', 'source_checked'],
  verification_notes: ['verification_notes', 'verification_note'],
  last_verified_at: ['last_verified_at', 'verified_at'],
  verified_by: ['verified_by', 'reviewed_by'],
  contact_person: ['contact_person', 'contact', 'contact_name'],
  email: ['email', 'e-mail'],
  phone: ['phone', 'mobile', 'telephone', 'tel'],
  city: ['city', 'town'],
  address: ['address', 'location'],
  website: ['website', 'url', 'site'],
  lead_source: ['lead_source', 'source'],
  permission_notes: ['permission_notes', 'notes', 'consent'],
  outreach_status: ['outreach_status', 'status'],
};

/**
 * Minimal RFC-4180-ish CSV parser. Handles quoted fields, embedded commas,
 * escaped quotes and CRLF/LF line endings without pulling in a dependency.
 * @param {string} text
 * @returns {string[][]}
 */
function parseCsv(text) {
  const input = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop a single trailing empty line produced by a final newline.
  if (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === '') rows.pop();
  }
  return rows;
}

function csvHeaderIndex(header, aliases) {
  const normalized = header.map((value) => String(value || '').trim().toLowerCase());
  for (const alias of aliases) {
    const index = normalized.indexOf(alias);
    if (index >= 0) return index;
  }
  return -1;
}

/**
 * Import leads from a CSV string. Unknown columns are ignored; missing
 * required fields (business name) are reported per row rather than aborting
 * the whole import.
 * @param {string} csvText
 * @returns {{ total: number, imported: number, skipped: number, errors: Array<{row:number,message:string}>, created: string[] }}
 */
function importLeadsFromCsv(csvText) {
  const rows = parseCsv(csvText);
  const result = { total: 0, imported: 0, skipped: 0, errors: [], created: [] };

  if (rows.length === 0) return result;

  const header = rows[0];
  const columnFor = {};
  for (const [field, aliases] of Object.entries(CSV_ALIASES)) {
    columnFor[field] = csvHeaderIndex(header, aliases);
  }

  if (columnFor.business_name < 0) {
    throw new Error('CSV must include a business_name (or business/company) column');
  }

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (row.every((value) => String(value || '').trim() === '')) {
      result.skipped += 1;
      continue;
    }
    result.total += 1;

    const get = (field) => {
      const index = columnFor[field];
      return index >= 0 ? row[index] : undefined;
    };

    const input = {
      business_name: get('business_name'),
      business_cat: get('business_cat'),
      lead_qualification: get('lead_qualification'),
      verification_status: get('verification_status'),
      website_verified: get('website_verified'),
      phone_verified: get('phone_verified'),
      address_verified: get('address_verified'),
      business_active: get('business_active'),
      verification_source: get('verification_source'),
      verification_notes: get('verification_notes'),
      last_verified_at: get('last_verified_at'),
      verified_by: get('verified_by'),
      contact_person: get('contact_person'),
      email: get('email'),
      phone: get('phone'),
      city: get('city'),
      address: get('address'),
      website: get('website'),
      lead_source: get('lead_source'),
      permission_notes: get('permission_notes'),
      outreach_status: get('outreach_status'),
    };

    try {
      const lead = createLead(input);
      result.imported += 1;
      result.created.push(lead.id);
    } catch (err) {
      result.skipped += 1;
      result.errors.push({ row: rowIndex + 1, message: err.message });
    }
  }

  return result;
}

/**
 * Escape a value for CSV output.
 * @param {unknown} value
 * @returns {string}
 */
function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Convert a list of leads to a CSV string.
 * @param {Array} leads
 * @returns {string}
 */
function leadsToCsv(leads) {
  const lines = [LEAD_CSV_COLUMNS.join(',')];
  for (const lead of leads || []) {
    lines.push(LEAD_CSV_COLUMNS.map((column) => csvEscape(lead[column])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Find groups of leads that look like duplicates: same normalised business
 * name + city, same normalised phone, or same normalised email.
 * @returns {Array<{ key: string, reason: string, leads: Array }>}
 */
function findDuplicateLeadGroups() {
  const leads = db.prepare('SELECT * FROM leads ORDER BY created_at ASC').all();
  const buckets = new Map();

  const addBucket = (key, reason, lead) => {
    if (!key) return;
    if (!buckets.has(key)) buckets.set(key, { key, reason, leads: [] });
    buckets.get(key).leads.push(lead);
  };

  for (const lead of leads) {
    const nameCity = `${String(lead.business_name || '').trim().toLowerCase().replace(/\s+/g, ' ')}|${String(lead.city || '').trim().toLowerCase()}`;
    if (String(lead.business_name || '').trim()) addBucket(`namecity:${nameCity}`, 'same business name and city', lead);

    const placeId = String(lead.place_id || '').trim();
    if (placeId) addBucket(`place:${placeId}`, 'same Google Place ID', lead);

    const phone = normalizePhone(lead.phone);
    if (phone) addBucket(`phone:${phone}`, 'same phone number', lead);

    const email = normalizeEmail(lead.email);
    if (email) addBucket(`email:${email}`, 'same email address', lead);
  }

  return Array.from(buckets.values()).filter((group) => group.leads.length > 1);
}

/**
 * Whether a lead is on the permanent do-not-contact registry or has an
 * opted-out enquiry. Mirrors outreach checks without importing outreach.js
 * (which imports this module).
 * @param {Object} lead
 * @returns {boolean}
 */
function isLeadSuppressed(lead) {
  if (!lead) return false;
  const suppressions = db.prepare('SELECT * FROM contact_suppressions').all();
  const phone = normalizePhone(lead.phone);
  const email = normalizeEmail(lead.email);
  for (const row of suppressions) {
    if (phone && phoneMatchVariants(row.phone).includes(phone)) return true;
    if (email && normalizeEmail(row.email) === email) return true;
  }
  if (lead.id) {
    const optedOut = db
      .prepare("SELECT 1 FROM enquiries WHERE lead_id = ? AND enquiry_status = 'opted-out' LIMIT 1")
      .get(lead.id);
    if (optedOut) return true;
  }
  return false;
}

/**
 * Whether a lead id appears in any duplicate group.
 * @param {string} id
 * @returns {boolean}
 */
function isDuplicateLead(id) {
  if (!id) return false;
  return findDuplicateLeadIds().has(id);
}

/**
 * Internal quality assessment for a lead. This is an assessment of data
 * completeness and verification status only; it is NOT customer interest
 * or buying intent.
 * @param {Object} lead
 * @param {{ suppressed?: boolean, duplicate?: boolean }} [context]
 * @returns {{ score: number, label: 'High'|'Medium'|'Low', reasons: string[], suppressed: boolean, duplicate: boolean, outreach_ready: boolean }}
 */
function scoreLeadQuality(lead, context = {}) {
  const item = lead || {};
  const suppressed = context.suppressed ?? isLeadSuppressed(item);
  const duplicate = context.duplicate ?? isDuplicateLead(item.id);
  const verificationStatus = item.verification_status || 'unverified';
  const businessActive = item.business_active;

  let score = 0;
  const reasons = [];
  const add = (points, ok, reason) => {
    if (ok) score += points;
    else reasons.push(reason);
  };

  add(10, String(item.business_name || '').trim() !== '', 'Missing business name');
  add(10, String(item.business_cat || '').trim() !== '', 'Missing business category');

  const email = String(item.email || '').trim();
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (email && emailValid) score += 10;
  else if (email) reasons.push('Invalid email address');
  else reasons.push('Missing email address');

  const phone = normalizePhone(item.phone);
  add(10, Boolean(phone), 'Missing or invalid phone number');
  add(5, String(item.contact_person || '').trim() !== '', 'Missing contact person');

  const hasWebOrListing = Boolean(String(item.website || '').trim() || String(item.verification_source || '').trim());
  add(10, hasWebOrListing, 'Missing website or credible business listing evidence');
  add(10, String(item.address || '').trim() !== '', 'Missing address');
  add(5, String(item.city || '').trim() !== '', 'Missing city');

  if (verificationStatus === 'verified') score += 10;
  else if (verificationStatus === 'pending_review') {
    score += 2;
    reasons.push('Verification pending review');
  } else if (verificationStatus === 'rejected') {
    reasons.push('Verification rejected');
  } else {
    reasons.push('Lead not verified');
  }

  const websiteVerified = item.website_verified === true || item.website_verified === 1 || item.website_verified === '1';
  const phoneVerified = item.phone_verified === true || item.phone_verified === 1 || item.phone_verified === '1';
  const addressVerified = item.address_verified === true || item.address_verified === 1 || item.address_verified === '1';
  add(5, websiteVerified, 'Website not verified');
  add(5, phoneVerified, 'Phone not verified');
  add(5, addressVerified, 'Address not verified');

  if (businessActive === true || businessActive === 1 || businessActive === '1') score += 5;
  else if (businessActive === false || businessActive === 0 || businessActive === '0') reasons.push('Business marked inactive');
  else reasons.push('Business activity not confirmed');

  if (suppressed) {
    score = 0;
    reasons.unshift('Suppressed contact: excluded from outreach');
  }
  if (duplicate) {
    score = Math.max(0, score - 15);
    reasons.push('Duplicate lead');
  }
  if (verificationStatus === 'rejected') {
    score = Math.max(0, score - 10);
  }

  const label = score >= 70 ? 'High' : score >= 40 ? 'Medium' : 'Low';
  return {
    score,
    label,
    reasons,
    suppressed,
    duplicate,
    outreach_ready: !suppressed && verificationStatus === 'verified',
  };
}

function withQuality(lead) {
  if (!lead) return lead;
  const quality = scoreLeadQuality(lead);
  return {
    ...lead,
    quality_score: quality.score,
    quality_label: quality.label,
    quality_reasons: quality.reasons,
    quality_outreach_ready: quality.outreach_ready,
  };
}

const calculateLeadQuality = scoreLeadQuality;
const leadQuality = scoreLeadQuality;
const assessLeadQuality = scoreLeadQuality;
const getLeadQuality = scoreLeadQuality;

/**
 * Set of lead ids that participate in any duplicate group.
 * @returns {Set<string>}
 */
function findDuplicateLeadIds() {
  const ids = new Set();
  for (const group of findDuplicateLeadGroups()) {
    for (const lead of group.leads) ids.add(lead.id);
  }
  return ids;
}

export {
  upsertLead,
  createLead,
  readLead,
  listLeads,
  updateLead,
  deleteLead,
  validateLead,
  parseCsv,
  importLeadsFromCsv,
  leadsToCsv,
  findDuplicateLeadGroups,
  findDuplicateLeadIds,
  scoreLeadQuality,
  calculateLeadQuality,
  leadQuality,
  assessLeadQuality,
  getLeadQuality,
  withQuality,
};
