import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * These tests run against a throwaway SQLite file, never data/sipzy.db.
 * SIPZY_DB_FILE must be set before the DB module is imported.
 */
const dbFile = path.join(os.tmpdir(), `sipzy-suppressions-${process.pid}-${Date.now()}.db`);
process.env.SIPZY_DB_FILE = dbFile;

const { initDb, closeDb, getDb } = await import('../db/index.js');
initDb();

const { analyzeMessage } = await import('../services/analyzer.js');
const {
  normalizePhone,
  normalizeEmail,
  extractContactDetails,
  phoneMatchVariants,
  registerOptOut,
  listSuppressions,
  countSuppressions,
  checkOutreachAllowed,
  findSuppressionForContact,
  backfillFromOptOuts,
  migrateSuppressionPhones,
} = await import('../services/suppressions.js');
const { createEnquiry, listEnquiries, updateEnquiry } = await import('../services/enquiries.js');
const { createLead } = await import('../services/leads.js');
const {
  listOutreachReadyLeads,
  listLeadsWithSuppression,
  checkLeadOutreach,
} = await import('../services/outreach.js');

let firstOptOutEnquiryId = null;

after(() => {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbFile + suffix);
    } catch {
      // Windows may still hold the file; the temp profile is disposable.
    }
  }
});

test('opt-out language is detected and wins over other intents', () => {
  const optOuts = [
    'Please stop messaging me.',
    'Unsubscribe me from your list',
    'STOP',
    'Do not message me again — we are not interested.',
    "don't message me",
    "Don't contact us anymore",
    'remove me from your list',
    'Take me off your mailing list',
  ];

  for (const message of optOuts) {
    assert.equal(analyzeMessage(message).intent, 'opted_out', `expected opt-out for: ${message}`);
  }

  assert.equal(analyzeMessage('We are not interested, thanks').intent, 'not_interested');
  assert.equal(analyzeMessage('Please send a quotation for 5k hot cups').intent, 'quote_requested');
});

test('Indian mobile formats normalize to one canonical number', () => {
  const formats = [
    '9876543210',
    '+91 9876543210',
    '91-9876543210',
    '+91 (98765) 43210',
    '(98765) 43210',
    '09876543210',
    '0 98765 43210',
    '0091 98765 43210',
    '0091-98765-43210',
    '+91 98765-43210',
  ];

  for (const input of formats) {
    assert.equal(normalizePhone(input), '919876543210', `expected Indian canonical for: ${input}`);
  }

  assert.deepEqual(phoneMatchVariants('+91 98765 43210'), [
    '919876543210',
    '9876543210',
    '09876543210',
  ]);
  assert.deepEqual(phoneMatchVariants('9876543210'), phoneMatchVariants('+91 98765 43210'));
});

test('non-Indian numbers keep their country code and are not treated as Indian', () => {
  assert.equal(normalizePhone('+1 (555) 010-9999'), '15550109999');
  assert.equal(normalizePhone('001 555 010 9999'), '15550109999');
  assert.equal(normalizePhone('15550109999'), '15550109999');
  assert.equal(normalizePhone('+44 20 7946 0958'), '442079460958');
  assert.equal(normalizePhone('+61 412 345 678'), '61412345678');
  // Explicit +1 must not be rewritten as an Indian mobile just because the
  // national part is 10 digits starting with 9.
  assert.equal(normalizePhone('+1 987 654 3210'), '19876543210');
  // A bare 10-digit number starting 4 has no Indian-mobile reading.
  assert.equal(normalizePhone('4155550123'), '4155550123');
  // Indian landline: country code preserved, not converted to a mobile.
  assert.equal(normalizePhone('+91 20 7946 0958'), '912079460958');

  assert.equal(normalizePhone('5000'), '');
  assert.equal(normalizePhone(''), '');
  assert.equal(normalizePhone(null), '');
  assert.equal(normalizePhone('1234567890123456'), '');
  assert.equal(normalizeEmail(' Nadia@Example.COM '), 'nadia@example.com');
  assert.equal(normalizeEmail('not-an-email'), '');
});

