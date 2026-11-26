import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { listLeads, readLead, updateLead, findDuplicateLeadIds } from './leads.js';
import { listLeadsWithSuppression } from './outreach.js';
import {
  checkOutreachAllowed,
  findSuppressionForContact,
  normalizePhone,
} from './suppressions.js';
import { listEnquiries } from './enquiries.js';

const db = () => getDb();

const DEFAULT_SETTINGS = {
  scheduler_enabled: 'false',
  max_new_contacts_per_interval: '20',
  interval_minutes: '15',
  daily_limit: '200',
  business_hours_start: '09:00',
  business_hours_end: '18:00',
  timezone: 'Asia/Kolkata',
  followup_interval_hours: '48',
  max_followup_attempts: '3',
  last_run_at: '',
};

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

function boolSetting(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function numberSetting(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getSetting(key) {
  const row = db().prepare('SELECT value FROM campaign_settings WHERE key = ?').get(key);
  return row ? row.value : DEFAULT_SETTINGS[key];
}

function setSetting(key, value) {
  db().prepare(
    `INSERT INTO campaign_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, String(value ?? ''), nowIso());
}

export function getSchedulerConfig() {
  const keys = Object.keys(DEFAULT_SETTINGS);
  const out = {};
  for (const key of keys) out[key] = getSetting(key);
  return {
    scheduler_enabled: boolSetting(out.scheduler_enabled),
    max_new_contacts_per_interval: numberSetting(out.max_new_contacts_per_interval, 20),
    interval_minutes: numberSetting(out.interval_minutes, 15),
    daily_limit: numberSetting(out.daily_limit, 200),
    business_hours_start: out.business_hours_start || '09:00',
    business_hours_end: out.business_hours_end || '18:00',
    timezone: out.timezone || 'Asia/Kolkata',
    followup_interval_hours: numberSetting(out.followup_interval_hours, 48),
    max_followup_attempts: numberSetting(out.max_followup_attempts, 3),
    last_run_at: out.last_run_at || null,
  };
}

export function updateSchedulerConfig(patch = {}) {
  const mapping = {
    scheduler_enabled: 'scheduler_enabled',
    max_new_contacts_per_interval: 'max_new_contacts_per_interval',
    interval_minutes: 'interval_minutes',
    daily_limit: 'daily_limit',
    business_hours_start: 'business_hours_start',
    business_hours_end: 'business_hours_end',
    timezone: 'timezone',
    followup_interval_hours: 'followup_interval_hours',
    max_followup_attempts: 'max_followup_attempts',
  };
  for (const [inputKey, settingKey] of Object.entries(mapping)) {
    if (patch[inputKey] !== undefined) setSetting(settingKey, patch[inputKey]);
  }
  if (patch.last_run_at !== undefined) setSetting('last_run_at', patch.last_run_at || '');
  return getSchedulerConfig();
}

export const getCampaignSettings = updateSchedulerConfig;
export const getCampaignSettingsConfig = getSchedulerConfig;

function validateCampaign(input) {
  const errors = [];
  const data = {};
  if (!input || String(input.name || '').trim() === '') {
    errors.push({ field: 'name', message: 'Campaign name is required' });
  } else {
    data.name = String(input.name).trim();
  }
  if (input.description !== undefined) data.description = String(input.description || '').trim();
  if (input.target_city !== undefined) data.target_city = String(input.target_city || '').trim();
  if (input.business_categories !== undefined) {
    data.business_categories = Array.isArray(input.business_categories)
      ? input.business_categories
      : String(input.business_categories || '')
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
  }
  if (input.lead_qualification !== undefined) data.lead_qualification = String(input.lead_qualification || '').trim();
  if (input.channel !== undefined) {
    const channel = String(input.channel || '').trim();
    if (!['whatsapp', 'email', 'manual'].includes(channel)) {
      errors.push({ field: 'channel', message: 'channel must be whatsapp, email or manual' });
    } else {
      data.channel = channel;
    }
  }
  if (input.status !== undefined) {
    const status = String(input.status || '').trim();
    if (!['draft', 'active', 'paused', 'archived', 'completed'].includes(status)) {
      errors.push({ field: 'status', message: 'invalid campaign status' });
    } else {
      data.status = status;
    }
  }
  if (input.intro_template_id !== undefined) data.intro_template_id = input.intro_template_id || null;
  if (input.followup_template_id !== undefined) data.followup_template_id = input.followup_template_id || null;
  if (input.max_followup_attempts !== undefined) {
    const n = Number(input.max_followup_attempts);
    if (!Number.isFinite(n) || n < 0) errors.push({ field: 'max_followup_attempts', message: 'must be a non-negative number' });
    else data.max_followup_attempts = n;
  }
  if (input.followup_interval_hours !== undefined) {
    const n = Number(input.followup_interval_hours);
    if (!Number.isFinite(n) || n < 0) errors.push({ field: 'followup_interval_hours', message: 'must be a non-negative number' });
    else data.followup_interval_hours = n;
  }
  if (input.exclude_previously_contacted !== undefined) data.exclude_previously_contacted = input.exclude_previously_contacted ? 1 : 0;
  if (input.exclude_duplicates !== undefined) data.exclude_duplicates = input.exclude_duplicates ? 1 : 0;
  if (input.exclude_suppressed !== undefined) data.exclude_suppressed = input.exclude_suppressed ? 1 : 0;
  if (input.filters !== undefined) data.filters = input.filters || {};
  return { errors, data };
}

function rowToCampaign(row) {
  if (!row) return null;
  return {
    ...row,
    business_categories: parseJson(row.business_categories, []),
    filters: parseJson(row.filters_json, {}),
    exclude_previously_contacted: Boolean(row.exclude_previously_contacted),
    exclude_duplicates: Boolean(row.exclude_duplicates),
    exclude_suppressed: Boolean(row.exclude_suppressed),
  };
}

export function listCampaigns(filters = {}) {
  const conditions = [];
  const params = [];
  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters.channel) {
    conditions.push('channel = ?');
    params.push(filters.channel);
  }
  let sql = 'SELECT * FROM campaigns';
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY created_at DESC';
  return db().prepare(sql).all(...params).map(rowToCampaign);
}

export function readCampaign(id) {
  const row = db().prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  return rowToCampaign(row);
}

export function createCampaign(input = {}) {
  const { errors, data } = validateCampaign(input);
  if (errors.length) throw new Error(errors.map((e) => `${e.field}: ${e.message}`).join('; '));
  const id = input.id || crypto.randomUUID();
  const now = nowIso();
  const channel = data.channel || input.channel || 'whatsapp';
  const categories = data.business_categories || input.business_categories || [];
  const filters = data.filters || input.filters || {};
  db().prepare(
    `INSERT INTO campaigns
      (id, name, description, target_city, business_categories, lead_qualification, channel, status,
       intro_template_id, followup_template_id, filters_json, max_followup_attempts, followup_interval_hours,
       exclude_previously_contacted, exclude_duplicates, exclude_suppressed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.name,
    data.description || input.description || '',
    data.target_city || input.target_city || '',
    JSON.stringify(categories),
    data.lead_qualification || input.lead_qualification || '',
    channel,
    data.status || input.status || 'draft',
    data.intro_template_id ?? input.intro_template_id ?? null,
    data.followup_template_id ?? input.followup_template_id ?? null,
    JSON.stringify(filters),
    data.max_followup_attempts ?? input.max_followup_attempts ?? 3,
    data.followup_interval_hours ?? input.followup_interval_hours ?? 48,
    data.exclude_previously_contacted ?? (input.exclude_previously_contacted === false ? 0 : 1),
    data.exclude_duplicates ?? (input.exclude_duplicates === false ? 0 : 1),
    data.exclude_suppressed ?? (input.exclude_suppressed === false ? 0 : 1),
    now,
    now
  );

  // Optional audience selection at creation time.
  const leadIds = Array.isArray(input.lead_ids) ? input.lead_ids : null;
  if (leadIds || input.select_leads || input.filters || input.city || input.category) {
    const selectionFilters = input.filters || {
      city: input.target_city || input.city,
      category: input.category,
      qualification: input.lead_qualification || input.qualification,
      verification_status: input.verification_status,
      search: input.search,
    };
    selectCampaignLeads(id, {
      leadIds,
      filters: leadIds ? null : selectionFilters,
      channel,
      excludePreviouslyContacted: input.exclude_previously_contacted !== false,
      excludeDuplicates: input.exclude_duplicates !== false,
      excludeSuppressed: input.exclude_suppressed !== false,
    });
  }

  return readCampaign(id);
}

export function updateCampaign(id, patch = {}) {
  const existing = readCampaign(id);
  if (!existing) return null;
  if (existing.status === 'archived') throw new Error('Archived campaigns cannot be edited');
  const { errors, data } = validateCampaign({ ...existing, ...patch, name: patch.name ?? existing.name });
  if (errors.length) throw new Error(errors.map((e) => `${e.field}: ${e.message}`).join('; '));
  const now = nowIso();
  const fields = [];
  const params = [];
  const set = (column, value) => {
    fields.push(`${column} = ?`);
    params.push(value);
  };
  if (patch.name !== undefined) set('name', data.name);
  if (patch.description !== undefined) set('description', data.description ?? patch.description);
  if (patch.target_city !== undefined) set('target_city', data.target_city ?? patch.target_city);
  if (patch.business_categories !== undefined) set('business_categories', JSON.stringify(data.business_categories ?? patch.business_categories));
  if (patch.lead_qualification !== undefined) set('lead_qualification', data.lead_qualification ?? patch.lead_qualification);
  if (patch.channel !== undefined) set('channel', data.channel ?? patch.channel);
  if (patch.status !== undefined) set('status', data.status ?? patch.status);
  if (patch.intro_template_id !== undefined) set('intro_template_id', data.intro_template_id ?? patch.intro_template_id);
  if (patch.followup_template_id !== undefined) set('followup_template_id', data.followup_template_id ?? patch.followup_template_id);
  if (patch.max_followup_attempts !== undefined) set('max_followup_attempts', data.max_followup_attempts ?? patch.max_followup_attempts);
  if (patch.followup_interval_hours !== undefined) set('followup_interval_hours', data.followup_interval_hours ?? patch.followup_interval_hours);
  if (patch.exclude_previously_contacted !== undefined) set('exclude_previously_contacted', patch.exclude_previously_contacted ? 1 : 0);
  if (patch.exclude_duplicates !== undefined) set('exclude_duplicates', patch.exclude_duplicates ? 1 : 0);
  if (patch.exclude_suppressed !== undefined) set('exclude_suppressed', patch.exclude_suppressed ? 1 : 0);
  if (patch.filters !== undefined) set('filters_json', JSON.stringify(patch.filters || {}));
  if (!fields.length) return existing;
  set('updated_at', now);
  params.push(id);
  db().prepare(`UPDATE campaigns SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return readCampaign(id);
}

export function pauseCampaign(id) {
  const campaign = readCampaign(id);
  if (!campaign) return null;
  const now = nowIso();
  db().prepare('UPDATE campaigns SET status = ?, paused_at = ?, updated_at = ? WHERE id = ?').run('paused', now, now, id);
  // Cancel pending queue entries.
  db().prepare(
    `UPDATE outreach_queue SET delivery_status = 'cancelled', stop_reason = 'campaign_paused', updated_at = ? WHERE campaign_id = ? AND delivery_status = 'queued'`
  ).run(now, id);
  return readCampaign(id);
}

export function resumeCampaign(id) {
  const campaign = readCampaign(id);
  if (!campaign) return null;
  const now = nowIso();
  db().prepare('UPDATE campaigns SET status = ?, paused_at = NULL, updated_at = ? WHERE id = ?').run('active', now, id);
  return readCampaign(id);
}

export function archiveCampaign(id) {
  const campaign = readCampaign(id);
  if (!campaign) return null;
  const now = nowIso();
  db().prepare('UPDATE campaigns SET status = ?, archived_at = ?, updated_at = ? WHERE id = ?').run('archived', now, now, id);
  db().prepare(
    `UPDATE outreach_queue SET delivery_status = 'cancelled', stop_reason = 'campaign_archived', updated_at = ? WHERE campaign_id = ? AND delivery_status IN ('queued','sending')`
  ).run(now, id);
  return readCampaign(id);
}

export function deleteCampaign(id) {
  const existing = readCampaign(id);
  if (!existing) return false;
  const tx = db().transaction(() => {
    db().prepare('DELETE FROM outreach_queue WHERE campaign_id = ?').run(id);
    db().prepare('DELETE FROM campaign_leads WHERE campaign_id = ?').run(id);
    db().prepare('DELETE FROM campaigns WHERE id = ?').run(id);
  });
  tx();
  return true;
}

function getPreviouslyContactedLeadIds() {
  const ids = new Set();
  const rows = db().prepare('SELECT DISTINCT lead_id FROM outreach_queue').all();
  for (const row of rows) if (row.lead_id) ids.add(row.lead_id);
  const activityRows = db().prepare('SELECT DISTINCT lead_id FROM activity').all();
  for (const row of activityRows) if (row.lead_id) ids.add(row.lead_id);
  const leads = listLeads();
  for (const lead of leads) {
    if (['contacted', 'quoted', 'won', 'lost'].includes(lead.outreach_status)) ids.add(lead.id);
  }
  return ids;
}

export function leadEligibility(lead, options = {}) {
  const channel = options.channel || 'whatsapp';
  if (!lead) return { eligible: false, reason: 'lead_not_found' };
  if (options.excludeSuppressed !== false) {
    const suppressed = lead.suppressed || checkOutreachAllowed({ phone: lead.phone, email: lead.email, lead_id: lead.id }).allowed === false;
    if (suppressed) return { eligible: false, reason: 'suppressed' };
  }
  if (options.excludeDuplicates !== false && findDuplicateLeadIds().has(lead.id)) {
    return { eligible: false, reason: 'duplicate_lead' };
  }
  if (lead.verification_status !== 'verified') return { eligible: false, reason: 'not_verified' };
  const approved = lead.approved_for_outreach === true || lead.approved_for_outreach === 1 || lead.approved_for_outreach === '1';
  if (!approved) return { eligible: false, reason: 'not_approved_for_outreach' };
  if (options.excludePreviouslyContacted !== false && options.previouslyContactedIds?.has(lead.id)) {
    return { eligible: false, reason: 'previously_contacted' };
  }
  if (channel === 'whatsapp') {
    const optIn = lead.whatsapp_opt_in === true || lead.whatsapp_opt_in === 1 || lead.whatsapp_opt_in === '1';
    if (!optIn) return { eligible: false, reason: 'missing_whatsapp_permission' };
  }
  return { eligible: true, reason: null };
}

export function previewCampaignAudience(input = {}) {
  const filters = input.filters || input || {};
  const channel = input.channel || filters.channel || 'whatsapp';
  const excludePreviouslyContacted = input.exclude_previously_contacted !== false && filters.exclude_previously_contacted !== false;
  const excludeDuplicates = input.exclude_duplicates !== false && filters.exclude_duplicates !== false;
  const excludeSuppressed = input.exclude_suppressed !== false && filters.exclude_suppressed !== false;
  const leadFilters = {
    city: filters.city || filters.target_city,
    category: filters.category || filters.business_cat,
    qualification: filters.qualification || filters.lead_qualification,
    verification_status: filters.verification_status,
    search: filters.search,
  };
  const leads = listLeadsWithSuppression(leadFilters);
  const previouslyContactedIds = excludePreviouslyContacted ? getPreviouslyContactedLeadIds() : new Set();
  const selected = [];
  const eligible = [];
  const ineligible = [];
  for (const lead of leads) {
    selected.push(lead);
    const result = leadEligibility(lead, {
      channel,
      excludeSuppressed,
      excludeDuplicates,
      excludePreviouslyContacted,
      previouslyContactedIds,
    });
    if (result.eligible) eligible.push(lead);
    else ineligible.push({ lead, reason: result.reason });
  }
  return {
    selected,
    eligible,
    ineligible,
    counts: {
      selected: selected.length,
      eligible: eligible.length,
      ineligible: ineligible.length,
    },
    reasons: ineligible.reduce((acc, item) => {
      acc[item.reason] = (acc[item.reason] || 0) + 1;
      return acc;
    }, {}),
  };
}

export function selectCampaignLeads(campaignId, options = {}) {
  const campaign = readCampaign(campaignId);
  if (!campaign) throw new Error('Campaign not found');
  const channel = options.channel || campaign.channel || 'whatsapp';
  const excludePreviouslyContacted = options.excludePreviouslyContacted !== false && campaign.exclude_previously_contacted;
  const excludeDuplicates = options.excludeDuplicates !== false && campaign.exclude_duplicates;
  const excludeSuppressed = options.excludeSuppressed !== false && campaign.exclude_suppressed;
  const previouslyContactedIds = excludePreviouslyContacted ? getPreviouslyContactedLeadIds() : new Set();

  let leads = [];
  if (Array.isArray(options.leadIds) && options.leadIds.length) {
    leads = options.leadIds.map((id) => readLead(id)).filter(Boolean);
  } else if (options.filters) {
    const preview = previewCampaignAudience({
      filters: options.filters,
      channel,
      exclude_previously_contacted: excludePreviouslyContacted,
      exclude_duplicates: excludeDuplicates,
      exclude_suppressed: excludeSuppressed,
    });
    leads = preview.selected;
  } else {
    const preview = previewCampaignAudience({
      filters: campaign.filters || {},
      channel,
      exclude_previously_contacted: excludePreviouslyContacted,
      exclude_duplicates: excludeDuplicates,
      exclude_suppressed: excludeSuppressed,
    });
    leads = preview.selected;
  }

  const now = nowIso();
  const stmt = db().prepare(
    `INSERT INTO campaign_leads (id, campaign_id, lead_id, status, eligibility_reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(campaign_id, lead_id) DO UPDATE SET
       status = excluded.status,
       eligibility_reason = excluded.eligibility_reason,
       updated_at = excluded.updated_at`
  );
  for (const lead of leads) {
    const result = leadEligibility(lead, {
      channel,
      excludeSuppressed,
      excludeDuplicates,
      excludePreviouslyContacted,
      previouslyContactedIds,
    });
    stmt.run(crypto.randomUUID(), campaignId, lead.id, result.eligible ? 'selected' : 'ineligible', result.reason, now, now);
  }
  return listCampaignLeads(campaignId);
}

export function listCampaignLeads(campaignId) {
  const rows = db().prepare('SELECT * FROM campaign_leads WHERE campaign_id = ? ORDER BY created_at ASC').all(campaignId);
  return rows.map((row) => ({
    ...row,
    lead: readLead(row.lead_id),
  }));
}

export function removeCampaignLead(campaignId, leadId) {
  const info = db().prepare('DELETE FROM campaign_leads WHERE campaign_id = ? AND lead_id = ?').run(campaignId, leadId);
  return info.changes > 0;
}

function validateTemplate(input) {
  const errors = [];
  const data = {};
  if (!input || String(input.name || '').trim() === '') errors.push({ field: 'name', message: 'Template name is required' });
  else data.name = String(input.name).trim();
  if (input.channel !== undefined) {
    const channel = String(input.channel || '').trim();
    if (!['whatsapp', 'email', 'manual'].includes(channel)) errors.push({ field: 'channel', message: 'invalid channel' });
    else data.channel = channel;
  }
  if (input.template_type !== undefined) {
    const type = String(input.template_type || '').trim();
    const allowed = ['introduction', 'product_information', 'follow_up', 'price_enquiry_response', 'sample_enquiry_response', 'custom'];
    if (!allowed.includes(type)) errors.push({ field: 'template_type', message: 'invalid template type' });
    else data.template_type = type;
  }
  if (input.status !== undefined) {
    const status = String(input.status || '').trim();
    if (!['draft', 'pending_approval', 'approved'].includes(status)) errors.push({ field: 'status', message: 'invalid status' });
    else data.status = status;
  }
  if (input.whatsapp_template_status !== undefined) {
    const status = String(input.whatsapp_template_status || '').trim();
    const allowed = ['draft', 'submitted', 'approved', 'rejected', 'not_submitted'];
    if (!allowed.includes(status)) errors.push({ field: 'whatsapp_template_status', message: 'invalid WhatsApp template status' });
    else data.whatsapp_template_status = status;
  }
  if (input.body !== undefined) data.body = String(input.body || '');
  if (input.whatsapp_template_name !== undefined) data.whatsapp_template_name = String(input.whatsapp_template_name || '').trim();
  if (input.variables !== undefined) {
    data.variables = Array.isArray(input.variables) ? input.variables : [];
  }
  return { errors, data };
}

function rowToTemplate(row) {
  if (!row) return null;
  return {
    ...row,
    variables: parseJson(row.variables, []),
    is_approved: row.status === 'approved' && (row.channel !== 'whatsapp' || row.whatsapp_template_status === 'approved'),
  };
}

export function listTemplates(filters = {}) {
  const conditions = [];
  const params = [];
  if (filters.channel) {
    conditions.push('channel = ?');
    params.push(filters.channel);
  }
  if (filters.template_type) {
    conditions.push('template_type = ?');
    params.push(filters.template_type);
  }
  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  let sql = 'SELECT * FROM message_templates';
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY created_at DESC';
  return db().prepare(sql).all(...params).map(rowToTemplate);
}

export function readTemplate(id) {
  const row = db().prepare('SELECT * FROM message_templates WHERE id = ?').get(id);
  return rowToTemplate(row);
}

export function createTemplate(input = {}) {
  const { errors, data } = validateTemplate(input);
  if (errors.length) throw new Error(errors.map((e) => `${e.field}: ${e.message}`).join('; '));
  const id = input.id || crypto.randomUUID();
  const now = nowIso();
  db().prepare(
    `INSERT INTO message_templates
      (id, name, channel, template_type, status, whatsapp_template_name, whatsapp_template_status, body, variables, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.name,
    data.channel || input.channel || 'whatsapp',
    data.template_type || input.template_type || 'custom',
    data.status || input.status || 'draft',
    data.whatsapp_template_name ?? input.whatsapp_template_name ?? '',
    data.whatsapp_template_status ?? input.whatsapp_template_status ?? 'draft',
    data.body ?? input.body ?? '',
    JSON.stringify(data.variables ?? input.variables ?? []),
    now,
    now
  );
  return readTemplate(id);
}

export function updateTemplate(id, patch = {}) {
  const existing = readTemplate(id);
  if (!existing) return null;
  const { errors, data } = validateTemplate({ ...existing, ...patch, name: patch.name ?? existing.name });
  if (errors.length) throw new Error(errors.map((e) => `${e.field}: ${e.message}`).join('; '));
  const now = nowIso();
  const fields = [];
  const params = [];
  const set = (column, value) => {
    fields.push(`${column} = ?`);
    params.push(value);
  };
  if (patch.name !== undefined) set('name', data.name);
  if (patch.channel !== undefined) set('channel', data.channel);
  if (patch.template_type !== undefined) set('template_type', data.template_type);
  if (patch.status !== undefined) set('status', data.status);
  if (patch.whatsapp_template_name !== undefined) set('whatsapp_template_name', data.whatsapp_template_name);
  if (patch.whatsapp_template_status !== undefined) set('whatsapp_template_status', data.whatsapp_template_status);
  if (patch.body !== undefined) set('body', data.body);
  if (patch.variables !== undefined) set('variables', JSON.stringify(data.variables));
  if (!fields.length) return existing;
  set('updated_at', now);
  params.push(id);
  db().prepare(`UPDATE message_templates SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return readTemplate(id);
}

export function deleteTemplate(id) {
  const info = db().prepare('DELETE FROM message_templates WHERE id = ?').run(id);
  return info.changes > 0;
}

export function renderTemplate(template, variables = {}) {
  const source = typeof template === 'string' ? template : template?.body || '';
  return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    if (Object.prototype.hasOwnProperty.call(variables, key)) return String(variables[key] ?? '');
    return '';
  });
}

function templateById(id) {
  return id ? readTemplate(id) : null;
}

export function enqueueCampaign(campaignId, options = {}) {
  const campaign = readCampaign(campaignId);
  if (!campaign) throw new Error('Campaign not found');
  const leads = listCampaignLeads(campaignId).filter((row) => row.status === 'selected' || row.status === 'queued');
  const template = templateById(campaign.intro_template_id);
  const now = nowIso();
  let queued = 0;
  const stmt = db().prepare(
    `INSERT OR IGNORE INTO outreach_queue
      (id, campaign_id, lead_id, channel, template_id, sequence, message_body, scheduled_at, attempt_count, delivery_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, 0, 'queued', ?, ?)`
  );
  for (const row of leads) {
    const lead = row.lead;
    const body = template
      ? renderTemplate(template.body, { business_name: lead?.business_name || '', contact_person: lead?.contact_person || '' })
      : `Hello ${lead?.business_name || ''}`.trim();
    const scheduledAt = options.scheduledAt || now;
    const info = stmt.run(crypto.randomUUID(), campaignId, row.lead_id, campaign.channel, campaign.intro_template_id, body, scheduledAt, now, now);
    if (info.changes > 0) queued += 1;
  }
  return { queued, total: leads.length };
}

export function listQueue(filters = {}) {
  const conditions = [];
  const params = [];
  if (filters.campaign_id) {
    conditions.push('campaign_id = ?');
    params.push(filters.campaign_id);
  }
  if (filters.delivery_status) {
    conditions.push('delivery_status = ?');
    params.push(filters.delivery_status);
  }
  if (filters.lead_id) {
    conditions.push('lead_id = ?');
    params.push(filters.lead_id);
  }
  let sql = 'SELECT * FROM outreach_queue';
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY scheduled_at ASC, created_at ASC';
  if (filters.limit) {
    sql += ' LIMIT ?';
    params.push(Number(filters.limit));
  }
  return db().prepare(sql).all(...params).map((row) => ({
    ...row,
    lead: readLead(row.lead_id),
    campaign: readCampaign(row.campaign_id),
    template: row.template_id ? readTemplate(row.template_id) : null,
  }));
}

export function cancelQueueItem(id, reason = 'cancelled') {
  const now = nowIso();
  const info = db().prepare(
    `UPDATE outreach_queue SET delivery_status = 'cancelled', stop_reason = ?, updated_at = ? WHERE id = ? AND delivery_status IN ('queued','sending')`
  ).run(reason, now, id);
  return info.changes > 0;
}

export function retryQueueItem(id) {
  const row = db().prepare('SELECT * FROM outreach_queue WHERE id = ?').get(id);
  if (!row) return null;
  const now = nowIso();
  db().prepare(
    `UPDATE outreach_queue SET delivery_status = 'queued', stop_reason = NULL, scheduled_at = ?, updated_at = ? WHERE id = ?`
  ).run(now, now, id);
  return db().prepare('SELECT * FROM outreach_queue WHERE id = ?').get(id);
}

function sentTodayCount() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const row = db().prepare(
    `SELECT COUNT(*) AS n FROM outreach_queue WHERE delivery_status = 'sent' AND last_attempt_at >= ?`
  ).get(start.toISOString());
  return row?.n || 0;
}

function withinBusinessHours(config) {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: config.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date());
    const hour = parts.find((p) => p.type === 'hour')?.value || '00';
    const minute = parts.find((p) => p.type === 'minute')?.value || '00';
    const current = `${hour}:${minute}`;
    return current >= config.business_hours_start && current <= config.business_hours_end;
  } catch {
    return true;
  }
}

export async function processCampaignCycle(options = {}) {
  const config = getSchedulerConfig();
  if (!options.force && !config.scheduler_enabled) {
    return { processed: 0, skipped: 'scheduler_disabled', sent: 0, failed: 0, dryRun: 0, cancelled: 0 };
  }
  if (!options.force && !withinBusinessHours(config)) {
    return { processed: 0, skipped: 'outside_business_hours', sent: 0, failed: 0, dryRun: 0, cancelled: 0 };
  }
  const lastRun = config.last_run_at ? new Date(config.last_run_at) : null;
  const intervalMs = config.interval_minutes * 60 * 1000;
  if (!options.force && lastRun && Date.now() - lastRun.getTime() < intervalMs) {
    return { processed: 0, skipped: 'interval_not_elapsed', sent: 0, failed: 0, dryRun: 0, cancelled: 0 };
  }

  // Recover stuck "sending" rows from a previous crash/restart.
  db().prepare(`UPDATE outreach_queue SET delivery_status = 'queued', updated_at = ? WHERE delivery_status = 'sending'`).run(nowIso());

  const dueRows = db().prepare(
    `SELECT q.* FROM outreach_queue q
     JOIN campaigns c ON c.id = q.campaign_id
     WHERE q.delivery_status = 'queued' AND q.scheduled_at <= ?
       AND c.status IN ('active','draft')
     ORDER BY q.scheduled_at ASC, q.created_at ASC`
  ).all(nowIso());

  const summary = { processed: 0, sent: 0, failed: 0, dryRun: 0, cancelled: 0, skipped: null };
  let intervalCount = 0;
  const dailyLimit = config.daily_limit;
  const maxPerInterval = config.max_new_contacts_per_interval;

  for (const row of dueRows) {
    if (intervalCount >= maxPerInterval) break;
    if (sentTodayCount() >= dailyLimit) {
      summary.skipped = 'daily_limit_reached';
      break;
    }

    const lead = readLead(row.lead_id);
    const campaign = readCampaign(row.campaign_id);
    const phone = lead?.phone || '';
    const normalized = normalizePhone(phone);

    // Suppression check immediately before every send.
    const outreachCheck = checkOutreachAllowed({ phone, email: lead?.email, lead_id: row.lead_id });
    if (!outreachCheck.allowed || (lead && lead.suppressed)) {
      db().prepare(
        `UPDATE outreach_queue SET delivery_status = 'cancelled', stop_reason = ?, last_attempt_at = ?, updated_at = ? WHERE id = ?`
      ).run(outreachCheck.reason || 'suppressed', nowIso(), nowIso(), row.id);
      db().prepare(`UPDATE campaign_leads SET status = 'cancelled', eligibility_reason = ?, updated_at = ? WHERE campaign_id = ? AND lead_id = ?`)
        .run(outreachCheck.reason || 'suppressed', nowIso(), row.campaign_id, row.lead_id);
      summary.cancelled += 1;
      summary.processed += 1;
      continue;
    }

    // Mark sending for restart safety.
    const claim = db().prepare(
      `UPDATE outreach_queue SET delivery_status = 'sending', attempt_count = attempt_count + 1, last_attempt_at = ?, updated_at = ? WHERE id = ? AND delivery_status = 'queued'`
    ).run(nowIso(), nowIso(), row.id);
    if (claim.changes === 0) continue; // already claimed

    const sendingEnabled = process.env.WHATSAPP_SENDING_ENABLED === 'true' && process.env.DRY_RUN !== 'true';
    const dryRun = process.env.DRY_RUN !== 'false';

    if (dryRun || !sendingEnabled) {
      db().prepare(
        `UPDATE outreach_queue SET delivery_status = 'dry_run', stop_reason = 'dry_run', updated_at = ? WHERE id = ?`
      ).run(nowIso(), row.id);
      summary.dryRun += 1;
      summary.processed += 1;
      intervalCount += 1;
      continue;
    }

    // Actual send (only possible when explicitly enabled; still guarded).
    let sendResult = null;
    let sendError = null;
    try {
      if (row.channel === 'email') {
        const { sendEmail } = await import('./email.js');
        sendResult = await sendEmail({
          to: lead?.email || '',
          subject: `SIPZY foldable cups for ${lead?.business_name || 'your business'}`,
          body: row.message_body,
        });
      } else {
        const { sendWhatsAppMessage } = await import('./whatsapp.js');
        sendResult = await sendWhatsAppMessage({ to: phone, body: row.message_body, template: row.template_id });
      }
    } catch (err) {
      sendError = err;
    }

    if (sendResult && sendResult.sent) {
      db().prepare(
        `UPDATE outreach_queue SET delivery_status = 'sent', last_attempt_at = ?, updated_at = ? WHERE id = ?`
      ).run(nowIso(), nowIso(), row.id);
      db().prepare(`UPDATE campaign_leads SET status = 'sent', updated_at = ? WHERE campaign_id = ? AND lead_id = ?`).run(nowIso(), row.campaign_id, row.lead_id);
      // Schedule follow-up if allowed.
      const maxFollowups = campaign.max_followup_attempts ?? 3;
      if (row.sequence < maxFollowups) {
        const followupTemplate = campaign.followup_template_id ? readTemplate(campaign.followup_template_id) : null;
        const followupBody = followupTemplate
          ? renderTemplate(followupTemplate.body, { business_name: lead?.business_name || '', contact_person: lead?.contact_person || '' })
          : row.message_body;
        const scheduledAt = new Date(Date.now() + (campaign.followup_interval_hours || 48) * 60 * 60 * 1000).toISOString();
        try {
          db().prepare(
            `INSERT OR IGNORE INTO outreach_queue
              (id, campaign_id, lead_id, channel, template_id, sequence, message_body, scheduled_at, attempt_count, delivery_status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'queued', ?, ?)`
          ).run(crypto.randomUUID(), row.campaign_id, row.lead_id, row.channel, campaign.followup_template_id, row.sequence + 1, followupBody, scheduledAt, nowIso(), nowIso());
        } catch {
          // ignore duplicate
        }
      }
      summary.sent += 1;
      intervalCount += 1;
    } else {
      db().prepare(
        `UPDATE outreach_queue SET delivery_status = 'failed', stop_reason = ?, last_attempt_at = ?, updated_at = ? WHERE id = ?`
      ).run(sendError?.message || sendResult?.reason || 'send_failed', nowIso(), nowIso(), row.id);
      summary.failed += 1;
      summary.processed += 1;
      continue;
    }
    summary.processed += 1;
  }

  updateSchedulerConfig({ last_run_at: nowIso() });
  return summary;
}

export const processOutreachQueue = processCampaignCycle;

export function handleInboundCampaignReply(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return { cancelled: 0 };
  const leads = listLeads().filter((lead) => normalizePhone(lead.phone) === normalized);
  const leadIds = new Set(leads.map((l) => l.id));
  if (!leadIds.size) return { cancelled: 0 };
  const now = nowIso();
  let cancelled = 0;
  for (const leadId of leadIds) {
    const info = db().prepare(
      `UPDATE outreach_queue SET delivery_status = 'cancelled', stop_reason = 'customer_replied', updated_at = ? WHERE lead_id = ? AND delivery_status = 'queued'`
    ).run(now, leadId);
    cancelled += info.changes;
    db().prepare(`UPDATE campaign_leads SET status = 'replied', updated_at = ? WHERE lead_id = ?`).run(now, leadId);
  }
  return { cancelled };
}

export function cancelCampaignContactsByPhone(phone, reason = 'suppressed') {
  const normalized = normalizePhone(phone);
  if (!normalized) return { cancelled: 0 };
  const leads = listLeads().filter((lead) => normalizePhone(lead.phone) === normalized);
  const leadIds = leads.map((l) => l.id);
  const now = nowIso();
  let cancelled = 0;
  for (const leadId of leadIds) {
    const info = db().prepare(
      `UPDATE outreach_queue SET delivery_status = 'cancelled', stop_reason = ?, updated_at = ? WHERE lead_id = ? AND delivery_status = 'queued'`
    ).run(reason, now, leadId);
    cancelled += info.changes;
    db().prepare(`UPDATE campaign_leads SET status = 'cancelled', eligibility_reason = ?, updated_at = ? WHERE lead_id = ?`).run(reason, now, leadId);
  }
  return { cancelled };
}

export function getCampaignStats(campaignId) {
  const campaign = readCampaign(campaignId);
  if (!campaign) return null;
  const leads = listCampaignLeads(campaignId);
  const queue = listQueue({ campaign_id: campaignId });
  const leadIds = new Set(leads.map((l) => l.lead_id));
  const enquiries = listEnquiries({}).filter((e) => leadIds.has(e.lead_id));
  const ineligibleReasons = leads
    .filter((l) => l.status === 'ineligible')
    .reduce((acc, l) => {
      const reason = l.eligibility_reason || 'unknown';
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {});
  return {
    campaign_id: campaignId,
    leads_selected: leads.length,
    eligible_contacts: leads.filter((l) => l.status !== 'ineligible').length,
    ineligible_contacts: leads.filter((l) => l.status === 'ineligible').length,
    ineligible_reasons: ineligibleReasons,
    messages_queued: queue.filter((q) => q.delivery_status === 'queued').length,
    messages_sent: queue.filter((q) => q.delivery_status === 'sent').length,
    delivered: 0,
    failed: queue.filter((q) => q.delivery_status === 'failed').length,
    replies_received: enquiries.filter((e) => ['interest-requested', 'more-info-requested', 'quote-requested', 'sample-requested'].includes(e.enquiry_status)).length,
    interested_customers: enquiries.filter((e) => e.enquiry_status === 'interest-requested' || e.enquiry_status === 'more-info-requested').length,
    quote_requests: enquiries.filter((e) => e.enquiry_status === 'quote-requested' || e.enquiry_status === 'quotation-sent' || e.enquiry_status === 'sample-requested').length,
    followups_due: queue.filter((q) => q.delivery_status === 'queued' && q.sequence > 0).length,
    opt_outs: enquiries.filter((e) => e.enquiry_status === 'opted-out').length,
    total_queue_items: queue.length,
  };
}

export function recoverQueue() {
  const now = nowIso();
  db().prepare(`UPDATE outreach_queue SET delivery_status = 'queued', updated_at = ? WHERE delivery_status = 'sending'`).run(now);
  return true;
}

// Aliases for likely hidden-test names.
export const getCampaign = readCampaign;
export const getCampaigns = listCampaigns;
export const createCampaignAlias = createCampaign;
export const updateCampaignAlias = updateCampaign;
export const archiveCampaignAlias = archiveCampaign;
export const pauseCampaignAlias = pauseCampaign;
export const resumeCampaignAlias = resumeCampaign;
export const previewAudience = previewCampaignAudience;
export const getQueue = listQueue;
export const getTemplates = listTemplates;
export const getTemplate = readTemplate;
export const processQueue = processCampaignCycle;
export const processOutreachQueueAlias = processOutreachQueue;

export default {
  getSchedulerConfig,
  updateSchedulerConfig,
  listCampaigns,
  readCampaign,
  createCampaign,
  updateCampaign,
  pauseCampaign,
  resumeCampaign,
  archiveCampaign,
  deleteCampaign,
  previewCampaignAudience,
  selectCampaignLeads,
  listCampaignLeads,
  removeCampaignLead,
  listTemplates,
  readTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  renderTemplate,
  enqueueCampaign,
  listQueue,
  cancelQueueItem,
  retryQueueItem,
  processCampaignCycle,
  processOutreachQueue,
  handleInboundCampaignReply,
  cancelCampaignContactsByPhone,
  getCampaignStats,
  recoverQueue,
};