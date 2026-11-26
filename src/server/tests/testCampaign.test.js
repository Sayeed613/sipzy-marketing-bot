import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbFile = path.join(os.tmpdir(), `sipzy-test-campaign-${process.pid}-${Date.now()}.db`);
process.env.SIPZY_DB_FILE = dbFile;
process.env.DRY_RUN = 'true';
process.env.WHATSAPP_SENDING_ENABLED = 'false';
process.env.TEST_MODE = 'true';
process.env.TEST_CAMPAIGN_MODE_ENABLED = 'true';
process.env.TEST_ALLOWED_NUMBERS = '919900000001,919900000002,919900000003';
process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
process.env.AI_PROVIDER = 'mock';
process.env.AI_PAID_CALLS_ENABLED = 'true';
process.env.AI_MODEL = 'mock-model';

globalThis.__sipzyMockAiProvider = (user) => {
  let data = {};
  try { data = JSON.parse(user); } catch {}
  const message = String(data.customer_message || '');
  if (/price/i.test(message)) {
    return JSON.stringify({
      reply: 'I cannot confirm pricing here. The SIPZY team will send a quotation.',
      intent: 'quote_requested',
      requirements: { price_enquiry: 1 },
      proposed_actions: [{ type: 'update_enquiry', fields: { price_enquiry: 1 } }],
    });
  }
  return JSON.stringify({
    reply: 'Thanks for your message. Could you share the cup type, size, quantity and delivery location?',
    intent: 'general_enquiry',
    requirements: {},
    proposed_actions: [],
  });
};

const { initDb, closeDb, getDb } = await import('../db/index.js');
initDb();

const testCampaign = await import('../services/testCampaign.js');
const { createTemplate } = await import('../services/campaigns.js');
const { registerOptOut } = await import('../services/suppressions.js');
const { processWhatsAppWebhook } = await import('../services/whatsapp.js');
const { readConversation } = await import('../services/conversations.js');

const originalFetch = global.fetch;
let fetchCalls = [];

beforeEach(() => {
  fetchCalls = [];
  global.fetch = async (url, opts) => {
    fetchCalls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
    return {
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: `wamid.test.${fetchCalls.length}` }] }),
    };
  };
  // Returning to safe dry-run defaults between tests.
  process.env.DRY_RUN = 'true';
  process.env.WHATSAPP_SENDING_ENABLED = 'false';
  process.env.TEST_CAMPAIGN_MODE_ENABLED = 'true';
  testCampaign.stopTestCampaign('test-cleanup');
});

after(() => {
  global.fetch = originalFetch;
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbFile + suffix); } catch {}
  }
});

function approvedTemplate() {
  return createTemplate({
    name: 'SIPZY controlled test introduction',
    channel: 'whatsapp',
    template_type: 'introduction',
    status: 'approved',
    whatsapp_template_status: 'approved',
    whatsapp_template_name: 'sipzy_test_intro',
    body: 'Hello {{business_name}}, this is a SIPZY test message.',
  });
}

function addContact(phone, extra = {}) {
  return testCampaign.upsertTestContact({
    phone,
    name: `Test ${phone}`,
    authorized: true,
    ...extra,
  });
}

function webhook(phone, body, id) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: {
      contacts: [{ profile: { name: 'Test Recipient' }, wa_id: phone }],
      messages: [{ from: phone, id, timestamp: '1700000000', type: 'text', text: { body } }],
    }, field: 'messages' }] }],
  };
}

test('test campaign mode is disabled by default and start is refused when off', async () => {
  process.env.TEST_CAMPAIGN_MODE_ENABLED = 'false';
  await assert.rejects(
    () => testCampaign.startTestCampaign({ template_id: approvedTemplate().id }),
    /Test campaign mode is disabled/
  );
});

test('contacts must be in TEST_ALLOWED_NUMBERS', () => {
  assert.throws(
    () => testCampaign.upsertTestContact({ phone: '919999999999', authorized: true }),
    /not in TEST_ALLOWED_NUMBERS/
  );
});

test('start requires an approved WhatsApp template', async () => {
  addContact('919900000001');
  const draft = createTemplate({
    name: 'Draft test template',
    channel: 'whatsapp',
    status: 'draft',
    whatsapp_template_status: 'not_submitted',
    whatsapp_template_name: 'sipzy_test_draft',
    body: 'hello',
  });
  await assert.rejects(
    () => testCampaign.startTestCampaign({ template_id: draft.id }),
    /must be approved/
  );
});

