/**
 * One-shot Google Places API (New) verification.
 *
 * - Reads GOOGLE_PLACES_API_KEY from the backend .env (never printed).
 * - Makes exactly ONE Text Search request: "cafes in Bengaluru".
 * - Requests only the minimal fields: place ID + display name.
 * - Prints HTTP status and a safe Google error message.
 * - Does not touch the SIPZY database or CRM.
 */

import 'dotenv/config';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK = 'places.id,places.displayName';

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

const key = String(process.env.GOOGLE_PLACES_API_KEY || '').trim();

console.log('API key detected: ' + (key ? 'Yes' : 'No'));
if (!key) {
  console.log('Key length: 0');
  console.log('');
  console.log('No live request was made. Add GOOGLE_PLACES_API_KEY to the backend .env');
  console.log('(see .env.example), then rerun: node scripts/verify-google-places.mjs');
  process.exit(2);
}

console.log(`Key length: ${key.length} (value not shown)`);

let response;
try {
  response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: 'cafes in Bengaluru',
      pageSize: 3,
    }),
    signal: AbortSignal.timeout(15000),
  });
} catch (err) {
  fail(`Request failed before a response (network/timeout): ${err.name}`, 3);
}

console.log(`HTTP status: ${response.status}`);

let body = null;
try {
  body = await response.json();
} catch {
  body = null;
}

if (!response.ok) {
  const googleStatus = body?.error?.status || 'unknown';
  const googleMessage = body?.error?.message || 'no error message returned';
  console.log(`Google API error status: ${googleStatus}`);
  console.log(`Google API error message: ${googleMessage}`);
  if (response.status === 403) {
    console.log('Likely cause: API key restrictions, API not enabled on the key\'s project, or missing billing.');
  } else if (response.status === 429) {
    console.log('Likely cause: quota exhausted or billing not enabled.');
  } else if (response.status === 400) {
    console.log('Likely cause: request configuration rejected (field mask or query).');
  }
  process.exit(1);
}

const places = Array.isArray(body?.places) ? body.places : [];
console.log('Request succeeded: Yes');
console.log(`Results returned: ${places.length}`);
for (const place of places) {
  const id = place?.id || '(no id)';
  const name = place?.displayName?.text || '(no name)';
  console.log(`- ${name} | ${id}`);
}
console.log('Note: results were printed only, not stored in the SIPZY CRM.');
