import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbFile = path.join(os.tmpdir(), `sipzy-leads-${process.pid}-${Date.now()}.db`);
process.env.SIPZY_DB_FILE = dbFile;

const { initDb, closeDb } = await import('../db/index.js');
initDb();

const {
  validateLead,
  createLead,
  listLeads,
  parseCsv,
  importLeadsFromCsv,
  leadsToCsv,
  findDuplicateLeadGroups,
  findDuplicateLeadIds,
} = await import('../services/leads.js');

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

test('CSV is parsed with quoted fields and CRLF endings', () => {
  const csv = 'business_name,city\r\n"Acme, Inc.","Bengaluru"\r\nPlain,Cafe\r\n';
  assert.deepEqual(parseCsv(csv), [
    ['business_name', 'city'],
    ['Acme, Inc.', 'Bengaluru'],
    ['Plain', 'Cafe'],
  ]);
});

test('CSV import stores qualification and category', () => {
  const csv = [
    'business_name,business_cat,city,lead_qualification',
    'Cafe One,Cafés and coffee shops,Bengaluru,high',
    'Cafe Two,Restaurants,Bengaluru,medium',
  ].join('\n');
  const result = importLeadsFromCsv(csv);
  assert.equal(result.imported, 2);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors.length, 0);

  const leads = listLeads({ qualification: 'high' });
  assert.equal(leads.length, 1);
  assert.equal(leads[0].business_name, 'Cafe One');
  assert.equal(leads[0].business_cat, 'Cafés and coffee shops');
  assert.equal(leads[0].lead_qualification, 'high');
});

test('lead qualification is validated', () => {
  const { errors } = validateLead({ business_name: 'X', lead_qualification: 'urgent' });
  assert.ok(errors.some((error) => error.field === 'lead_qualification'));
});

test('duplicate leads are detected by phone, email and name+city', () => {
  createLead({
    business_name: 'Duplicate Cafe',
    city: 'Bengaluru',
    phone: '+91 98765 43210',
    email: 'dup@example.com',
  });
  createLead({
    business_name: 'Duplicate Cafe',
    city: 'Bengaluru',
    phone: '9876543210',
    email: 'DUP@example.com',
  });

  const groups = findDuplicateLeadGroups();
  assert.ok(groups.length >= 1);
  const ids = findDuplicateLeadIds();
  assert.ok(ids.size >= 2);
});

test('leads can be filtered by city, category, qualification and search', () => {
  createLead({
    business_name: 'Juice Spot',
    business_cat: 'Juice and smoothie shops',
    city: 'Mumbai',
    lead_qualification: 'low',
  });

  assert.equal(listLeads({ city: 'Mumbai' }).length, 1);
  assert.equal(listLeads({ category: 'Juice and smoothie shops' }).length, 1);
  assert.equal(listLeads({ qualification: 'low' }).length, 1);
  assert.equal(listLeads({ search: 'Juice' }).length, 1);
});

test('CSV export includes the qualification column', () => {
  const csv = leadsToCsv(listLeads());
  assert.match(csv, /lead_qualification/);
  assert.ok(csv.split('\n').length > 1);
});
