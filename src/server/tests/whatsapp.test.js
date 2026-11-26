import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dbFile = path.join(os.tmpdir(), `sipzy-whatsapp-${process.pid}-${Date.now()}.db`);
process.env.SIPZY_DB_FILE = dbFile;
process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = '987654321';
process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
process.env.WHATSAPP_VERIFY_TOKEN = 'verify-me-token';
process.env.WHATSAPP_API_VERSION = 'v26.0';
process.env.DRY_RUN = 'true';
process.env.TEST_MODE = 'false';
process.env.TEST_ALLOWED_NUMBERS = '';

const { initDb, closeDb, getDb } = await import('../db/index.js');
initDb();

const {
  getWhatsAppConfig,
  validateWhatsAppConfig,
  verifyWebhookSignature,
  processWhatsAppWebhook,
  listWhatsAppMessages,
  sendWhatsAppMessage,
  WhatsAppError,
} = await import('../services/whatsapp.js');
const { registerOptOut } = await import('../services/suppressions.js');
const { listEnquiries } = await import('../services/enquiries.js');

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

function webhookPayload(messageOverrides = {}, contactName = 'Test Customer') {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '1555', phone_number_id: '123' },
              contacts: [{ profile: { name: contactName }, wa_id: messageOverrides.from || '919876543210' }],
              messages: [
                {
                  from: messageOverrides.from || '919876543210',
                  id: messageOverrides.id || 'wamid.test1',
                  timestamp: '1700000000',
                  type: 'text',
                  text: { body: messageOverrides.body || 'Hello, I need cups' },
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

function signBody(body) {
  return 'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(body).digest('hex');
}

test('config reports configured when required env vars are present', () => {
  const config = getWhatsAppConfig();
  assert.equal(config.configured, true);
  assert.equal(config.has_access_token, true);
  assert.equal(config.has_phone_number_id, true);
  assert.equal(config.has_app_secret, true);
  assert.equal(config.has_verify_token, true);
  assert.equal(config.sending_enabled, false);
});

test('validation lists missing required WhatsApp env vars', () => {
  const previous = process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  try {
    const errors = validateWhatsAppConfig();
    assert.ok(errors.some((error) => /WHATSAPP_ACCESS_TOKEN/.test(error)));
  } finally {
    process.env.WHATSAPP_ACCESS_TOKEN = previous;
  }
});

test('webhook signature verification accepts valid signatures and rejects invalid ones', () => {
  const body = JSON.stringify({ hello: 'world' });
  const valid = signBody(body);
  assert.equal(verifyWebhookSignature(body, valid), true);
  assert.equal(verifyWebhookSignature(body, 'sha256=deadbeef'), false);
  assert.equal(verifyWebhookSignature(body, 'not-a-signature'), false);
});

test('processing an inbound WhatsApp message creates an enquiry and stores the message', async () => {
  const payload = webhookPayload({
    id: 'wamid.inbound1',
    from: '919876543210',
    body: 'My name is Ravi, business: Blue Cafe. Need 5000 cold cups 350ml delivered to Bengaluru.',
  });

  const result = await processWhatsAppWebhook(payload);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].status, 'processed');
  assert.ok(result.messages[0].enquiry_id);

  const messages = listWhatsAppMessages({ phone: '919876543210' });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].external_id, 'wamid.inbound1');
  assert.ok(messages[0].analysis_json);

  const analysis = JSON.parse(messages[0].analysis_json);
  assert.equal(analysis.customer_name, 'Ravi');
  assert.equal(analysis.business_name, 'Blue Cafe');
  assert.equal(analysis.product_type, 'Cold');
  assert.equal(analysis.cup_size, '350ml');
  assert.equal(analysis.quantity, 5000);
  assert.equal(analysis.delivery_location, 'Bengaluru');

  const enquiries = listEnquiries({});
  const created = enquiries.find((enquiry) => enquiry.id === result.messages[0].enquiry_id);
  assert.ok(created);
  assert.equal(created.phone, '919876543210');
  assert.equal(created.quantity, 5000);
});