test('contact details are extracted from a message without grabbing quantities', () => {
  const details = extractContactDetails(
    'Please stop. Call +1 555-010-9999 or email nadia@example.com. We ordered 5000 cups.'
  );
  assert.deepEqual(details.phones, ['15550109999']);
  assert.deepEqual(details.emails, ['nadia@example.com']);
  assert.deepEqual(extractContactDetails('We need 5000 cups in 250ml').phones, []);

  const indian = extractContactDetails('Please stop. Call +91 (98765) 43210. Need 5000 cups.');
  assert.deepEqual(indian.phones, ['919876543210']);
});

test('an opted-out enquiry creates a suppression record with the original message', () => {
  const enquiry = createEnquiry({
    customer_name: 'Nadia',
    business_name: 'Harbor Cafe',
    phone: '+1 (555) 010-9999',
    email: 'Nadia@Example.com',
    enquiry_status: 'opted-out',
    original_message: 'Please stop messaging me.',
  });

  firstOptOutEnquiryId = enquiry.id;
  const records = listSuppressions();
  assert.equal(records.length, 1);
  assert.equal(records[0].phone, '15550109999');
  assert.equal(records[0].email, 'nadia@example.com');
  assert.equal(records[0].customer_name, 'Nadia');
  assert.equal(records[0].business_name, 'Harbor Cafe');
  assert.equal(records[0].reason, 'opted_out');
  assert.equal(records[0].source_message, 'Please stop messaging me.');
  assert.equal(records[0].enquiry_id, enquiry.id);
  assert.ok(records[0].created_at);
  assert.ok(records[0].updated_at);
});

test('the same contact is never added twice, in any formatting', () => {
  const first = registerOptOut({
    phone: '+1 (555) 010-9999',
    source_message: 'stop',
  });
  assert.equal(first.created, false);
  assert.equal(countSuppressions(), 1);

  const repeat = createEnquiry({
    customer_name: 'Nadia',
    phone: '1-555-010-9999',
    email: 'nadia@example.com',
    enquiry_status: 'opted-out',
    original_message: 'unsubscribe',
  });
  assert.equal(countSuppressions(), 1);
  // The original opt-out evidence wins; the repeat only enriches the record.
  assert.equal(listSuppressions()[0].enquiry_id, firstOptOutEnquiryId);
  // The repeat enquiry is still saved; suppression must not swallow data.
  assert.ok(listEnquiries().some((row) => row.id === repeat.id));

  const byEmail = registerOptOut({ email: 'NADIA@example.com', source_message: 'stop' });
  assert.equal(byEmail.created, false);
  assert.equal(countSuppressions(), 1);
});

test('repeat opt-outs in any Indian format reuse the same suppression record', () => {
  const before = countSuppressions();
  const enquiry = createEnquiry({
    customer_name: 'Priya',
    phone: '9876543210',
    enquiry_status: 'opted-out',
    original_message: 'Please stop messaging me.',
  });
  assert.equal(countSuppressions(), before + 1);

  const record = listSuppressions().find((row) => row.phone === '919876543210');
  assert.ok(record, 'suppression must store the canonical Indian number');
  assert.equal(record.enquiry_id, enquiry.id);

  for (const phone of [
    '+91 98765 43210',
    '91-9876543210',
    '0091 98765 43210',
    '(98765) 43210',
    '09876543210',
    '91 98765 43210',
  ]) {
    const result = registerOptOut({ phone, source_message: 'stop' });
    assert.equal(result.created, false, `expected ${phone} to match the existing record`);
    assert.equal(result.suppression.id, record.id);
  }

  // A different Indian number is a different contact.
  const other = registerOptOut({ phone: '9123456781', source_message: 'stop' });
  assert.equal(other.created, true);
  assert.equal(other.suppression.phone, '919123456781');
  assert.equal(countSuppressions(), before + 2);

  // Suppressions are permanent, so later tests use relative counts.
});

