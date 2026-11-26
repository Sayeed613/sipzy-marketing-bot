import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { normalizePhone, checkOutreachAllowed } from './suppressions.js';
import { createActivity } from './activity.js';
import { readLead } from './leads.js';
import { readTemplate, listTemplates, renderTemplate } from './campaigns.js';
import { getAiConfig } from './ai.js';
import { isSendingEnabled } from './whatsapp.js';

/**
 * Controlled end-to-end WhatsApp sales test.
 *
 * This is deliberately separate from the general campaign engine:
 *  - it never writes to outreach_queue
 *  - it never starts or depends on the background scheduler
 *  - it only sends the initial approved template to explicitly configured
 *    numbers that are also marked authorized in test_campaign_contacts
 *  - every send/receive is written to the activity log with test: refs
 */

const db = () => getDb();

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function isTestCampaignEnabled() {
  return process.env.TEST_CAMPAIGN_MODE_ENABLED === 'true';
}

export function configuredTestNumbers() {
  return String(process.env.TEST_ALLOWED_NUMBERS || '')
    .split(',')
    .map((value) => normalizePhone(value))
    .filter(Boolean);
}

export function isConfiguredTestNumber(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;
  return configuredTestNumbers().includes(normalized);
}

function rowToContact(row) {
  if (!row) return null;
  return {
    ...row,
    authorized: row.authorized === 1 || row.authorized === true,
    business_name: row.business_name || '',
  };
}

function rowToRun(row) {
  if (!row) return null;
  return { ...row, skipped: parseJson(row.skipped_json, []) };
}

export function listTestContacts() {
  return db()
    .prepare(
      `SELECT tc.*, COALESCE(l.business_name, '') AS business_name
       FROM test_campaign_contacts tc
       LEFT JOIN leads l ON l.id = tc.lead_id
       ORDER BY tc.created_at ASC`
    )
    .all()
    .map(rowToContact);
}

export function readTestContact(id) {
  return rowToContact(
    db()
      .prepare(
        `SELECT tc.*, COALESCE(l.business_name, '') AS business_name
         FROM test_campaign_contacts tc
         LEFT JOIN leads l ON l.id = tc.lead_id
         WHERE tc.id = ?`
      )
      .get(id)
  );
}