test('duplicate webhook delivery is processed only once', async () => {
  const payload = webhookPayload({
    id: 'wamid.duplicate1',
    from: '919123456789',
    body: 'Need 1000 hot cups 250ml in Mysuru',
  });

  const first = await processWhatsAppWebhook(payload);
  const second = await processWhatsAppWebhook(payload);

  assert.equal(first.messages.length, 1);
  assert.equal(second.messages.length, 0);
  assert.ok(second.duplicates >= 1);

  const messages = listWhatsAppMessages({ phone: '919123456789' });
  assert.equal(messages.length, 1);
  const enquiries = listEnquiries({}).filter((enquiry) => enquiry.phone === '919123456789');
  assert.equal(enquiries.length, 1);
});

test('suppressed contacts do not create enquiries from WhatsApp', async () => {
  registerOptOut({ phone: '+91 90000 77777', source_message: 'stop' });

  const payload = webhookPayload({
    id: 'wamid.suppressed1',
    from: '919000077777',
    body: 'Need 2000 cold cups 450ml',
  });

  const result = await processWhatsAppWebhook(payload);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].status, 'suppressed');
  assert.equal(result.messages[0].enquiry_id, null);

  const enquiries = listEnquiries({}).filter((enquiry) => enquiry.phone === '919000077777');
  assert.equal(enquiries.length, 0);
});

test('an opted-out WhatsApp message registers a suppression', async () => {
  const payload = webhookPayload({
    id: 'wamid.optout1',
    from: '919222233333',
    body: 'Please stop messaging me.',
  });

  const result = await processWhatsAppWebhook(payload);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].status, 'opted_out');
  assert.ok(result.messages[0].enquiry_id);

  const enquiries = listEnquiries({}).filter((enquiry) => enquiry.phone === '919222233333');
  assert.equal(enquiries.length, 1);
  assert.equal(enquiries[0].enquiry_status, 'opted-out');
});

test('status updates are recorded on the stored message', async () => {
  const payload = webhookPayload({
    id: 'wamid.status1',
    from: '919333344444',
    body: 'Need 500 cold cups 250ml',
  });
  await processWhatsAppWebhook(payload);

  const statusPayload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [
                {
                  id: 'wamid.status1',
                  status: 'delivered',
                  timestamp: '1700000100',
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
  await processWhatsAppWebhook(statusPayload);

  const messages = listWhatsAppMessages({ phone: '919333344444' });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].delivery_status, 'delivered');
});

test('outgoing WhatsApp sending remains disabled by default', async () => {
  const result = await sendWhatsAppMessage({ to: '919876543210', body: 'Hello' });
  assert.equal(result.sent, false);
  assert.equal(result.dry_run, true);
  assert.equal(result.reason, 'sending_disabled');
});

test('outgoing sending can be enabled in test mode and respects allowed numbers', async () => {
  process.env.DRY_RUN = 'false';
  process.env.WHATSAPP_SENDING_ENABLED = 'true';
  process.env.TEST_MODE = 'true';
  process.env.TEST_ALLOWED_NUMBERS = '919999999999';

  fetchMock = async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.sent1' }] }),
    });

  const allowed = await sendWhatsAppMessage({ to: '919999999999', body: 'Hello' });
  assert.equal(allowed.sent, true);
  assert.equal(allowed.message_id, 'wamid.sent1');

  await assert.rejects(
    () => sendWhatsAppMessage({ to: '918888888888', body: 'Hello' }),
    (err) => err instanceof WhatsAppError && err.code === 'recipient_not_allowed'
  );

  // Restore default safety state.
  process.env.DRY_RUN = 'true';
  process.env.WHATSAPP_SENDING_ENABLED = 'false';
  process.env.TEST_MODE = 'false';
  process.env.TEST_ALLOWED_NUMBERS = '';
});