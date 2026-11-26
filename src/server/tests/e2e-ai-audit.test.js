import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbFile = path.join(os.tmpdir(), `sipzy-e2e-ai-${process.pid}-${Date.now()}.db`);
process.env.SIPZY_DB_FILE = dbFile;
process.env.DRY_RUN = 'true';
process.env.WHATSAPP_SENDING_ENABLED = 'false';
process.env.AI_PROVIDER = 'mock';
process.env.AI_PAID_CALLS_ENABLED = 'true';
process.env.AI_MODEL = 'mock-model';
process.env.AI_TIMEOUT_MS = '200';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
process.env.WHATSAPP_APP_SECRET = 'test-app-secret';

globalThis.__sipzyMockAiProvider = (user) => {
  let data = {};
  try { data = JSON.parse(user); } catch { data = {}; }
  const msg = String(data.customer_message || '').toLowerCase();
  const conv = data.conversation || {};
  const req = data.requirements || {};

  const baseReq = {
    product_type: req.product_type || conv.product_type || '',
    cup_size: req.cup_size || conv.cup_size || '',
    quantity: req.quantity || conv.quantity || 0,
    delivery_location: req.delivery_location || conv.delivery_location || '',
    customer_name: req.customer_name || conv.customer_name || '',
    business_name: req.business_name || conv.business_name || '',
    sample_required: req.sample_required || conv.sample_required || 0,
    price_enquiry: req.price_enquiry || conv.price_enquiry || 0,
    purchase_timeline: req.purchase_timeline || conv.purchase_timeline || '',
    budget: req.budget || conv.budget || '',
  };

  if (msg.includes('invalid_output_test')) {
    return 'this is not valid json';
  }

  if (msg.includes('timeout_test')) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(JSON.stringify({
        reply: 'provider reply that should not arrive',
        intent: 'general_enquiry',
        requirements: baseReq,
        proposed_actions: [],
      })), 1000);
      // The mock is invoked synchronously by callProvider; options are not
      // available here, so rely on the caller's AbortController by returning
      // a promise that never resolves quickly. The test lowers timeout to
      // 200ms and checks fallback.
      // Note: global mock has no signal; handle timeout in test separately.
    });
  }

  const isSpecialIntent = /price|cost|rate|quote|sample|expensive|human|person|agent|representative/.test(msg);

  if (!isSpecialIntent && msg.includes('450 ml cold cups')) {
    return JSON.stringify({
      reply: 'I can help with 450ml cold cups. What quantity do you need, and where should delivery go?',
      intent: 'general_enquiry',
      requirements: { ...baseReq, product_type: 'Cold', cup_size: '450ml' },
      proposed_actions: [],
    });
  }

  if (!isSpecialIntent && msg.includes('1000 cold cups 450ml')) {
    return JSON.stringify({
      reply: 'Noted 1000 cold cups (450ml). Where should I deliver them?',
      intent: 'interested',
      requirements: { ...baseReq, product_type: 'Cold', cup_size: '450ml', quantity: 1000 },
      proposed_actions: [{ type: 'update_enquiry', fields: { product_type: 'Cold', cup_size: '450ml', quantity: 1000 } }],
    });
  }

  if (msg.includes('delivery to bengaluru') || msg.includes('delivered to bengaluru')) {
    return JSON.stringify({
      reply: 'Thank you. I have your delivery location. The SIPZY team will confirm pricing and availability.',
      intent: 'interested',
      requirements: { ...baseReq, delivery_location: 'Bengaluru' },
      proposed_actions: [{ type: 'update_enquiry', fields: { delivery_location: 'Bengaluru' } }],
    });
  }

  if (msg.includes('change quantity to 5000') || msg.includes('make it 5000')) {
    return JSON.stringify({
      reply: 'I have updated the quantity to 5,000 cups. The SIPZY team will confirm pricing.',
      intent: 'interested',
      requirements: { ...baseReq, quantity: 5000 },
      proposed_actions: [{ type: 'update_enquiry', fields: { quantity: 5000 } }],
    });
  }

  if (msg.includes('price') || msg.includes('cost') || msg.includes('rate')) {
    return JSON.stringify({
      reply: 'I cannot confirm pricing here. The SIPZY team will review your requirements and send a quotation.',
      intent: 'quote_requested',
      requirements: { ...baseReq, price_enquiry: 1 },
      proposed_actions: [{ type: 'update_enquiry', fields: { price_enquiry: 1 } }],
    });
  }

  if (msg.includes('sample')) {
    return JSON.stringify({
      reply: 'I can arrange a sample. The SIPZY team will prepare it based on your requirements.',
      intent: 'sample_requested',
      requirements: { ...baseReq, sample_required: 1 },
      proposed_actions: [{ type: 'update_enquiry', fields: { sample_required: 1 } }],
    });
  }

  if (msg.includes('quotation') || msg.includes('quote')) {
    return JSON.stringify({
      reply: 'I will prepare a quotation draft for the SIPZY team to review and send you.',
      intent: 'quote_requested',
      requirements: baseReq,
      proposed_actions: [{ type: 'prepare_quotation_draft', fields: { product_type: baseReq.product_type, cup_size: baseReq.cup_size, quantity: baseReq.quantity, notes: 'AI-prepared draft; prices to be confirmed by the SIPZY team.' } }],
    });
  }

  if (msg.includes('expensive') || msg.includes('objection') || msg.includes('too high')) {
    return JSON.stringify({
      reply: 'I understand. The SIPZY team can review the quantity and offer the best possible option. Would you like a revised quotation?',
      intent: 'interested',
      requirements: baseReq,
      proposed_actions: [],
    });
  }

  if (msg.includes('human') || msg.includes('person') || msg.includes('agent') || msg.includes('representative')) {
    return JSON.stringify({
      reply: 'I will connect you with the SIPZY team. A representative will follow up with you shortly.',
      intent: 'more_information_requested',
      requirements: baseReq,
      proposed_actions: [{ type: 'create_handoff', reason: 'Customer requested a human salesperson', priority: 'high' }],
    });
  }

  if (msg.includes('cold cups 250') || msg.includes('hot cups 350')) {
    // isolation test helper
    if (msg.includes('cold cups 250')) {
      return JSON.stringify({
        reply: 'Noted cold 250ml cups.',
        intent: 'interested',
        requirements: { ...baseReq, product_type: 'Cold', cup_size: '250ml' },
        proposed_actions: [],
      });
    }
    return JSON.stringify({
      reply: 'Noted hot 350ml cups.',
      intent: 'interested',
      requirements: { ...baseReq, product_type: 'Hot', cup_size: '350ml' },
      proposed_actions: [],
    });
  }

  return JSON.stringify({
    reply: 'Thanks for your message. Could you share the cup type, size, quantity and delivery location?',
    intent: 'general_enquiry',
    requirements: baseReq,
    proposed_actions: [],
  });
};