test('changing a live enquiry to opted-out suppresses it', () => {
  const enquiry = createEnquiry({
    customer_name: 'Owen',
    phone: '+44 7700 900123',
    enquiry_status: 'quote-requested',
    original_message: 'What is the price for 500 cups?',
  });
  const before = countSuppressions();

  updateEnquiry(enquiry.id, { enquiry_status: 'opted-out' });
  assert.equal(countSuppressions(), before + 1);

  const record = listSuppressions().find((row) => row.phone === '447700900123');
  assert.ok(record);
  assert.equal(record.enquiry_id, enquiry.id);
  assert.equal(record.source_message, 'What is the price for 500 cups?');
});

test('suppressed contacts are blocked and excluded from outreach-ready leads', () => {
  const blocked = createLead({
    business_name: 'Harbor Cafe',
    email: 'nadia@example.com',
    phone: '+1 555 010 9999',
    outreach_status: 'new',
  });
  const clean = createLead({
    business_name: 'Clean Cafe',
    email: 'clean@example.com',
    phone: '+1 222 333 4444',
    outreach_status: 'new',
  });
  // The same suppressed Indian contact written every way a lead might be
  // stored: none of these may slip into outreach-ready.
  const alternateFormats = [
    '+91 98765 43210',
    '0091-98765-43210',
    '0 98765 43210',
    '91 98765 43210',
    '(98765) 43210',
  ];
  const alternateLeads = alternateFormats.map((phone, index) =>
    createLead({
      business_name: `Format Cafe ${index}`,
      phone,
      outreach_status: 'new',
    })
  );

  const indianGuard = checkOutreachAllowed({ phone: '+91 98765 43210' });
  assert.equal(indianGuard.allowed, false);
  assert.equal(indianGuard.suppression.phone, '919876543210');

  const guard = checkOutreachAllowed({ phone: blocked.phone, email: blocked.email });
  assert.equal(guard.allowed, false);
  assert.equal(guard.reason, 'contact_suppressed');
  assert.equal(guard.suppression.phone, '15550109999');

  const check = checkLeadOutreach(blocked.id);
  assert.equal(check.allowed, false);

  const ready = listOutreachReadyLeads();
  assert.ok(!ready.some((lead) => lead.id === blocked.id), 'blocked lead must not be outreach-ready');
  assert.ok(ready.some((lead) => lead.id === clean.id), 'clean lead must remain outreach-ready');
  assert.ok(ready.every((lead) => !lead.suppressed));
  for (const lead of alternateLeads) {
    assert.ok(
      !ready.some((row) => row.id === lead.id),
      `formatted lead ${lead.phone} bypassed suppression`
    );
    assert.equal(checkLeadOutreach(lead.id).allowed, false);
  }

  const all = listLeadsWithSuppression();
  const decorated = all.find((lead) => lead.id === blocked.id);
  assert.equal(decorated.suppressed, true);
  assert.equal(decorated.suppression_reason, 'opted_out');
  for (const lead of alternateLeads) {
    assert.equal(all.find((row) => row.id === lead.id).suppressed, true);
  }

  const excluded = listLeadsWithSuppression({ excludeSuppressed: true });
  assert.ok(!excluded.some((lead) => lead.id === blocked.id));
});

test('an anonymous opt-out blocks its lead through the enquiry link', () => {
  const lead = createLead({
    business_name: 'Anonymous Roasters',
    email: 'anon@example.com',
    phone: '+1 333 222 1111',
    outreach_status: 'new',
  });
  createEnquiry({
    lead_id: lead.id,
    enquiry_status: 'opted-out',
    original_message: 'stop',
  });

  const check = checkLeadOutreach(lead.id);
  assert.equal(check.allowed, false);
  assert.equal(check.reason, 'lead_opted_out');

  assert.ok(!listOutreachReadyLeads().some((row) => row.id === lead.id));
});

test('suppression records are not deletable through the service API', async () => {
  // The dashboard exposes no delete route; guard against one creeping in.
  const module = await import('../services/suppressions.js');
  assert.equal(typeof module.deleteSuppression, 'undefined');
  assert.equal(typeof module.removeSuppression, 'undefined');
});

