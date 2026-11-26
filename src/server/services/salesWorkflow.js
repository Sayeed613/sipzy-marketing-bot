import { handleInboundWhatsAppMessage } from './conversations.js';
import { listLeads } from './leads.js';
import { listEnquiries } from './enquiries.js';
import { listConversations } from './conversations.js';
import { listQuotations } from './quotations.js';
import { listOrders } from './orders.js';
import { listHandoffTasks } from './handoffs.js';

const SCENARIOS = {
  'juice-stall-cold-cups': ['My name is Ravi. I run a juice stall. Need 1000 cold cups 450ml delivered to Bengaluru.'],
  'tea-stall-hot-cups': ['I need 500 hot cups 250ml for my tea stall in Mysuru.'],
  'cafe-pricing': ['What is the price for cold cups?'],
  'restaurant-samples': ['Can I get samples of 350ml hot cups for my restaurant?'],
  'quantity-change': ['Need 1000 cold cups 450ml in Bengaluru.', 'Actually change quantity to 1500 cups.'],
  'human-request': ['Please connect me to a human salesperson.'],
  'not-interested': ['I am not interested, thanks.'],
  'opt-out': ['Please stop messaging me.'],
  'incomplete': ['I need some cups.'],
};

export function listScenarios() {
  return Object.keys(SCENARIOS).map((key) => ({ id: key, messages: SCENARIOS[key] }));
}

export async function simulateConversation({ phone, contactName = 'Simulated Customer', businessName = '', messages = [] } = {}) {
  const normalizedPhone = phone || `9199${Date.now().toString().slice(-7)}`;
  const steps = [];
  for (const body of messages) {
    const conversation = await handleInboundWhatsAppMessage({
      from: normalizedPhone,
      contactName,
      body,
      status: 'processed',
    });
    steps.push(conversation);
  }
  return {
    phone: normalizedPhone,
    contactName,
    businessName,
    steps,
    conversation: steps.length ? steps[steps.length - 1] : null,
    simulated: true,
    sending_disabled: true,
  };
}

export async function runScenario(scenarioId, options = {}) {
  const messages = SCENARIOS[scenarioId];
  if (!messages) throw new Error(`Unknown scenario: ${scenarioId}`);
  return simulateConversation({ ...options, messages });
}

export function getSalesFunnel() {
  const leads = listLeads();
  const enquiries = listEnquiries({});
  const conversations = listConversations({});
  const quotations = listQuotations({});
  const orders = listOrders({});
  const eligibleLeads = leads.filter((lead) => lead.quality_outreach_ready || lead.approved_for_outreach === 1 || lead.approved_for_outreach === true).length;
  const contacted = leads.filter((lead) => ['contacted', 'quoted', 'won'].includes(String(lead.outreach_status || ''))).length;
  const interested = conversations.filter((c) => ['interested', 'quote_requested', 'sample_requested', 'active'].includes(String(c.status || ''))).length;
  const quoteRequests = enquiries.filter((e) => ['quote-requested', 'quotation-sent', 'sample-requested'].includes(String(e.enquiry_status || ''))).length;
  const quotationsSent = quotations.filter((q) => ['sent', 'accepted', 'approved'].includes(String(q.status || ''))).length;
  const confirmedOrders = orders.filter((o) => ['confirmed', 'production', 'dispatched', 'delivered'].includes(String(o.status || ''))).length;
  return {
    leadsDiscovered: leads.length,
    eligibleLeads,
    contacted,
    replies: conversations.length,
    interested,
    quoteRequests,
    quotationsSent,
    confirmedOrders,
    totals: {
      enquiries: enquiries.length,
      conversations: conversations.length,
      quotations: quotations.length,
      orders: orders.length,
      handoffTasks: listHandoffTasks({}).length,
    },
  };
}

export default { listScenarios, simulateConversation, runScenario, getSalesFunnel };