const { initDb, closeDb } = await import('../db/index.js');
initDb();

const conversations = await import('../services/conversations.js');
const ai = await import('../services/ai.js');
const { processWhatsAppWebhook } = await import('../services/whatsapp.js');
const { registerOptOut } = await import('../services/suppressions.js');
const handoffs = await import('../services/handoffs.js');
const quotations = await import('../services/quotations.js');

after(() => {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) try { fs.unlinkSync(dbFile + suffix); } catch {}
});

function webhook(phone, body, id) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: {
      contacts: [{ profile: { name: 'Test Customer' }, wa_id: phone }],
      messages: [{ from: phone, id, timestamp: '1700000000', type: 'text', text: { body } }],
    }, field: 'messages' }] }],
  };
}

function phone(n) { return `9198${String(n).padStart(8, '0')}`; }

test('E2E scenario 1: 450ml cold cups only', async () => {
  const p = phone(1);
  await processWhatsAppWebhook(webhook(p, 'I need 450 ml cold cups', 'e1'));
  const conv = conversations.findConversationByPhone(p);
  assert.equal(conv.product_type, 'Cold');
  assert.equal(conv.cup_size, '450ml');
  assert.ok(conv.ai_reply);
  assert.ok(!/₹|\$|rs\.?\s*\d/i.test(conv.ai_reply));
  assert.ok(Array.isArray(conv.missing_info) && conv.missing_info.includes('quantity'));
});

test('E2E scenario 2: quantity but no delivery location', async () => {
  const p = phone(2);
  await processWhatsAppWebhook(webhook(p, 'I need 1000 cold cups 450ml for my cafe', 'e2'));
  const conv = conversations.findConversationByPhone(p);
  assert.equal(conv.quantity, 1000);
  assert.equal(conv.delivery_location, '');
  assert.ok(conv.missing_info.includes('delivery_location'));
  assert.ok(conv.ai_reply.endsWith('?') || /where|deliver/i.test(conv.ai_reply));
});