test('legacy opted-out enquiries are backfilled without touching enquiries or leads', () => {
  const now = new Date().toISOString();
  const legacyId = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO enquiries
        (id, lead_id, customer_name, business_name, phone, email, product_type, cup_size,
         quantity, delivery_location, enquiry_status, original_message, ai_summary,
         follow_up_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '', '', 0, '', 'opted-out', ?, NULL, '', ?, ?)`
    )
    .run(
      legacyId,
      null,
      'Legacy',
      'Old Cafe',
      '+1 444 555 6666',
      'legacy@example.com',
      'unsubscribe',
      now,
      now
    );

  const enquiriesBefore = listEnquiries().length;
  const { scanned, added } = backfillFromOptOuts();
  assert.ok(scanned >= 1);
  assert.equal(added, 1);
  assert.equal(listEnquiries().length, enquiriesBefore);
  assert.ok(listSuppressions().some((row) => row.phone === '14445556666'));

  // Re-running is idempotent and the schema init preserves everything.
  const countBefore = countSuppressions();
  assert.equal(backfillFromOptOuts().added, 0);
  initDb();
  assert.equal(countSuppressions(), countBefore);
  assert.equal(listEnquiries().length, enquiriesBefore);
  assert.equal(listLeadsWithSuppression().length >= 3, true);
});

test('legacy Indian suppression rows are migrated in place without data loss', () => {
  const id = randomUUID();
  const created = new Date(Date.now() - 60_000).toISOString();
  getDb()
    .prepare(
      `INSERT INTO contact_suppressions
        (id, contact_key, phone, email, customer_name, business_name, reason,
         source_message, enquiry_id, created_at, updated_at)
       VALUES (?, ?, ?, '', ?, ?, 'opted_out', ?, NULL, ?, ?)`
    )
    .run(
      id,
      'phone:9123456789',
      '9123456789',
      'Legacy Indian',
      'Old Delhi Cafe',
      'do not call me',
      created,
      created
    );

  const before = countSuppressions();
  const result = migrateSuppressionPhones();
  assert.ok(result.updated >= 1);
  assert.equal(countSuppressions(), before, 'migration must not create or delete rows');

  const row = listSuppressions().find((record) => record.id === id);
  assert.equal(row.phone, '919123456789');
  assert.equal(row.contact_key, 'phone:919123456789');
  assert.equal(row.customer_name, 'Legacy Indian');
  assert.equal(row.business_name, 'Old Delhi Cafe');
  assert.equal(row.source_message, 'do not call me');
  assert.equal(row.created_at, created, 'original opt-out date must survive');

  // Idempotent on the next startup.
  assert.equal(migrateSuppressionPhones().updated, 0);
});

test('colliding legacy rows are preserved and still block outreach', () => {
  const id = randomUUID();
  const created = new Date(Date.now() - 30_000).toISOString();
  getDb()
    .prepare(
      `INSERT INTO contact_suppressions
        (id, contact_key, phone, email, customer_name, business_name, reason,
         source_message, enquiry_id, created_at, updated_at)
       VALUES (?, ?, ?, '', ?, '', 'opted_out', ?, NULL, ?, ?)`
    )
    .run(id, 'phone:9123456789', '9123456789', 'Duplicate', 'second opt-out', created, created);

  const before = countSuppressions();
  const result = migrateSuppressionPhones();
  assert.equal(result.updated, 0);
  assert.equal(result.conflicts, 1);
  assert.equal(countSuppressions(), before, 'both rows must be kept');

  const rows = listSuppressions().filter((record) =>
    phoneMatchVariants(record.phone).includes('919123456789')
  );
  assert.equal(rows.length, 2);
  assert.ok(rows.some((record) => record.source_message === 'do not call me'));
  assert.ok(rows.some((record) => record.source_message === 'second opt-out'));

  const suppression = findSuppressionForContact({ phone: '+91 91234 56789' });
  assert.ok(suppression);

  const lead = createLead({
    business_name: 'Legacy Duplicate Cafe',
    phone: '9123456789',
    outreach_status: 'new',
  });
  assert.equal(checkLeadOutreach(lead.id).allowed, false);
  assert.ok(!listOutreachReadyLeads().some((record) => record.id === lead.id));
});
