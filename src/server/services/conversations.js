import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { listLeads, readLead } from './leads.js';
import { createEnquiry, readEnquiry, updateEnquiry } from './enquiries.js';
import { normalizePhone, checkOutreachAllowed } from './suppressions.js';
import { analyzeMessage, buildEnquiryFromAnalysis } from './analyzer.js';
import * as ai from './ai.js';

const db = () => getDb();

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function rowToConversation(row) {
  if (!row) return null;
  return {
    ...row,
    missing_info: parseJson(row.missing_info, []),
    quantity: Number(row.quantity || 0),
    sample_required: row.sample_required === 1 || row.sample_required === true,
    price_enquiry: row.price_enquiry === 1 || row.price_enquiry === true,
    requires_template: row.requires_template === 1 || row.requires_template === true,
  };
}

export function findConversationByPhone(phone) {
  const normalized = normalizePhone(phone) || String(phone || '').trim();
  if (!normalized) return null;
  const row = db().prepare('SELECT * FROM conversations WHERE normalized_phone = ? ORDER BY updated_at DESC LIMIT 1').get(normalized);
  return rowToConversation(row);
}

export function readConversation(id) {
  const row = db().prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!row) return null;
  const conversation = rowToConversation(row);
  const messages = db().prepare('SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC').all(id);
  conversation.messages = messages.map((message) => ({
    ...message,
    metadata: parseJson(message.metadata, {}),
  }));
  return conversation;
}

export function listConversations(filters = {}) {
  const conditions = [];
  const params = [];
  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters.phone) {
    conditions.push('normalized_phone = ?');
    params.push(normalizePhone(filters.phone) || String(filters.phone).trim());
  }
  let sql = 'SELECT * FROM conversations';
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY updated_at DESC';
  if (filters.limit) {
    sql += ' LIMIT ?';
    params.push(Number(filters.limit));
  }
  return db().prepare(sql).all(...params).map(rowToConversation);
}

function leadForPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return listLeads().find((lead) => normalizePhone(lead.phone) === normalized) || null;
}