export function upsertTestContact(input = {}) {
  const phone = String(input.phone || '').trim();
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error('A valid phone number is required');
  if (!isConfiguredTestNumber(normalized)) {
    throw new Error('Phone number is not in TEST_ALLOWED_NUMBERS');
  }

  const leadId = input.lead_id ? String(input.lead_id).trim() : null;
  if (leadId && !readLead(leadId)) throw new Error('lead_id does not exist');

  const name = String(input.name || '').trim().slice(0, 120);
  const notes = String(input.notes || '').trim().slice(0, 1000);
  const actor = String(input.actor || 'dashboard').trim().slice(0, 120);
  const now = nowIso();

  const existing = db()
    .prepare('SELECT * FROM test_campaign_contacts WHERE normalized_phone = ?')
    .get(normalized);
  const authorized = input.authorized === undefined
    ? (existing ? existing.authorized : 0)
    : (input.authorized === true ? 1 : 0);

  if (existing) {
    db().prepare(
      `UPDATE test_campaign_contacts
       SET phone = ?, name = ?, lead_id = ?, authorized = ?, authorized_by = ?,
           authorized_at = CASE WHEN ? = 1 THEN COALESCE(authorized_at, ?) ELSE NULL END,
           notes = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      phone,
      name || existing.name,
      leadId ?? existing.lead_id,
      authorized,
      authorized ? actor : '',
      authorized,
      authorized ? now : null,
      notes || existing.notes,
      now,
      existing.id
    );
    return readTestContact(existing.id);
  }

  const id = crypto.randomUUID();
  db().prepare(
    `INSERT INTO test_campaign_contacts
      (id, phone, normalized_phone, name, lead_id, authorized, authorized_by,
       authorized_at, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    phone,
    normalized,
    name,
    leadId,
    authorized,
    authorized ? actor : '',
    authorized ? now : null,
    notes,
    now,
    now
  );
  return readTestContact(id);
}

export function setTestContactAuthorization(id, authorized, actor = 'dashboard') {
  const existing = readTestContact(id);
  if (!existing) return null;
  if (authorized && !isConfiguredTestNumber(existing.phone)) {
    throw new Error('Phone number is not in TEST_ALLOWED_NUMBERS');
  }
  const now = nowIso();
  db().prepare(
    `UPDATE test_campaign_contacts
     SET authorized = ?, authorized_by = ?, authorized_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    authorized ? 1 : 0,
    authorized ? String(actor || 'dashboard').slice(0, 120) : '',
    authorized ? now : null,
    now,
    id
  );
  return readTestContact(id);
}

export function deleteTestContact(id) {
  return db().prepare('DELETE FROM test_campaign_contacts WHERE id = ?').run(id).changes > 0;
}

function schedulerEnabled() {
  const row = db().prepare("SELECT value FROM campaign_settings WHERE key = 'scheduler_enabled'").get();
  return row?.value === 'true';
}

export function getTestCampaignConfig() {
  const ai = getAiConfig();
  return {
    enabled: isTestCampaignEnabled(),
    test_mode: process.env.TEST_MODE === 'true',
    allowed_test_numbers: configuredTestNumbers().length,
    sending_enabled: isSendingEnabled(),
    dry_run: process.env.DRY_RUN !== 'false',
    ai_provider: ai.provider,
    ai_paid_calls_enabled: ai.paid_calls_enabled,
    ai_network_calls: ai.network_calls,
    scheduler_enabled: schedulerEnabled(),
    whatsapp_configured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
  };
}

function resolveApprovedTemplate(input = {}) {
  let template = input.template_id ? readTemplate(input.template_id) : null;
  if (!template && input.template_name) {
    template =
      listTemplates({ channel: 'whatsapp', status: 'approved' }).find(
        (item) => item.whatsapp_template_name === String(input.template_name).trim()
      ) || null;
  }
  if (!template) throw new Error('An approved WhatsApp template is required');
  if (template.channel !== 'whatsapp') throw new Error('The template must be a WhatsApp template');
  if (template.status !== 'approved' || template.whatsapp_template_status !== 'approved') {
    throw new Error('The WhatsApp template must be approved before starting a test');
  }
  if (!template.whatsapp_template_name) {
    throw new Error('The template is missing its WhatsApp template name');
  }
  return template;
}

function eligibleTestContacts() {
  const configured = new Set(configuredTestNumbers());
  const contacts = listTestContacts();
  const eligible = [];
  const skipped = [];

  for (const contact of contacts) {
    if (!contact.authorized) {
      skipped.push({ phone: contact.phone, reason: 'not_authorized' });
      continue;
    }
    if (!configured.has(contact.normalized_phone)) {
      skipped.push({ phone: contact.phone, reason: 'not_in_test_allowed_numbers' });
      continue;
    }
    const outreach = checkOutreachAllowed({ phone: contact.phone, lead_id: contact.lead_id });
    if (!outreach.allowed) {
      skipped.push({ phone: contact.phone, reason: outreach.reason || 'suppressed' });
      continue;
    }
    eligible.push(contact);
  }

  return { eligible, skipped };
}

async function sendInitialTemplate({ contact, template, languageCode, components }) {
  if (!isSendingEnabled()) {
    return {
      sent: false,
      dry_run: true,
      reason: 'sending_disabled',
    };
  }

  try {
    const { sendWhatsAppMessage } = await import('./whatsapp.js');
    return await sendWhatsAppMessage({
      to: contact.phone,
      type: 'template',
      template_name: template.whatsapp_template_name,
      language_code: languageCode || 'en_US',
      components: Array.isArray(components) ? components : [],
    });
  } catch (err) {
    return { sent: false, failed: true, reason: err.message || 'send_failed' };
  }
}

function logOutbound({ runId, contact, template, result }) {
  const status = result.sent ? 'sent' : result.failed ? 'failed' : 'dry_run';
  const preview = renderTemplate(template, {
    business_name: contact.business_name || contact.name || '',
    contact_person: contact.name || '',
  });
  const activity = {
    channel: 'whatsapp',
    activity_type: 'message',
    message_ref: `test:outbound:${runId}:${contact.id}`,
    delivery_status: result.sent ? 'sent' : result.failed ? 'failed' : 'pending',
    notes: JSON.stringify({
      test_mode: true,
      test_campaign_run_id: runId,
      direction: 'outbound',
      phone: contact.phone,
      contact_name: contact.name || '',
      template_id: template.id,
      template_name: template.whatsapp_template_name,
      template_preview: preview,
      status,
      reason: result.reason || null,
      message_id: result.message_id || null,
    }),
  };
  if (contact.lead_id) activity.lead_id = contact.lead_id;
  createActivity(activity);
}

function latestRun() {
  return rowToRun(
    db().prepare('SELECT * FROM test_campaign_runs ORDER BY created_at DESC LIMIT 1').get()
  );
}

export function listTestActivity(limit = 100) {
  return db()
    .prepare("SELECT * FROM activity WHERE message_ref LIKE 'test:%' ORDER BY activity_date DESC LIMIT ?")
    .all(Math.min(Math.max(Number(limit) || 100, 1), 500))
    .map((row) => ({ ...row, notes_json: parseJson(row.notes, {}) }));
}

export function getTestCampaignState() {
  const { eligible, skipped } = eligibleTestContacts();
  return {
    config: getTestCampaignConfig(),
    run: latestRun(),
    contacts: listTestContacts(),
    eligible_contacts: eligible,
    skipped_contacts: skipped,
    recent_activity: listTestActivity(100),
  };
}

export async function startTestCampaign(input = {}) {
  if (!isTestCampaignEnabled()) {
    throw new Error('Test campaign mode is disabled. Set TEST_CAMPAIGN_MODE_ENABLED=true.');
  }

  const active = db()
    .prepare("SELECT id FROM test_campaign_runs WHERE status = 'running' ORDER BY created_at DESC LIMIT 1")
    .get();
  if (active) throw new Error('A test campaign is already running. Stop it first.');

  const template = resolveApprovedTemplate(input);
  const { eligible, skipped } = eligibleTestContacts();
  if (!eligible.length) {
    throw new Error(
      `No eligible test recipients. ${skipped.length} contact(s) were skipped because they are not authorized, not in TEST_ALLOWED_NUMBERS, or suppressed.`
    );
  }

  const runId = crypto.randomUUID();
  const now = nowIso();
  db().prepare(
    `INSERT INTO test_campaign_runs
      (id, status, template_id, template_name, language_code, recipients_total,
       recipients_sent, recipients_dry_run, recipients_failed, skipped_json,
       last_error, started_by, started_at, created_at, updated_at)
     VALUES (?, 'running', ?, ?, ?, ?, 0, 0, 0, ?, '', ?, ?, ?, ?)`
  ).run(
    runId,
    template.id,
    template.whatsapp_template_name,
    String(input.language_code || 'en_US').trim() || 'en_US',
    eligible.length,
    JSON.stringify(skipped),
    String(input.actor || 'dashboard').slice(0, 120),
    now,
    now,
    now
  );

  let sent = 0;
  let dryRun = 0;
  let failed = 0;
  let lastError = '';

  for (const contact of eligible) {
    const result = await sendInitialTemplate({
      contact,
      template,
      languageCode: input.language_code,
      components: input.components,
    });
    if (result.sent) sent += 1;
    else if (result.failed) {
      failed += 1;
      if (!lastError) lastError = String(result.reason || 'send_failed').slice(0, 500);
    } else dryRun += 1;
    logOutbound({ runId, contact, template, result });
  }

  const status = failed === eligible.length ? 'stopped' : 'running';
  db().prepare(
    `UPDATE test_campaign_runs
     SET status = ?, recipients_sent = ?, recipients_dry_run = ?, recipients_failed = ?,
         last_error = ?, stopped_at = CASE WHEN ? = 'stopped' THEN ? ELSE NULL END, updated_at = ?
     WHERE id = ?`
  ).run(status, sent, dryRun, failed, lastError, status, status === 'stopped' ? nowIso() : null, nowIso(), runId);

  return getTestCampaignState();
}

export function stopTestCampaign(actor = 'dashboard') {
  const active = db()
    .prepare("SELECT * FROM test_campaign_runs WHERE status = 'running' ORDER BY created_at DESC LIMIT 1")
    .get();
  if (active) {
    const now = nowIso();
    db().prepare(
      `UPDATE test_campaign_runs
       SET status = 'stopped', stopped_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(now, now, active.id);
  }
  return getTestCampaignState();
}

export function findAuthorizedTestContact(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return rowToContact(
    db()
      .prepare(
        `SELECT tc.*, COALESCE(l.business_name, '') AS business_name
         FROM test_campaign_contacts tc
         LEFT JOIN leads l ON l.id = tc.lead_id
         WHERE tc.normalized_phone = ? AND tc.authorized = 1`
      )
      .get(normalized)
  );
}

export function recordInboundTestMessage({ phone, body, messageId, conversation, enquiry } = {}) {
  if (!isTestCampaignEnabled()) return null;
  const contact = findAuthorizedTestContact(phone);
  if (!contact) return null;

  const ref = `test:inbound:${messageId || crypto.randomUUID()}`;
  const existing = db().prepare('SELECT id FROM activity WHERE message_ref = ?').get(ref);
  if (existing) return null;

  const latestOutbound = Array.isArray(conversation?.messages)
    ? [...conversation.messages].reverse().find((m) => m.direction === 'outbound' && m.source === 'ai_draft')
    : null;
  const metadata = latestOutbound?.metadata && typeof latestOutbound.metadata === 'object'
    ? latestOutbound.metadata
    : {};

  const activityInput = {
    channel: 'whatsapp',
    activity_type: 'message',
    message_ref: ref,
    delivery_status: 'delivered',
    notes: JSON.stringify({
      test_mode: true,
      direction: 'inbound',
      phone: contact.phone,
      contact_name: contact.name || '',
      body: String(body || '').slice(0, 4000),
      conversation_id: conversation?.id || null,
      enquiry_id: enquiry?.id || conversation?.linked_enquiry_id || null,
      ai_reply: conversation?.ai_reply || '',
      proposed_actions: metadata.proposed_actions || [],
      applied_actions: metadata.applied_actions || [],
      intent: metadata.intent || null,
    }),
  };
  if (contact.lead_id) activityInput.lead_id = contact.lead_id;
  const activity = createActivity(activityInput);

  // A stopped/active test run does not need its status changed by an inbound
  // reply, but the activity row keeps the full audit trail.
  return activity;
}

export default {
  isTestCampaignEnabled,
  configuredTestNumbers,
  isConfiguredTestNumber,
  listTestContacts,
  readTestContact,
  upsertTestContact,
  setTestContactAuthorization,
  deleteTestContact,
  getTestCampaignConfig,
  getTestCampaignState,
  startTestCampaign,
  stopTestCampaign,
  listTestActivity,
  findAuthorizedTestContact,
  recordInboundTestMessage,
};
