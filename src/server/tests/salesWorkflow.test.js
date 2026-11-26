import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbFile = path.join(os.tmpdir(), `sipzy-workflow-${process.pid}-${Date.now()}.db`);
process.env.SIPZY_DB_FILE = dbFile;
process.env.DRY_RUN = 'true';
process.env.WHATSAPP_SENDING_ENABLED = 'false';
process.env.AI_PROVIDER = 'local';

const { initDb, closeDb } = await import('../db/index.js');
initDb();

const conversations = await import('../services/conversations.js');
const salesWorkflow = await import('../services/salesWorkflow.js');
const handoffs = await import('../services/handoffs.js');
const quotations = await import('../services/quotations.js');
const orders = await import('../services/orders.js');
const { processWhatsAppWebhook } = await import('../services/whatsapp.js');
const suppressions = await import('../services/suppressions.js');

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

test('simulation: small juice stall 1000 cold cups 450ml', async () => {
  const result = await salesWorkflow.simulateConversation({
    phone: '919200000001',
    contactName: 'Ravi',
    messages: ['My name is Ravi. Need 1000 cold cups 450ml delivered to Bengaluru.'],
  });
  const conv = result.conversation;
  assert.equal(conv.product_type, 'Cold');
  assert.equal(conv.cup_size, '450ml');
  assert.equal(conv.quantity, 1000);
  assert.equal(conv.delivery_location, 'Bengaluru');
  assert.ok(conv.linked_enquiry_id);
  assert.ok(conv.ai_reply);
  assert.equal(conv.status !== 'opted_out', true);
});

test('simulation: tea stall 500 hot cups 250ml', async () => {
  const result = await salesWorkflow.simulateConversation({
    phone: '919200000002',
    messages: ['Need 500 hot cups 250ml for tea stall in Mysuru.'],
  });
  const conv = result.conversation;
  assert.equal(conv.product_type, 'Hot');
  assert.equal(conv.cup_size, '250ml');
  assert.equal(conv.quantity, 500);
});

test('simulation: cafe asks pricing', async () => {
  const result = await salesWorkflow.simulateConversation({
    phone: '919200000003',
    messages: ['What is the price for cold cups?'],
  });
  const conv = result.conversation;
  assert.ok(/cannot confirm pricing|team/i.test(conv.ai_reply));
});

test('simulation: restaurant requests samples', async () => {
  const result = await salesWorkflow.simulateConversation({
    phone: '919200000004',
    messages: ['Can I get samples of 350ml hot cups for my restaurant?'],
  });
  const conv = result.conversation;
  assert.equal(conv.sample_required, true);
  assert.ok(/sample/i.test(conv.ai_reply));
});

test('simulation: customer changes quantity', async () => {
  const result = await salesWorkflow.simulateConversation({
    phone: '919200000005',
    messages: ['Need 1000 cold cups 450ml in Bengaluru.', 'Actually make it 1500 cups.'],
  });
  const conv = result.conversation;
  assert.equal(conv.quantity, 1500);
  assert.equal(conv.product_type, 'Cold');
});

test('simulation: customer asks human creates handoff task', async () => {
  const result = await salesWorkflow.simulateConversation({
    phone: '919200000006',
    messages: ['Please connect me to a human salesperson.'],
  });
  const conv = result.conversation;
  const tasks = handoffs.listHandoffTasks({ conversation_id: conv.id });
  assert.ok(tasks.length >= 1);
  assert.equal(tasks[0].reason, 'Customer requested a human salesperson');
  assert.equal(tasks[0].priority, 'high');
});

test('simulation: not interested status', async () => {
  const result = await salesWorkflow.simulateConversation({
    phone: '919200000007',
    messages: ['I am not interested.'],
  });
  assert.equal(result.conversation.status, 'not_interested');
});

