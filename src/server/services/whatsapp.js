import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { listLeads } from './leads.js';
import { analyzeMessage, buildEnquiryFromAnalysis } from './analyzer.js';
import { createEnquiry } from './enquiries.js';
import {
  findSuppressionForContact,
  normalizePhone,
  checkOutreachAllowed,
} from './suppressions.js';

const DEFAULT_API_VERSION = 'v26.0';
const REQUEST_TIMEOUT_MS = 15000;

class WhatsAppError extends Error {
  constructor(message, status = 500, code = 'whatsapp_error') {
    super(message);
    this.name = 'WhatsAppError';
    this.status = status;
    this.code = code;
  }
}

function readEnv(name) {
  const value = process.env[name];
  return value ? String(value).trim() : '';
}

function normalizeApiVersion(value) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_API_VERSION;
  return raw.startsWith('v') ? raw : `v${raw}`;
}

export function getWhatsAppApiVersion() {
  return normalizeApiVersion(process.env.WHATSAPP_API_VERSION);
}

export function getWhatsAppConfig() {
  const accessToken = readEnv('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = readEnv('WHATSAPP_PHONE_NUMBER_ID');
  const businessAccountId = readEnv('WHATSAPP_BUSINESS_ACCOUNT_ID');
  const appSecret = readEnv('WHATSAPP_APP_SECRET');
  const verifyToken = readEnv('WHATSAPP_VERIFY_TOKEN');

  const requiredPresent = Boolean(accessToken && phoneNumberId && appSecret && verifyToken);

  return {
    configured: requiredPresent,
    api_version: getWhatsAppApiVersion(),
    has_access_token: Boolean(accessToken),
    has_phone_number_id: Boolean(phoneNumberId),
    has_business_account_id: Boolean(businessAccountId),
    has_app_secret: Boolean(appSecret),
    has_verify_token: Boolean(verifyToken),
    sending_enabled: isSendingEnabled(),
    dry_run: isDryRun(),
    test_mode: isTestMode(),
    test_allowed_count: getTestAllowedNumbers().length,
    webhook_path: '/api/v1/whatsapp/webhook',
  };
}

export function validateWhatsAppConfig() {
  const errors = [];
  if (!readEnv('WHATSAPP_ACCESS_TOKEN')) errors.push('WHATSAPP_ACCESS_TOKEN is required');
  if (!readEnv('WHATSAPP_PHONE_NUMBER_ID')) errors.push('WHATSAPP_PHONE_NUMBER_ID is required');
  if (!readEnv('WHATSAPP_APP_SECRET')) errors.push('WHATSAPP_APP_SECRET is required');
  if (!readEnv('WHATSAPP_VERIFY_TOKEN')) errors.push('WHATSAPP_VERIFY_TOKEN is required');
  return errors;
}

export function getVerifyToken() {
  return readEnv('WHATSAPP_VERIFY_TOKEN');
}

function isDryRun() {
  return process.env.DRY_RUN !== 'false';
}

function isTestMode() {
  return process.env.TEST_MODE === 'true';
}

export function isSendingEnabled() {
  return process.env.WHATSAPP_SENDING_ENABLED === 'true' && !isDryRun();
}

function getTestAllowedNumbers() {
  return String(process.env.TEST_ALLOWED_NUMBERS || '')
    .split(',')
    .map((value) => normalizePhone(value))
    .filter(Boolean);
}

function assertConfig() {
  const errors = validateWhatsAppConfig();
  if (errors.length) {
    throw new WhatsAppError(errors.join('; '), 503, 'missing_config');
  }
}

export function verifyWebhookSignature(rawBody, signatureHeader) {
  const appSecret = readEnv('WHATSAPP_APP_SECRET');
  if (!appSecret) return false;
  if (!signatureHeader || !String(signatureHeader).startsWith('sha256=')) return false;

  const provided = String(signatureHeader).slice('sha256='.length).trim();
  let expected;
  try {
    expected = crypto.createHmac('sha256', appSecret).update(rawBody || '').digest('hex');
  } catch {
    return false;
  }

  if (!/^[0-9a-f]+$/i.test(provided) || provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function findLeadByPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return listLeads().find((lead) => normalizePhone(lead.phone) === normalized) || null;
}

function insertWebhookEvent(eventKey, eventType) {
  const db = getDb();
  try {
    db.prepare(
      'INSERT INTO whatsapp_webhook_events (id, event_key, event_type, created_at) VALUES (?, ?, ?, ?)'
    ).run(randomUUID(), eventKey, eventType, new Date().toISOString());
    return true;
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return false;
    throw err;
  }
}

function storeInboundMessage(record) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO whatsapp_messages
      (id, external_id, direction, phone, normalized_phone, contact_name, body, message_type, raw_payload, status, delivery_status, analysis_json, enquiry_id, lead_id, draft_reply, error, created_at, updated_at)
     VALUES (?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.external_id,
    record.phone,
    record.normalized_phone,
    record.contact_name,
    record.body,
    record.message_type,
    record.raw_payload,
    record.status,
    '',
    record.analysis_json || null,
    record.enquiry_id || null,
    record.lead_id || null,
    '',
    '',
    record.created_at || now,
    now
  );
  return readWhatsAppMessage(record.id);
}

export function readWhatsAppMessage(id) {
  return getDb().prepare('SELECT * FROM whatsapp_messages WHERE id = ?').get(id) || null;
}

export function listWhatsAppMessages(filters = {}) {
  const db = getDb();
  const { phone, enquiry_id: enquiryId, status, limit } = filters;
  let sql = 'SELECT * FROM whatsapp_messages';
  const params = [];
  const conditions = [];
  if (phone) {
    conditions.push('normalized_phone = ?');
    params.push(normalizePhone(phone) || String(phone).trim());
  }
  if (enquiryId) {
    conditions.push('enquiry_id = ?');
    params.push(enquiryId);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY created_at DESC';
  if (limit) {
    sql += ' LIMIT ?';
    params.push(Number(limit));
  }
  return db.prepare(sql).all(...params);
}

export function updateWhatsAppMessage(id, patch = {}) {
  const existing = readWhatsAppMessage(id);
  if (!existing) return null;
  const fields = [];
  const params = [];
  const set = (column, value) => {
    fields.push(`${column} = ?`);
    params.push(value);
  };
  if (patch.draft_reply !== undefined) set('draft_reply', String(patch.draft_reply || ''));
  if (patch.status !== undefined) set('status', String(patch.status || ''));
  if (patch.delivery_status !== undefined) set('delivery_status', String(patch.delivery_status || ''));
  if (patch.error !== undefined) set('error', String(patch.error || ''));
  if (!fields.length) return existing;
  set('updated_at', new Date().toISOString());
  params.push(id);
  getDb().prepare(`UPDATE whatsapp_messages SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return readWhatsAppMessage(id);
}

export async function processWhatsAppWebhook(payload = {}) {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  const results = { messages: [], statuses: [], duplicates: 0 };

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const messages = Array.isArray(value.messages) ? value.messages : [];
      const statuses = Array.isArray(value.statuses) ? value.statuses : [];

      for (const msg of messages) {
        const externalId = String(msg?.id || '').trim();
        if (!externalId) continue;

        const eventKey = `message:${externalId}`;
        if (!insertWebhookEvent(eventKey, 'message')) {
          results.duplicates += 1;
          continue;
        }

        const from = String(msg?.from || '').trim();
        const normalizedPhone = normalizePhone(from) || from;
        const contact = contacts.find((item) => String(item?.wa_id || '') === from) || contacts[0];
        const contactName = String(contact?.profile?.name || '').trim();
        const messageType = String(msg?.type || 'text').trim() || 'text';
        const body = messageType === 'text' ? String(msg?.text?.body || '') : '';
        const timestamp = msg?.timestamp
          ? new Date(Number(msg.timestamp) * 1000).toISOString()
          : new Date().toISOString();

        const suppression = findSuppressionForContact({ phone: normalizedPhone });
        const lead = findLeadByPhone(normalizedPhone);

        let analysis = null;
        let enquiry = null;
        let status = 'processed';
        let analysisJson = null;

        if (suppression) {
          status = 'suppressed';
        } else if (messageType === 'text' && body.trim()) {
          analysis = analyzeMessage(body);
          const overrides = {
            phone: from,
            customer_name: contactName || analysis.customer_name || '',
            lead_id: lead?.id,
          };
          const built = buildEnquiryFromAnalysis(analysis, overrides);
          if (!built.errors.length) {
            enquiry = createEnquiry(built.data);
            if (analysis.intent === 'opted_out') {
              status = 'opted_out';
            }
          } else {
            status = 'analysis_error';
          }
          analysisJson = JSON.stringify(analysis);
        } else {
          status = 'received';
        }

        // Campaign follow-up safety: any inbound reply stops pending
        // follow-ups for this contact. Opt-outs also cancel campaigns.
        try {
          const campaigns = await import('./campaigns.js');
          campaigns.handleInboundCampaignReply(from);
          if (status === 'opted_out' || suppression) {
            campaigns.cancelCampaignContactsByPhone(from, status === 'opted_out' ? 'opted_out' : 'suppressed');
          }
        } catch {
          // Campaign module is optional for inbound processing.
        }

        // AI conversation engine: create/update conversation and draft reply.
        let conversationResult = null;
        try {
          const conversations = await import('./conversations.js');
          conversationResult = await conversations.handleInboundWhatsAppMessage({
            from,
            contactName,
            body,
            lead,
            enquiry,
            messageId: externalId,
            status,
          });
        } catch {
          // Conversation engine is optional for inbound storage.
        }

        // Controlled test campaign: record inbound messages from explicitly
        // authorized test contacts in the activity log. General inbound
        // processing above is unchanged.
        try {
          const testCampaign = await import('./testCampaign.js');
          testCampaign.recordInboundTestMessage({
            phone: from,
            body,
            messageId: externalId,
            conversation: conversationResult,
            enquiry,
          });
        } catch {
          // Test-campaign logging is optional and must never block inbound.
        }

        const stored = storeInboundMessage({
          id: randomUUID(),
          external_id: externalId,
          phone: from,
          normalized_phone: normalizedPhone,
          contact_name: contactName,
          body,
          message_type: messageType,
          raw_payload: JSON.stringify(msg),
          status,
          analysis_json: analysisJson,
          enquiry_id: enquiry?.id || null,
          lead_id: lead?.id || null,
          created_at: timestamp,
        });

        results.messages.push({
          external_id: externalId,
          suppressed: Boolean(suppression),
          status,
          enquiry_id: enquiry?.id || null,
          analysis,
        });
      }

      for (const statusUpdate of statuses) {
        const externalId = String(statusUpdate?.id || '').trim();
        if (!externalId) continue;
        const eventKey = `status:${externalId}:${String(statusUpdate?.status || '')}`;
        if (!insertWebhookEvent(eventKey, 'status')) {
          results.duplicates += 1;
          continue;
        }

        const deliveryStatus = String(statusUpdate?.status || '').trim();
        const errorText = Array.isArray(statusUpdate?.errors)
          ? statusUpdate.errors.map((item) => item?.message || item?.code || '').filter(Boolean).join('; ')
          : '';
        getDb()
          .prepare(
            `UPDATE whatsapp_messages
             SET delivery_status = ?, status = CASE WHEN ? = 'failed' THEN 'failed' ELSE status END,
                 error = CASE WHEN ? <> '' THEN ? ELSE error END, updated_at = ?
             WHERE external_id = ?`
          )
          .run(deliveryStatus, deliveryStatus, errorText, errorText, new Date().toISOString(), externalId);

        results.statuses.push({ external_id: externalId, status: deliveryStatus });
      }
    }
  }

  return results;
}

export async function sendWhatsAppMessage(input = {}) {
  assertConfig();

  const type = String(input.type || 'text').trim().toLowerCase();
  const to = String(input.to || '').trim();
  const recipient = normalizePhone(to) || to.replace(/\D/g, '');
  if (!recipient) {
    throw new WhatsAppError('A valid recipient phone number is required', 400, 'validation_error');
  }

  if (!isSendingEnabled()) {
    return {
      sent: false,
      dry_run: isDryRun(),
      reason: 'sending_disabled',
      recipient,
      type,
    };
  }

  if (isTestMode()) {
    const allowed = getTestAllowedNumbers();
    if (!allowed.includes(recipient)) {
      throw new WhatsAppError('Recipient is not in TEST_ALLOWED_NUMBERS', 403, 'recipient_not_allowed');
    }
  }

  const outreach = checkOutreachAllowed({ phone: recipient });
  if (!outreach.allowed) {
    throw new WhatsAppError(
      `Outgoing WhatsApp message blocked: ${outreach.reason}`,
      403,
      'suppressed'
    );
  }

  const version = getWhatsAppApiVersion();
  const phoneNumberId = readEnv('WHATSAPP_PHONE_NUMBER_ID');
  const accessToken = readEnv('WHATSAPP_ACCESS_TOKEN');
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/messages`;

  let body;
  if (type === 'template') {
    const templateName = String(input.template_name || input.templateName || '').trim();
    const languageCode = String(input.language_code || input.languageCode || 'en_US').trim();
    if (!templateName) {
      throw new WhatsAppError('template_name is required for template messages', 400, 'validation_error');
    }
    body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components: Array.isArray(input.components) ? input.components : [],
      },
    };
  } else {
    const text = String(input.body || input.text || '').trim();
    if (!text) {
      throw new WhatsAppError('Message body is required', 400, 'validation_error');
    }
    body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'text',
      text: { body: text, preview_url: false },
    };
  }

  let response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {
    throw new WhatsAppError('WhatsApp service is unavailable', 503, 'network_error');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.error?.message || `WhatsApp request failed (HTTP ${response.status})`;
    if (response.status === 401 || response.status === 403) {
      throw new WhatsAppError('WhatsApp access token is invalid or expired', 403, 'invalid_token');
    }
    if (response.status === 429) {
      throw new WhatsAppError('WhatsApp quota or rate limit exceeded', 429, 'quota_exceeded');
    }
    throw new WhatsAppError(message, response.status >= 400 ? response.status : 502, 'api_error');
  }

  const messageId = payload?.messages?.[0]?.id || null;
  return {
    sent: true,
    dry_run: false,
    message_id: messageId,
    recipient,
    type,
  };
}

export { WhatsAppError };
export default {
  getWhatsAppConfig,
  validateWhatsAppConfig,
  getVerifyToken,
  isSendingEnabled,
  verifyWebhookSignature,
  processWhatsAppWebhook,
  listWhatsAppMessages,
  readWhatsAppMessage,
  updateWhatsAppMessage,
  sendWhatsAppMessage,
  WhatsAppError,
};