test('E2E scenario 3: later supplies missing location', async () => {
  const p = phone(2);
  await processWhatsAppWebhook(webhook(p, 'Delivery to Bengaluru', 'e3'));
  const conv = conversations.findConversationByPhone(p);
  assert.equal(conv.delivery_location, 'Bengaluru');
  assert.equal(conv.quantity, 1000);
  assert.equal(conv.product_type, 'Cold');
  assert.ok(!conv.missing_info.includes('delivery_location'));
});

test('E2E scenario 4: changes quantity 1000 to 5000', async () => {
  const p = phone(2);
  await processWhatsAppWebhook(webhook(p, 'Please change quantity to 5000', 'e4'));
  const conv = conversations.findConversationByPhone(p);
  assert.equal(conv.quantity, 5000);
  const { readEnquiry } = await import('../services/enquiries.js');
  const enq = readEnquiry(conv.linked_enquiry_id);
  assert.ok(enq);
  assert.equal(enq.quantity, 5000);
});

test('E2E scenario 5: pricing request no invented price', async () => {
  const p = phone(5);
  await processWhatsAppWebhook(webhook(p, 'I need 1000 cold cups 450ml in Bengaluru. What is the price?', 'e5'));
  const conv = conversations.findConversationByPhone(p);
  assert.equal(conv.price_enquiry, true);
  assert.ok(/cannot confirm pricing|team|quotation/i.test(conv.ai_reply));
  assert.ok(!/₹|\$|rs\.?\s*\d|price is/i.test(conv.ai_reply));
});

test('E2E scenario 6: samples', async () => {
  const p = phone(6);
  await processWhatsAppWebhook(webhook(p, 'Can I get samples of 250ml hot cups?', 'e6'));
  const conv = conversations.findConversationByPhone(p);
  assert.equal(conv.sample_required, true);
  assert.ok(/sample/i.test(conv.ai_reply));
});

test('E2E scenario 7: bulk quotation draft', async () => {
  const p = phone(7);
  await processWhatsAppWebhook(webhook(p, 'Please send a quotation for 5000 cold cups 450ml to Bengaluru', 'e7'));
  const conv = conversations.findConversationByPhone(p);
  assert.ok(conv.linked_enquiry_id);
  const qs = quotations.listQuotations({ conversation_id: conv.id });
  assert.ok(qs.length >= 1);
  const q = qs[0];
  assert.equal(q.status, 'draft');
  assert.equal(q.unit_price, 0);
  assert.equal(q.total_price, 0);
  assert.equal(q.quantity, 5000);
});

test('E2E scenario 8: price objection', async () => {
  const p = phone(8);
  await processWhatsAppWebhook(webhook(p, 'I need 1000 cold cups 450ml in Bengaluru. That seems expensive.', 'e8'));
  const conv = conversations.findConversationByPhone(p);
  assert.ok(conv.ai_reply);
  assert.ok(!/₹|\$|rs\.?\s*\d/i.test(conv.ai_reply));
});

test('E2E scenario 9: human handoff', async () => {
  const p = phone(9);
  await processWhatsAppWebhook(webhook(p, 'Please connect me to a human', 'e9'));
  const conv = conversations.findConversationByPhone(p);
  assert.ok(/representative|team/i.test(conv.ai_reply));
  const tasks = handoffs.listHandoffTasks({ conversation_id: conv.id });
  assert.ok(tasks.length >= 1);
  assert.equal(tasks[0].status, 'open');
});

test('E2E scenario 10: opt-out', async () => {
  const p = phone(10);
  await processWhatsAppWebhook(webhook(p, 'Please stop messaging me', 'e10'));
  const conv = conversations.findConversationByPhone(p);
  assert.equal(conv.status, 'opted_out');
  assert.equal(conv.ai_reply, '');
  const { findSuppressionForContact } = await import('../services/suppressions.js');
  assert.ok(findSuppressionForContact({ phone: p }));
});

test('E2E scenario 11: message after opt-out is suppressed', async () => {
  const p = phone(10);
  const result = await processWhatsAppWebhook(webhook(p, 'Hello again', 'e11'));
  assert.ok(result.messages[0].suppressed === true || result.messages[0].status === 'suppressed');
  const conv = conversations.findConversationByPhone(p);
  assert.equal(conv.status, 'opted_out');
  const msgs = conversations.readConversation(conv.id).messages;
  const outboundAi = msgs.filter((m) => m.direction === 'outbound' && m.source === 'ai_draft');
  // no new AI draft after opt-out
  assert.ok(outboundAi.length === 1 || outboundAi.length === 0);
});

