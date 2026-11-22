import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbFile = path.join(os.tmpdir(), `sipzy-verification-${process.pid}-${Date.now()}.db`);
process.env.SIPZY_DB_FILE = dbFile;

const { initDb, closeDb, getDb } = await import('../db/index.js');
initDb();

const {
  createLead,
  readLead,
  updateLead,
  listLeads,
  scoreLeadQuality,
  findDuplicateLeadGroups,
} = await import('../services/leads.js');
const {
  listOutreachReadyLeads,
  checkLeadOutreach,
} = await import('../services/outreach.js');
const { registerOptOut } = await import('../services/suppressions.js');

after(() => {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbFile + suffix);
    } catch {
      // disposable temp file
    }
  }
});

test('database migration adds all verification columns', () => {
  const columns = getDb().prepare('PRAGMA table_info(leads)').all().map((column) => column.name);
  for (const column of [
    'verification_status',
    'website_verified',
    'phone_verified',
    'address_verified',
    'business_active',
    'verification_source',
    'verification_notes',
    'last_verified_at',
    'verified_by',
  ]) {
    assert.ok(columns.includes(column), `missing ${column}`);
  }
});

test('new leads default to unverified', () => {
  const lead = createLead({ business_name: 'Verification Cafe', email: 'verify@example.com' });
  assert.equal(lead.verification_status, 'unverified');
  assert.equal(lead.website_verified, 0);
  assert.equal(lead.phone_verified, 0);
  assert.equal(lead.address_verified, 0);
  assert.equal(lead.business_active, null);
  assert.equal(lead.quality_label, 'Low');
});

test('verification status and review fields can be updated', () => {
  const lead = createLead({
    business_name: 'Reviewed Cafe',
    email: 'reviewed@example.com',
    phone: '+1 555 010 2030',
    city: 'Bengaluru',
    address: '123 Main Road',
    website: 'reviewed.example',
    business_cat: 'Cafés and coffee shops',
  });

  const updated = updateLead(lead.id, {
    verification_status: 'verified',
    website_verified: true,
    phone_verified: true,
    address_verified: true,
    business_active: true,
    verification_source: 'Website and phone call',
    verification_notes: 'Business confirmed active.',
    verified_by: 'QA Team',
  });

  assert.equal(updated.verification_status, 'verified');
  assert.equal(updated.website_verified, 1);
  assert.equal(updated.phone_verified, 1);
  assert.equal(updated.address_verified, 1);
  assert.equal(updated.business_active, 1);
  assert.equal(updated.verification_source, 'Website and phone call');
  assert.equal(updated.verified_by, 'QA Team');
  assert.ok(updated.last_verified_at, 'review timestamp must be recorded');
  assert.equal(updated.quality_label, 'High');
});

test('quality score rewards complete verified data', () => {
  const lead = createLead({
    business_name: 'High Quality Cafe',
    business_cat: 'Cafés and coffee shops',
    email: 'high@example.com',
    phone: '+1 555 010 2031',
    contact_person: 'Jane',
    city: 'Bengaluru',
    address: '123 Main Road',
    website: 'high.example',
  });
  updateLead(lead.id, {
    verification_status: 'verified',
    website_verified: true,
    phone_verified: true,
    address_verified: true,
    business_active: true,
    verification_source: 'Website',
  });
  const quality = scoreLeadQuality(readLead(lead.id));
  assert.equal(quality.score, 100);
  assert.equal(quality.label, 'High');
  assert.equal(quality.outreach_ready, true);
});

test('missing or incomplete information lowers the quality score', () => {
  const lead = createLead({ business_name: 'Sparse Cafe' });
  const quality = scoreLeadQuality(lead);
  assert.ok(quality.score < 40);
  assert.equal(quality.label, 'Low');
  assert.ok(quality.reasons.includes('Missing email address'));
  assert.ok(quality.reasons.includes('Missing business category'));
});

test('invalid verification status is rejected', () => {
  const lead = createLead({ business_name: 'Status Cafe', email: 'status@example.com' });
  assert.throws(() => updateLead(lead.id, { verification_status: 'approved' }), /verification_status/);
});

test('duplicate leads are detected and reported', () => {
  createLead({
    business_name: 'Duplicate Verification Cafe',
    city: 'Bengaluru',
    phone: '+1 555 010 9999',
    email: 'dupv@example.com',
  });
  createLead({
    business_name: 'Duplicate Verification Cafe',
    city: 'Bengaluru',
    phone: '1 555 010 9999',
    email: 'DUPV@example.com',
  });

  const groups = findDuplicateLeadGroups();
  assert.ok(groups.length >= 1);
});

test('suppressed leads are excluded from outreach and score zero', () => {
  registerOptOut({ phone: '+1 777 888 9999', source_message: 'stop' });
  const lead = createLead({
    business_name: 'Suppressed Cafe',
    email: 'suppressed@example.com',
    phone: '+1 777 888 9999',
    business_cat: 'Cafés and coffee shops',
    city: 'Bengaluru',
    address: '1 Road',
    website: 'suppressed.example',
  });

  const quality = scoreLeadQuality(readLead(lead.id));
  assert.equal(quality.score, 0);
  assert.equal(quality.suppressed, true);
  assert.equal(quality.outreach_ready, false);
  assert.ok(!listOutreachReadyLeads().some((row) => row.id === lead.id));
  assert.equal(checkLeadOutreach(lead.id).allowed, false);
});

test('existing lead records remain intact after verification migration', () => {
  const before = getDb().prepare('SELECT COUNT(*) AS n FROM leads').get().n;
  initDb();
  const after = getDb().prepare('SELECT COUNT(*) AS n FROM leads').get().n;
  assert.equal(after, before);
  assert.ok(before >= 1);
});

test('leads can be filtered by verification status and quality', () => {
  const verified = listLeads({ verification_status: 'verified' });
  assert.ok(verified.every((lead) => lead.verification_status === 'verified'));
  const high = listLeads({ quality: 'High' });
  assert.ok(high.every((lead) => lead.quality_label === 'High'));
});