test('simulation: opt out', async () => {
  const result = await salesWorkflow.simulateConversation({
    phone: '919200000008',
    messages: ['Please stop messaging me.'],
  });
  assert.equal(result.conversation.status, 'opted_out');
  assert.equal(result.conversation.ai_reply, '');
  const suppression = suppressions.findSuppressionForContact({ phone: '919200000008' });
  assert.ok(suppression);
});

test('simulation: incomplete requirements', async () => {
  const result = await salesWorkflow.simulateConversation({
    phone: '919200000009',
    messages: ['I need some cups.'],
  });
  const conv = result.conversation;
  assert.ok(Array.isArray(conv.missing_info) && conv.missing_info.length > 0);
  assert.ok(conv.ai_reply && conv.ai_reply.endsWith('?'));
});

test('runScenario helper', async () => {
  const result = await salesWorkflow.runScenario('juice-stall-cold-cups', { phone: '919200000010' });
  assert.ok(result.conversation);
});

test('duplicate webhook does not duplicate enquiry', async () => {
  const phone = '919200000011';
  const first = await processWhatsAppWebhook(webhook(phone, 'Need 1000 hot cups 250ml in Mysuru.', 'dup1'));
  const second = await processWhatsAppWebhook(webhook(phone, 'Need 1000 hot cups 250ml in Mysuru.', 'dup1'));
  assert.equal(first.messages.length, 1);
  assert.equal(second.duplicates >= 1, true);
  const conv = conversations.findConversationByPhone(phone);
  assert.ok(conv.linked_enquiry_id);
});

test('quotation management and no invented prices', () => {
  const q = quotations.createQuotation({
    product_type: 'Cold',
    cup_size: '450ml',
    quantity: 1000,
    notes: 'draft only',
  });
  assert.equal(q.unit_price, 0);
  assert.equal(q.total_price, 0);
  const updated = quotations.updateQuotation(q.id, { unit_price: 5, delivery_charges: 100 });
  assert.equal(updated.unit_price, 5);
  assert.equal(updated.total_price, 5100);
  const approved = quotations.updateQuotation(q.id, { status: 'approved' });
  assert.equal(approved.status, 'approved');
  const sent = quotations.updateQuotation(q.id, { status: 'sent' });
  assert.equal(sent.status, 'sent');
});

test('order tracking transitions and confirmed sales count', () => {
  const before = orders.countConfirmedOrders();
  const order = orders.createOrder({ product_type: 'Cold', cup_size: '450ml', quantity: 1000, status: 'pending_confirmation' });
  assert.equal(order.status, 'pending_confirmation');
  orders.updateOrder(order.id, { status: 'confirmed' });
  const afterCount = orders.countConfirmedOrders();
  assert.equal(afterCount, before + 1);
  const cancelled = orders.createOrder({ product_type: 'Hot', cup_size: '250ml', quantity: 100, status: 'cancelled' });
  assert.equal(cancelled.status, 'cancelled');
});

test('handoff task fields', () => {
  const task = handoffs.createHandoffTask({
    assigned_to: 'sales1',
    customer_name: 'Ravi',
    business_name: 'Juice Stall',
    reason: 'Requested human',
    priority: 'urgent',
    status: 'open',
    due_date: '2026-01-01',
    notes: 'Call back',
  });
  assert.equal(task.assigned_to, 'sales1');
  assert.equal(task.priority, 'urgent');
  assert.equal(task.status, 'open');
  const updated = handoffs.updateHandoffTask(task.id, { status: 'completed', notes: 'Done' });
  assert.equal(updated.status, 'completed');
});

test('sales funnel returns metrics', () => {
  const funnel = salesWorkflow.getSalesFunnel();
  assert.ok(typeof funnel.leadsDiscovered === 'number');
  assert.ok(typeof funnel.confirmedOrders === 'number');
  assert.ok(funnel.totals);
});

test('provider config remains local and disabled', async () => {
  const ai = await import('../services/ai.js');
  const config = ai.getAiConfig();
  assert.equal(config.provider, 'local');
  assert.equal(config.paid_calls_enabled, false);
});