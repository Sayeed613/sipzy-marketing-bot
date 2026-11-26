import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbFile = path.join(os.tmpdir(), `sipzy-conversations-${process.pid}-${Date.now()}.db`);
process.env.SIPZY_DB_FILE = dbFile;
process.env.DRY_RUN = 'true';
process.env.WHATSAPP_SENDING_ENABLED = 'false';
process.env.AI_PROVIDER = 'local';

const { initDb, closeDb } = await import('../db/index.js');
initDb();

const conversations = await import('../services/conversations.js');
const ai = await import('../services/ai.js');
const { processWhatsAppWebhook } = await import('../services/whatsapp.js');
const { registerOptOut } = await import('../services/suppressions.js');

after(() => {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) try { fs.unlinkSync(dbFile + suffix); } catch {}
});

function webhook(phone, body, id = 'wamid.x') {
  return {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: {
      contacts: [{ profile: { name: 'Test Customer' }, wa_id: phone }],
      messages: [{ from: phone, id, timestamp: '1700000000', type: 'text', text: { body } }],
    }, field: 'messages' }] }],
  };
}

test('AI must not invent prices or product specifications', async () => {
  const reply = await ai.generateReply({
    conversation: { status: 'active', last_message: 'What is the price?' },
    requirements: { product_type: 'Cold', cup_size: '450ml', quantity: 1000, delivery_location: 'Bengaluru', missing_info: [] },
    lastMessage: 'What is the price?',
  });
  assert.ok(reply);
  assert.ok(!/₹|\$|rs\.?\s*\d|price is/i.test(reply));
  assert.ok(/team|quotation/i.test(reply));
});

test('customer asks for 1000 cold cups 450ml', async () => {
  const phone = '919100000001';
  const result = await processWhatsAppWebhook(webhook(phone, 'My name is Ravi. Need 1000 cold cups 450ml delivered to Bengaluru.', 'w1'));
  assert.equal(result.messages.length, 1);
  const conv = conversations.findConversationByPhone(phone);
  assert.ok(conv);
  assert.equal(conv.product_type, 'Cold');
  assert.equal(conv.cup_size, '450ml');
  assert.equal(conv.quantity, 1000);
  assert.equal(conv.delivery_location, 'Bengaluru');
  assert.ok(conv.ai_reply);
});

test('customer asks for hot cups', async () => {
  const phone = '919100000002';
  await processWhatsAppWebhook(webhook(phone, 'Need hot cups 350ml, 500 pieces, delivery to Mysuru.', 'w2'));
  const conv = conversations.findConversationByPhone(phone);
  assert.equal(conv.product_type, 'Hot');
  assert.equal(conv.cup_size, '350ml');
  assert.equal(conv.quantity, 500);
});

test('customer asks for price', async () => {
  const phone = '919100000003';
  await processWhatsAppWebhook(webhook(phone, 'I need 1000 cold cups 450ml in Bengaluru. What is the price?', 'w3'));
  const conv = conversations.findConversationByPhone(phone);
  assert.equal(conv.price_enquiry, true);
  assert.ok(/cannot confirm pricing|team/i.test(conv.ai_reply));
});

test('customer asks for samples', async () => {
  const phone = '919100000004';
  await processWhatsAppWebhook(webhook(phone, 'Can I get samples of 250ml hot cups?', 'w4'));
  const conv = conversations.findConversationByPhone(phone);
  assert.equal(conv.sample_required, true);
  assert.ok(/sample/i.test(conv.ai_reply));
});

test('incomplete requirements asks one question', async () => {
  const phone = '919100000005';
  await processWhatsAppWebhook(webhook(phone, 'I need cups.', 'w5'));
  const conv = conversations.findConversationByPhone(phone);
  assert.ok(Array.isArray(conv.missing_info) && conv.missing_info.length > 0);
  assert.ok(conv.ai_reply && conv.ai_reply.endsWith('?'));
});

test('customer changes quantity', async () => {
  const phone = '919100000006';
  await processWhatsAppWebhook(webhook(phone, 'Need 1000 cold cups 450ml in Bengaluru.', 'w6a'));
  await processWhatsAppWebhook(webhook(phone, 'Actually make it 2000 cups.', 'w6b'));
  const conv = conversations.findConversationByPhone(phone);
  assert.equal(conv.quantity, 2000);
  assert.equal(conv.product_type, 'Cold');
  assert.equal(conv.cup_size, '450ml');
});

test('customer asks for a human', async () => {
  const phone = '919100000007';
  await processWhatsAppWebhook(webhook(phone, 'Please connect me to a human.', 'w7'));
  const conv = conversations.findConversationByPhone(phone);
  assert.ok(/representative|team/i.test(conv.ai_reply));
});

test('customer opts out', async () => {
  const phone = '919100000008';
  await processWhatsAppWebhook(webhook(phone, 'Please stop messaging me.', 'w8'));
  const conv = conversations.findConversationByPhone(phone);
  assert.equal(conv.status, 'opted_out');
  assert.equal(conv.ai_reply, '');
});

test('multiple messages and duplicate webhook events', async () => {
  const phone = '919100000009';
  await processWhatsAppWebhook(webhook(phone, 'Need 500 cold cups 250ml.', 'w9'));
  await processWhatsAppWebhook(webhook(phone, 'Delivery to Chennai.', 'w10'));
  const dup = await processWhatsAppWebhook(webhook(phone, 'Delivery to Chennai.', 'w10'));
  assert.ok(dup.duplicates >= 1);
  const conv = conversations.findConversationByPhone(phone);
  const full = conversations.readConversation(conv.id);
  assert.equal(conv.delivery_location, 'Chennai');
  assert.equal(conv.quantity, 500);
  assert.ok(Array.isArray(full.messages) && full.messages.length >= 2);
});

test('approve and reject controls', async () => {
  const phone = '919100000010';
  await processWhatsAppWebhook(webhook(phone, 'Need 100 cold cups 250ml in Delhi.', 'w11'));
  const conv = conversations.findConversationByPhone(phone);
  const approved = conversations.approveReply(conv.id, 'tester');
  assert.equal(approved.reply_status, 'approved');
  const regenerated = await conversations.regenerateReply(conv.id);
  assert.ok(regenerated.ai_reply);
  const rejected = conversations.rejectReply(conv.id, 'no');
  assert.equal(rejected.reply_status, 'rejected');
});

test('provider config is local and no paid calls', () => {
  const config = ai.getAiConfig();
  assert.equal(config.provider, 'local');
  assert.equal(config.paid_calls_enabled, false);
  assert.equal(config.network_calls, false);
});