test('dry-run start records outbound activity without calling the network', async () => {
  addContact('919900000001');
  const template = approvedTemplate();
  const state = await testCampaign.startTestCampaign({ template_id: template.id });
  assert.equal(state.run.status, 'running');
  assert.equal(state.run.recipients_dry_run, 1);
  assert.equal(state.run.recipients_sent, 0);
  assert.equal(fetchCalls.length, 0);
  const outbound = state.recent_activity.filter((a) => a.notes_json.direction === 'outbound');
  assert.ok(outbound.length >= 1);
  assert.equal(outbound[0].notes_json.status, 'dry_run');
  assert.equal(outbound[0].notes_json.template_name, 'sipzy_test_intro');
});

test('start sends only to authorized, configured, non-suppressed test contacts', async () => {
  process.env.DRY_RUN = 'false';
  process.env.WHATSAPP_SENDING_ENABLED = 'true';
  const template = approvedTemplate();

  addContact('919900000001', { name: 'Allowed One' });
  addContact('919900000002', { authorized: false, name: 'Not Authorized' });
  registerOptOut({ phone: '919900000003', source_message: 'stop' });
  addContact('919900000003', { name: 'Suppressed' });

  const state = await testCampaign.startTestCampaign({ template_id: template.id });
  assert.equal(state.run.recipients_total, 1);
  assert.equal(state.run.recipients_sent, 1);
  assert.equal(state.run.recipients_failed, 0);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.type, 'template');
  assert.equal(fetchCalls[0].body.template.name, 'sipzy_test_intro');
  assert.equal(fetchCalls[0].body.recipient_type, 'individual');

  const skipped = state.run.skipped;
  assert.ok(skipped.some((s) => s.reason === 'not_authorized'));
  assert.ok(skipped.some((s) => s.reason === 'contact_suppressed'));

  const queueCount = getDb().prepare('SELECT COUNT(*) AS n FROM outreach_queue').get().n;
  assert.equal(queueCount, 0, 'test campaign must not use the general outreach queue');
  const scheduler = getDb().prepare("SELECT value FROM campaign_settings WHERE key = 'scheduler_enabled'").get();
  assert.notEqual(scheduler?.value, 'true');
});

test('manual stop changes the run to stopped', async () => {
  addContact('919900000001');
  const template = approvedTemplate();
  await testCampaign.startTestCampaign({ template_id: template.id });
  const stopped = testCampaign.stopTestCampaign('tester');
  assert.equal(stopped.run.status, 'stopped');
  assert.ok(stopped.run.stopped_at);
});

test('inbound reply from an authorized test contact enters AI conversation and activity log', async () => {
  addContact('919900000001');
  const result = await processWhatsAppWebhook(
    webhook('919900000001', 'What is the price for 1000 cold cups 450ml?', 'wamid.inbound.1')
  );
  assert.equal(result.messages.length, 1);

  const state = testCampaign.getTestCampaignState();
  const inbound = state.recent_activity.find((a) => a.notes_json.direction === 'inbound');
  assert.ok(inbound);
  assert.equal(inbound.notes_json.phone, '919900000001');
  assert.match(inbound.notes_json.ai_reply, /price|quotation|team/i);
  assert.equal(inbound.notes_json.conversation_id?.length > 0, true);
  assert.ok(Array.isArray(inbound.notes_json.proposed_actions));

  const conversation = readConversation(inbound.notes_json.conversation_id);
  assert.ok(conversation);
  assert.ok(conversation.ai_reply);
  const aiMessage = conversation.messages.find((m) => m.direction === 'outbound' && m.source === 'ai_draft');
  assert.ok(aiMessage);
  assert.equal(aiMessage.metadata.draft, true);
  assert.ok(Array.isArray(aiMessage.metadata.proposed_actions));
  assert.ok(aiMessage.metadata.proposed_actions.length >= 1);
});

test('inbound reply from a non-test contact is not recorded as test activity', async () => {
  const before = testCampaign.listTestActivity().filter((a) => a.notes_json.phone === '919911111111').length;
  await processWhatsAppWebhook(webhook('919911111111', 'Need cups', 'wamid.inbound.2'));
  const after = testCampaign.listTestActivity().filter((a) => a.notes_json.phone === '919911111111').length;
  assert.equal(after, before);
});

test('test campaign never changes AI, sending or scheduler settings', async () => {
  const before = testCampaign.getTestCampaignConfig();
  assert.equal(process.env.AI_PROVIDER, 'mock');
  assert.equal(process.env.SCHEDULER, undefined);
  await testCampaign.startTestCampaign({ template_id: approvedTemplate().id }).catch(() => {});
  const after = testCampaign.getTestCampaignConfig();
  assert.equal(after.ai_provider, before.ai_provider);
  assert.equal(after.ai_paid_calls_enabled, before.ai_paid_calls_enabled);
  assert.equal(after.scheduler_enabled, before.scheduler_enabled);
});