function createConversationRecord({ phone, lead = null, customerName = '' } = {}) {
  const id = crypto.randomUUID();
  const now = nowIso();
  const normalized = normalizePhone(phone) || String(phone || '').trim();
  db().prepare(
    `INSERT INTO conversations
      (id, lead_id, phone, normalized_phone, customer_name, business_name, business_category,
       product_type, cup_size, quantity, delivery_location, budget, sample_required, price_enquiry,
       purchase_timeline, missing_info, status, last_customer_message_at, last_message, ai_reply,
       reply_status, reply_approved_by, requires_template, linked_enquiry_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    lead?.id || null,
    String(phone || '').trim(),
    normalized,
    customerName || lead?.contact_person || '',
    lead?.business_name || '',
    lead?.business_cat || '',
    '', '', 0, '', '', 0, 0, '', '[]', 'new', null, '', '', 'draft', '', 0, null, now, now
  );
  return readConversation(id);
}

function appendMessage(conversationId, direction, body, source = 'whatsapp', metadata = {}) {
  db().prepare(
    `INSERT INTO conversation_messages (id, conversation_id, direction, body, source, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(crypto.randomUUID(), conversationId, direction, String(body || ''), source, JSON.stringify(metadata || {}), nowIso());
}

function statusFromIntent(intent, current) {
  if (current === 'converted') return current;
  switch (intent) {
    case 'opted_out': return 'opted_out';
    case 'not_interested': return 'not_interested';
    case 'sample_requested': return 'sample_requested';
    case 'quote_requested': return 'quote_requested';
    case 'interested': return 'interested';
    case 'more_information_requested': return 'active';
    default: return current === 'new' ? 'active' : current;
  }
}

function updateConversationRecord(id, patch = {}) {
  const existing = db().prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!existing) return null;
  const fields = [];
  const params = [];
  const set = (column, value) => {
    fields.push(`${column} = ?`);
    params.push(value);
  };
  const allowed = [
    'lead_id', 'customer_name', 'business_name', 'business_category', 'product_type', 'cup_size',
    'quantity', 'delivery_location', 'budget', 'sample_required', 'price_enquiry', 'purchase_timeline',
    'missing_info', 'status', 'last_customer_message_at', 'last_message', 'ai_reply', 'reply_status',
    'reply_approved_by', 'requires_template', 'linked_enquiry_id',
  ];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      if (key === 'missing_info') set(key, JSON.stringify(patch[key] || []));
      else if (key === 'sample_required' || key === 'price_enquiry' || key === 'requires_template') set(key, patch[key] ? 1 : 0);
      else set(key, patch[key]);
    }
  }
  if (!fields.length) return readConversation(id);
  set('updated_at', nowIso());
  params.push(id);
  db().prepare(`UPDATE conversations SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return readConversation(id);
}


export async function handleInboundWhatsAppMessage({ from, contactName, body, lead = null, enquiry = null, messageId = null, status = 'processed' } = {}) {
  const phone = String(from || '').trim();
  const normalized = normalizePhone(phone) || phone;
  const resolvedLead = lead || leadForPhone(normalized);

  let conversation = findConversationByPhone(normalized);
  if (!conversation) {
    conversation = createConversationRecord({
      phone,
      lead: resolvedLead,
      customerName: contactName,
    });
  }

  appendMessage(conversation.id, 'inbound', body, 'whatsapp', { messageId, status });

  const existingRequirements = {
    customer_name: conversation.customer_name,
    business_name: conversation.business_name,
    business_category: conversation.business_category,
    product_type: conversation.product_type,
    cup_size: conversation.cup_size,
    quantity: conversation.quantity,
    delivery_location: conversation.delivery_location,
    budget: conversation.budget,
    sample_required: conversation.sample_required,
    price_enquiry: conversation.price_enquiry,
    purchase_timeline: conversation.purchase_timeline,
  };

  const analysis = analyzeMessage(body);
  const extracted = ai.extractRequirements(body, existingRequirements);
  // preserve existing values when new extraction is empty
  const requirements = {
    customer_name: extracted.customer_name || conversation.customer_name || contactName || '',
    business_name: extracted.business_name || conversation.business_name || resolvedLead?.business_name || '',
    business_category: extracted.business_category || conversation.business_category || resolvedLead?.business_cat || '',
    product_type: extracted.product_type || conversation.product_type,
    cup_size: extracted.cup_size || conversation.cup_size,
    quantity: extracted.quantity || conversation.quantity,
    delivery_location: extracted.delivery_location || conversation.delivery_location,
    budget: extracted.budget || conversation.budget,
    sample_required: (extracted.sample_required || conversation.sample_required) ? 1 : 0,
    price_enquiry: (extracted.price_enquiry || conversation.price_enquiry) ? 1 : 0,
    purchase_timeline: extracted.purchase_timeline || conversation.purchase_timeline,
  };

  const newStatus = status === 'suppressed'
    ? conversation.status
    : (status === 'opted_out' ? 'opted_out' : statusFromIntent(analysis.intent, conversation.status));
  const lastCustomerAt = nowIso();
  const twentyFourHoursMs = 24 * 60 * 60 * 1000;
  const requiresTemplate = conversation.last_customer_message_at
    ? Date.now() - new Date(conversation.last_customer_message_at).getTime() > twentyFourHoursMs
    : false;

  // Generate AI draft reply unless opted out.
  let aiReply = '';
  let proposedActions = [];
  let aiIntent = null;
  let aiSource = 'local';
  let aiFallback = false;
  if (newStatus !== 'opted_out' && status !== 'suppressed') {
    const aiResult = await ai.generateAiResponse({
      conversation: { ...conversation, status: newStatus, last_message: body },
      requirements: { ...requirements, missing_info: extracted.missing_info },
      lastMessage: body,
      history: (conversation.messages || []).slice(-12),
    });
    aiReply = aiResult.reply || '';
    proposedActions = Array.isArray(aiResult.proposedActions) ? aiResult.proposedActions : [];
    aiIntent = aiResult.intent || null;
    aiSource = aiResult.source || 'local';
    aiFallback = Boolean(aiResult.fallback);
    if (aiResult.requirements && typeof aiResult.requirements === 'object') {
      for (const [k, v] of Object.entries(aiResult.requirements)) {
        if (v !== undefined && v !== null && v !== '' && v !== false) requirements[k] = v;
      }
    }
  }

  const updated = updateConversationRecord(conversation.id, {
    lead_id: resolvedLead?.id || conversation.lead_id,
    customer_name: requirements.customer_name,
    business_name: requirements.business_name,
    business_category: requirements.business_category,
    product_type: requirements.product_type,
    cup_size: requirements.cup_size,
    quantity: requirements.quantity,
    delivery_location: requirements.delivery_location,
    budget: requirements.budget,
    sample_required: requirements.sample_required,
    price_enquiry: requirements.price_enquiry,
    purchase_timeline: requirements.purchase_timeline,
    missing_info: ai.computeMissingInfo(requirements),
    status: newStatus,
    last_customer_message_at: lastCustomerAt,
    last_message: body,
    ai_reply: aiReply || '',
    reply_status: aiReply ? 'draft' : conversation.reply_status,
    requires_template: requiresTemplate,
  });

  // Link enquiry. Prefer the enquiry already created by WhatsApp processing to avoid duplicates.
  let linkedEnquiryId = enquiry?.id || updated.linked_enquiry_id || null;
  if (!linkedEnquiryId && status !== 'suppressed') {
    linkedEnquiryId = await ensureEnquiryAsync(updated, requirements);
  }
  if (linkedEnquiryId && linkedEnquiryId !== updated.linked_enquiry_id) {
    updateConversationRecord(updated.id, { linked_enquiry_id: linkedEnquiryId });
  }

  // Human handoff task when requested.
  if (/\b(human|person|agent|representative|call me|speak to someone|talk to (?:a )?person)\b/i.test(body)) {
    try {
      const handoffs = await import('./handoffs.js');
      if (!handoffs.findOpenHandoffTask(updated.id)) {
        handoffs.createHandoffTask({
          conversation_id: updated.id,
          enquiry_id: linkedEnquiryId || null,
          lead_id: updated.lead_id || null,
          customer_name: updated.customer_name,
          business_name: updated.business_name,
          reason: 'Customer requested a human salesperson',
          priority: 'high',
          status: 'open',
        });
      }
    } catch {
      // Handoff module is optional.
    }
  }

  // Apply AI-proposed, backend-validated business actions (never arbitrary).
  let appliedActions = [];
  if (proposedActions.length) {
    try {
      appliedActions = await applyAiProposedActions(updated, linkedEnquiryId, proposedActions);
    } catch {
      // Proposed actions are best-effort; never break message handling.
    }
  }

  if (aiReply) {
    appendMessage(updated.id, 'outbound', aiReply, 'ai_draft', {
      draft: true,
      intent: aiIntent,
      source: aiSource,
      fallback: aiFallback,
      proposed_actions: proposedActions,
      applied_actions: appliedActions,
    });
  }

  if (newStatus === 'opted_out') {
    try {
      const { registerOptOut } = await import('./suppressions.js');
      registerOptOut({ phone, source_message: body });
    } catch {}
  }

  return readConversation(updated.id);
}

async function ensureEnquiryAsync(conversation, requirements) {
  try {
    const { buildEnquiryFromAnalysis } = await import('./analyzer.js');
    if (conversation.linked_enquiry_id) {
      const enquiry = readEnquiry(conversation.linked_enquiry_id);
      if (enquiry) {
        updateEnquiry(enquiry.id, {
          customer_name: requirements.customer_name || conversation.customer_name || enquiry.customer_name,
          business_name: requirements.business_name || conversation.business_name || enquiry.business_name,
          phone: conversation.phone,
          product_type: requirements.product_type || enquiry.product_type,
          cup_size: requirements.cup_size || enquiry.cup_size,
          quantity: requirements.quantity || enquiry.quantity,
          delivery_location: requirements.delivery_location || enquiry.delivery_location,
          enquiry_status: conversation.status === 'opted_out' ? 'opted-out' : enquiry.enquiry_status,
        });
        return enquiry.id;
      }
    }

    if (conversation.status === 'suppressed') return conversation.linked_enquiry_id || null;
    const hasMeaningful = requirements.product_type || requirements.cup_size || requirements.quantity || requirements.delivery_location || conversation.status !== 'new';
    if (!hasMeaningful) return conversation.linked_enquiry_id || null;

    const analysis = analyzeMessage(conversation.last_message || '');
    const built = buildEnquiryFromAnalysis(analysis, {
      lead_id: conversation.lead_id,
      customer_name: requirements.customer_name || conversation.customer_name,
      business_name: requirements.business_name || conversation.business_name,
      phone: conversation.phone,
      product_type: requirements.product_type,
      cup_size: requirements.cup_size,
      quantity: requirements.quantity,
      delivery_location: requirements.delivery_location,
      enquiry_status: conversation.status === 'opted_out' ? 'opted-out' : undefined,
    });
    if (built.errors.length) return conversation.linked_enquiry_id || null;
    const enquiry = createEnquiry(built.data);
    return enquiry.id;
  } catch {
    return conversation.linked_enquiry_id || null;
  }
}

export function approveReply(id, approvedBy = 'dashboard') {
  const conversation = readConversation(id);
  if (!conversation) return null;
  if (conversation.status === 'opted_out') return conversation;
  return updateConversationRecord(id, {
    reply_status: 'approved',
    reply_approved_by: approvedBy,
  });
}

export function rejectReply(id, note = '') {
  const conversation = readConversation(id);
  if (!conversation) return null;
  appendMessage(conversation.id, 'system', note || 'Reply rejected', 'dashboard', { rejected: true });
  return updateConversationRecord(id, { reply_status: 'rejected' });
}

export async function regenerateReply(id) {
  const conversation = readConversation(id);
  if (!conversation) return null;
  if (conversation.status === 'opted_out' || conversation.status === 'opted-out') return conversation;
  const requirements = {
    customer_name: conversation.customer_name,
    business_name: conversation.business_name,
    business_category: conversation.business_category,
    product_type: conversation.product_type,
    cup_size: conversation.cup_size,
    quantity: conversation.quantity,
    delivery_location: conversation.delivery_location,
    budget: conversation.budget,
    sample_required: conversation.sample_required,
    price_enquiry: conversation.price_enquiry,
    purchase_timeline: conversation.purchase_timeline,
    missing_info: conversation.missing_info,
  };
  const aiResult = await ai.generateAiResponse({ conversation, requirements, lastMessage: conversation.last_message });
  const reply = aiResult.reply || '';
  return updateConversationRecord(id, { ai_reply: reply, reply_status: reply ? 'draft' : conversation.reply_status });
}

export function updateConversation(id, patch = {}) {
  return updateConversationRecord(id, patch);
}

export async function applyAiProposedActions(conversation, linkedEnquiryId, actions) {
  if (!conversation || !Array.isArray(actions)) return [];
  const applied = [];
  for (const action of actions) {
    let validated;
    try {
      const list = ai.validateProposedActions([action]);
      validated = list[0] || null;
    } catch {
      validated = null;
    }
    if (!validated) continue;
    try {
      if (validated.type === 'update_enquiry' && linkedEnquiryId) {
        const { updateEnquiry } = await import('./enquiries.js');
        updateEnquiry(linkedEnquiryId, validated.fields || {});
        applied.push(validated.type);
      } else if (validated.type === 'update_conversation_status') {
        updateConversationRecord(conversation.id, { status: validated.status });
        applied.push(validated.type);
      } else if (validated.type === 'create_handoff') {
        const handoffs = await import('./handoffs.js');
        if (!handoffs.findOpenHandoffTask(conversation.id)) {
          handoffs.createHandoffTask({
            conversation_id: conversation.id,
            enquiry_id: linkedEnquiryId || null,
            lead_id: conversation.lead_id || null,
            customer_name: conversation.customer_name,
            business_name: conversation.business_name,
            reason: validated.reason || 'AI proposed handoff',
            priority: validated.priority || 'normal',
            status: 'open',
          });
        }
        applied.push(validated.type);
      } else if (validated.type === 'prepare_quotation_draft') {
        const quotations = await import('./quotations.js');
        const f = validated.fields || {};
        const quantity = Number(f.quantity ?? conversation.quantity ?? 0);
        quotations.createQuotation({
          enquiry_id: linkedEnquiryId || null,
          conversation_id: conversation.id,
          lead_id: conversation.lead_id || null,
          product_type: f.product_type || conversation.product_type || '',
          cup_size: f.cup_size || conversation.cup_size || '',
          quantity: Number.isFinite(quantity) ? quantity : 0,
          unit_price: 0,
          delivery_charges: 0,
          total_price: 0,
          status: 'draft',
          notes: f.notes || 'AI-prepared draft; prices to be confirmed by the SIPZY team.',
        });
        applied.push(validated.type);
      } else if (validated.type === 'schedule_followup') {
        if (linkedEnquiryId) {
          const { updateEnquiry } = await import('./enquiries.js');
          updateEnquiry(linkedEnquiryId, { follow_up_date: validated.follow_up_date });
        }
        applied.push(validated.type);
      }
    } catch {
      // Ignore individual action failures.
    }
  }
  return applied;
}

export default {
  findConversationByPhone,
  readConversation,
  listConversations,
  handleInboundWhatsAppMessage,
  approveReply,
  rejectReply,
  regenerateReply,
  updateConversation,
  applyAiProposedActions,
};