test('E2E scenario 12a: invalid provider output falls back', async () => {
  const p = phone(12);
  // Force mock to return invalid JSON for this message
  const original = globalThis.__sipzyMockAiProvider;
  globalThis.__sipzyMockAiProvider = () => 'not json at all';
  const res = await ai.generateAiResponse({
    conversation: { status: 'active', last_message: 'INVALID_OUTPUT_TEST', missing_info: [] },
    requirements: { product_type: 'Cold', cup_size: '450ml', quantity: 1000, delivery_location: 'Bengaluru', missing_info: [] },
    lastMessage: 'INVALID_OUTPUT_TEST',
  });
  globalThis.__sipzyMockAiProvider = original;
  assert.equal(res.source, 'local');
  assert.equal(res.fallback, true);
  assert.ok(res.reply);
});

test('E2E scenario 12b: provider timeout falls back', async () => {
  const originalProvider = process.env.AI_PROVIDER;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.AI_PROVIDER = 'openai';
  process.env.OPENAI_API_KEY = 'test-key-not-real';
  process.env.AI_TIMEOUT_MS = '200';
  globalThis.fetch = async (_url, opts) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ reply: 'late', intent: 'general_enquiry', requirements: {}, proposed_actions: [] }) } }] }),
    }), 1000);
    if (opts && opts.signal) {
      opts.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      });
    }
  });
  const res = await ai.generateAiResponse({
    conversation: { status: 'active', last_message: 'Hello', missing_info: [] },
    requirements: { product_type: 'Cold', cup_size: '450ml', quantity: 1000, delivery_location: 'Bengaluru', missing_info: [] },
    lastMessage: 'Hello',
  });
  globalThis.fetch = originalFetch;
  process.env.AI_PROVIDER = originalProvider;
  process.env.OPENAI_API_KEY = originalKey;
  process.env.AI_TIMEOUT_MS = '200';
  assert.equal(res.source, 'local');
  assert.equal(res.fallback, true);
  assert.ok(res.reply);
});

test('two customers never mix history or requirements', async () => {
  const a = phone(21);
  const b = phone(22);
  await processWhatsAppWebhook(webhook(a, 'I need cold cups 250ml, 100 pieces', 'iso-a'));
  await processWhatsAppWebhook(webhook(b, 'I need hot cups 350ml, 200 pieces', 'iso-b'));
  const ca = conversations.findConversationByPhone(a);
  const cb = conversations.findConversationByPhone(b);
  assert.equal(ca.product_type, 'Cold');
  assert.equal(ca.cup_size, '250ml');
  assert.equal(ca.quantity, 100);
  assert.equal(cb.product_type, 'Hot');
  assert.equal(cb.cup_size, '350ml');
  assert.equal(cb.quantity, 200);
  const fullA = conversations.readConversation(ca.id);
  const fullB = conversations.readConversation(cb.id);
  assert.ok(fullA.messages.every((m) => !m.body.includes('hot cups 350')));
  assert.ok(fullB.messages.every((m) => !m.body.includes('cold cups 250')));
});

test('proposed actions are validated and malicious actions rejected', async () => {
  const validated = ai.validateProposedActions([
    { type: 'update_enquiry', fields: { quantity: 5, enquiry_status: 'confirmed-order' } },
    { type: 'drop_table', fields: { sql: 'DROP TABLE enquiries' } },
    { type: 'update_conversation_status', status: 'converted' },
    { type: 'prepare_quotation_draft', fields: { unit_price: 99, total_price: 999 } },
  ]);
  // confirmed-order status stripped, drop_table removed, converted removed,
  // and a quotation action containing only prices is dropped entirely.
  assert.equal(validated.length, 1);
  assert.ok(validated.every((a) => a.type !== 'drop_table'));
  const enquiryAction = validated.find((a) => a.type === 'update_enquiry');
  assert.ok(!('enquiry_status' in (enquiryAction?.fields || {})));
  assert.equal(validated.find((a) => a.type === 'prepare_quotation_draft'), undefined);
});

test('no confirmed order created without explicit confirmation', async () => {
  const enquiries = await import('../services/enquiries.js');
  const before = enquiries.listEnquiries().length;
  // attempting to create confirmed-order via analyzer path is blocked
  const built = (await import('../services/analyzer.js')).buildEnquiryFromAnalysis({ intent: 'quote_requested' }, { enquiry_status: 'confirmed-order' });
  assert.ok(built.errors.length > 0);
  assert.notEqual(built.data.enquiry_status, 'confirmed-order');
});

test('security defaults remain safe', () => {
  const cfg = ai.getAiConfig();
  assert.equal(cfg.provider, 'mock');
  // paid calls explicitly enabled only for this isolated test
  assert.equal(cfg.paid_calls_enabled, true);
  // production defaults checked separately
});