import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbFile = path.join(os.tmpdir(), `sipzy-google-places-${process.pid}-${Date.now()}.db`);
process.env.SIPZY_DB_FILE = dbFile;
process.env.GOOGLE_PLACES_API_KEY = 'test-key-not-real';

const { initDb, closeDb, getDb } = await import('../db/index.js');
initDb();

const { getGooglePlacesConfig, validateSearchInput, searchGooglePlaces, GooglePlacesError } =
  await import('../services/googlePlaces.js');
const { createLead } = await import('../services/leads.js');
const { registerOptOut } = await import('../services/suppressions.js');

const originalFetch = global.fetch;
let fetchMock = null;

beforeEach(() => {
  fetchMock = null;
  global.fetch = async (...args) => {
    if (!fetchMock) throw new Error('fetch mock not configured');
    return fetchMock(...args);
  };
});

after(() => {
  global.fetch = originalFetch;
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbFile + suffix);
    } catch {
      // disposable temp file
    }
  }
});

function mockResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('config reports missing key when unset', () => {
  const previous = process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.GOOGLE_PLACES_API_KEY;
  try {
    const config = getGooglePlacesConfig();
    assert.equal(config.configured, false);
    assert.ok(config.categories.includes('Cafés'));
    assert.equal(config.default_city, 'Bengaluru');
  } finally {
    process.env.GOOGLE_PLACES_API_KEY = previous;
  }
});

test('validation rejects invalid city, category and page size', () => {
  const { errors } = validateSearchInput({ city: '', category: 'Gyms', page_size: 0 });
  assert.ok(errors.some((e) => e.field === 'city'));
  assert.ok(errors.some((e) => e.field === 'category'));
  assert.ok(errors.some((e) => e.field === 'page_size'));
});

test('search throws a 503 when the API key is missing', async () => {
  const previous = process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.GOOGLE_PLACES_API_KEY;
  try {
    await assert.rejects(
      () => searchGooglePlaces({ city: 'Bengaluru', category: 'Cafés' }),
      (err) => err instanceof GooglePlacesError && err.status === 503 && err.code === 'missing_api_key'
    );
  } finally {
    process.env.GOOGLE_PLACES_API_KEY = previous;
  }
});

test('successful search normalizes Google results and includes attribution', async () => {
  const leadsBefore = getDb().prepare('SELECT COUNT(*) AS n FROM leads').get().n;

  fetchMock = async () =>
    mockResponse(200, {
      places: [
        {
          id: 'places/abc123',
          displayName: { text: 'Bluebird Cafe' },
          formattedAddress: '123 MG Road, Bengaluru',
          types: ['cafe', 'food'],
          businessStatus: 'OPERATIONAL',
          googleMapsUri: 'https://maps.google.com/?cid=1',
          websiteUri: 'https://bluebird.example',
          nationalPhoneNumber: '+91 98765 43210',
          rating: 4.5,
          userRatingCount: 120,
        },
      ],
      nextPageToken: 'next-token',
    });

  const result = await searchGooglePlaces({ city: 'Bengaluru', category: 'Cafés', page_size: 5 });

  assert.equal(result.configured, true);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].place_id, 'places/abc123');
  assert.equal(result.results[0].name, 'Bluebird Cafe');
  assert.equal(result.results[0].address, '123 MG Road, Bengaluru');
  assert.equal(result.results[0].phone, '+91 98765 43210');
  assert.equal(result.results[0].rating, 4.5);
  assert.equal(result.results[0].saved_to_crm, false);
  assert.equal(result.next_page_token, 'next-token');
  assert.match(result.attribution, /Google/);
  assert.match(result.results[0].attribution, /Google/);

  const leadsAfter = getDb().prepare('SELECT COUNT(*) AS n FROM leads').get().n;
  assert.equal(leadsAfter, leadsBefore, 'search must not create CRM leads');
});

test('quota errors are mapped to 429', async () => {
  fetchMock = async () => mockResponse(429, { error: { message: 'Quota exceeded' } });
  await assert.rejects(
    () => searchGooglePlaces({ city: 'Bengaluru', category: 'Cafés' }),
    (err) => err instanceof GooglePlacesError && err.status === 429 && err.code === 'quota_exceeded'
  );
});

test('invalid API key errors are mapped to 403', async () => {
  fetchMock = async () => mockResponse(403, { error: { message: 'API key invalid' } });
  await assert.rejects(
    () => searchGooglePlaces({ city: 'Bengaluru', category: 'Cafés' }),
    (err) => err instanceof GooglePlacesError && err.status === 403 && err.code === 'invalid_api_key'
  );
});

test('generic Google API errors are mapped to 502', async () => {
  fetchMock = async () => mockResponse(500, { error: { message: 'Backend error' } });
  await assert.rejects(
    () => searchGooglePlaces({ city: 'Bengaluru', category: 'Cafés' }),
    (err) => err instanceof GooglePlacesError && err.status === 502 && /Backend error/.test(err.message)
  );
});

test('network failures are mapped to 503', async () => {
  global.fetch = async () => {
    throw new Error('socket hang up');
  };
  await assert.rejects(
    () => searchGooglePlaces({ city: 'Bengaluru', category: 'Cafés' }),
    (err) => err instanceof GooglePlacesError && err.status === 503 && err.code === 'network_error'
  );
});

test('results are flagged when they match existing leads or suppressions', async () => {
  const lead = createLead({
    business_name: 'Matched Cafe',
    city: 'Bengaluru',
    phone: '+91 98765 43210',
  });
  registerOptOut({ phone: '+91 98765 43210', source_message: 'stop' });

  fetchMock = async () =>
    mockResponse(200, {
      places: [
        {
          id: 'places/matched',
          displayName: { text: 'Matched Cafe' },
          formattedAddress: 'Bengaluru',
          nationalPhoneNumber: '+91 98765 43210',
        },
        {
          id: 'places/clean',
          displayName: { text: 'Clean Cafe' },
          formattedAddress: 'Bengaluru',
        },
      ],
    });

  const result = await searchGooglePlaces({ city: 'Bengaluru', category: 'Cafés' });
  const matched = result.results.find((place) => place.place_id === 'places/matched');
  const clean = result.results.find((place) => place.place_id === 'places/clean');

  assert.ok(matched.crm_matches.existing_lead_ids.includes(lead.id));
  assert.equal(matched.crm_matches.suppressed, true);
  assert.ok(matched.crm_matches.suppression_ids.length >= 1);
  assert.deepEqual(clean.crm_matches.existing_lead_ids, []);
  assert.equal(clean.crm_matches.suppressed, false);
});
