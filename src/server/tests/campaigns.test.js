import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbFile = path.join(os.tmpdir(), `sipzy-campaigns-${process.pid}-${Date.now()}.db`);
process.env.SIPZY_DB_FILE = dbFile;
process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
process.env.WHATSAPP_VERIFY_TOKEN = 'verify-me-token';
process.env.WHATSAPP_API_VERSION = 'v26.0';
process.env.DRY_RUN = 'true';
process.env.TEST_MODE = 'false';
process.env.TEST_ALLOWED_NUMBERS = '';
process.env.WHATSAPP_SENDING_ENABLED = 'false';

const { initDb, closeDb } = await import('../db/index.js');
initDb();

const { createLead } = await import('../services/leads.js');
const { registerOptOut } = await import('../services/suppressions.js');
const campaigns = await import('../services/campaigns.js');

const originalFetch = global.fetch;
let fetchMock = null;
beforeEach(() => {
  fetchMock = null;
  global.fetch = async (...args) => {
    if (!fetchMock) throw new Error('fetch should not be called');
    return fetchMock(...args);
  };
});

after(() => {
  global.fetch = originalFetch;
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbFile + suffix); } catch {}
  }
});

function makeLead(phone, extra = {}) {
  return createLead({
    business_name: `Cafe ${phone}`,
    phone,
    email: `${String(phone).replace(/\D/g, '')}@example.com`,
    city: 'Bengaluru',
    verification_status: 'verified',
    approved_for_outreach: true,
    whatsapp_opt_in: true,
    whatsapp_permission_source: 'test',
    ...extra,
  });
}

test('missing WhatsApp permission excludes a lead', () => {
  const lead = createLead({
    business_name: 'No Permission Cafe',
    phone: '+91 91111 11111',
    city: 'Bengaluru',
    verification_status: 'verified',
    approved_for_outreach: true,
    whatsapp_opt_in: false,
  });
  const preview = campaigns.previewCampaignAudience({ filters: { city: 'Bengaluru' }, channel: 'whatsapp' });
  const item = preview.ineligible.find((row) => row.lead.id === lead.id);
  assert.ok(item);
  assert.equal(item.reason, 'missing_whatsapp_permission');
});

test('suppressed contact is excluded', () => {
  const lead = makeLead('+91 92222 22222');
  registerOptOut({ phone: '+91 92222 22222', source_message: 'stop' });
  const preview = campaigns.previewCampaignAudience({ filters: { city: 'Bengaluru' }, channel: 'whatsapp' });
  const item = preview.ineligible.find((row) => row.lead.id === lead.id);
  assert.ok(item);
  assert.equal(item.reason, 'suppressed');
});

test('queue prevents duplicate campaign/lead/sequence rows', () => {
  const lead = makeLead('+91 93333 33333');
  const campaign = campaigns.createCampaign({ name: 'Dup', channel: 'whatsapp', filters: { city: 'Bengaluru' } });
  campaigns.updateCampaign(campaign.id, { status: 'active' });
  campaigns.enqueueCampaign(campaign.id);
  // second enqueue should not create duplicate initial queue rows
  const before = campaigns.listQueue({ campaign_id: campaign.id }).length;
  campaigns.enqueueCampaign(campaign.id);
  const after = campaigns.listQueue({ campaign_id: campaign.id }).length;
  assert.equal(after, before);
  assert.equal(after, 1);
});

test('campaign pause and resume updates status and cancels queued work', () => {
  const lead = makeLead('+91 94444 44444');
  const campaign = campaigns.createCampaign({ name: 'Pause', channel: 'whatsapp', filters: { city: 'Bengaluru' } });
  campaigns.updateCampaign(campaign.id, { status: 'active' });
  campaigns.enqueueCampaign(campaign.id);
  const paused = campaigns.pauseCampaign(campaign.id);
  assert.equal(paused.status, 'paused');
  const queue = campaigns.listQueue({ campaign_id: campaign.id });
  assert.equal(queue[0].delivery_status, 'cancelled');
  const resumed = campaigns.resumeCampaign(campaign.id);
  assert.equal(resumed.status, 'active');
});

test('follow-up is cancelled after a customer replies', async () => {
  const lead = makeLead('+91 95555 55555');
  const campaign = campaigns.createCampaign({ name: 'Reply', channel: 'whatsapp', filters: { city: 'Bengaluru' } });
  campaigns.updateCampaign(campaign.id, { status: 'active' });
  campaigns.enqueueCampaign(campaign.id);
  // simulate a scheduled follow-up row
  const db = campaigns.getSchedulerConfig && null;
  // Insert a follow-up queue row directly via DB
  const { getDb } = await import('../db/index.js');
  const now = new Date().toISOString();
  getDb().prepare(
    `INSERT INTO outreach_queue (id, campaign_id, lead_id, channel, sequence, message_body, scheduled_at, attempt_count, delivery_status, created_at, updated_at)
     VALUES (?, ?, ?, 'whatsapp', 1, 'followup', ?, 0, 'queued', ?, ?)`
  ).run('followup-1', campaign.id, lead.id, now, now, now);

  const result = campaigns.handleInboundCampaignReply(lead.phone);
  assert.ok(result.cancelled >= 1);
  const queue = campaigns.listQueue({ campaign_id: campaign.id });
  const followup = queue.find((q) => q.sequence === 1);
  assert.equal(followup.delivery_status, 'cancelled');
  assert.equal(followup.stop_reason, 'customer_replied');
});

test('follow-up is cancelled after opt-out', () => {
  const lead = makeLead('+91 96666 66666');
  const campaign = campaigns.createCampaign({ name: 'Optout', channel: 'whatsapp', filters: { city: 'Bengaluru' } });
  campaigns.updateCampaign(campaign.id, { status: 'active' });
  campaigns.enqueueCampaign(campaign.id);
  campaigns.cancelCampaignContactsByPhone(lead.phone, 'opted_out');
  const queue = campaigns.listQueue({ campaign_id: campaign.id });
  assert.equal(queue[0].delivery_status, 'cancelled');
  assert.equal(queue[0].stop_reason, 'opted_out');
});

test('dry-run never calls the network', async () => {
  process.env.DRY_RUN = 'true';
  process.env.WHATSAPP_SENDING_ENABLED = 'false';
  const lead = makeLead('+91 97777 77777');
  const campaign = campaigns.createCampaign({ name: 'Dry', channel: 'whatsapp', filters: { city: 'Bengaluru' } });
  campaigns.updateCampaign(campaign.id, { status: 'active' });
  campaigns.enqueueCampaign(campaign.id);
  campaigns.updateSchedulerConfig({ scheduler_enabled: true, interval_minutes: 0, business_hours_start: '00:00', business_hours_end: '23:59' });
  const cycle = await campaigns.processCampaignCycle({ force: true });
  assert.ok(cycle.dryRun >= 1);
  assert.equal(cycle.sent, 0);
});

test('daily and interval limits are enforced', async () => {
  process.env.DRY_RUN = 'false';
  process.env.WHATSAPP_SENDING_ENABLED = 'true';
  process.env.TEST_MODE = 'true';
  process.env.TEST_ALLOWED_NUMBERS = '919888888888,919888888889';

  fetchMock = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ messages: [{ id: 'wamid.sent' }] }),
  });

  const lead1 = makeLead('+91 98888 88888');
  const lead2 = makeLead('+91 98888 88889');
  const campaign = campaigns.createCampaign({ name: 'Limits', channel: 'whatsapp', filters: { city: 'Bengaluru' } });
  campaigns.updateCampaign(campaign.id, { status: 'active' });
  campaigns.enqueueCampaign(campaign.id);
  campaigns.updateSchedulerConfig({
    scheduler_enabled: true,
    max_new_contacts_per_interval: 10,
    interval_minutes: 15,
    daily_limit: 1,
    business_hours_start: '00:00',
    business_hours_end: '23:59',
    last_run_at: '',
  });

  const first = await campaigns.processCampaignCycle();
  assert.equal(first.sent, 1);

  // interval has not elapsed
  const second = await campaigns.processCampaignCycle();
  assert.equal(second.skipped, 'interval_not_elapsed');

  // reset interval but daily limit still applies
  campaigns.updateSchedulerConfig({ last_run_at: '' });
  const third = await campaigns.processCampaignCycle();
  assert.equal(third.skipped, 'daily_limit_reached');
});

test('server restart recovers sending rows without duplicating', async () => {
  const { getDb } = await import('../db/index.js');
  const now = new Date().toISOString();
  const row = getDb().prepare('SELECT id FROM outreach_queue LIMIT 1').get();
  if (row) {
    getDb().prepare(`UPDATE outreach_queue SET delivery_status = 'sending', updated_at = ? WHERE id = ?`).run(now, row.id);
  }
  campaigns.recoverQueue();
  if (row) {
    const recovered = getDb().prepare('SELECT delivery_status FROM outreach_queue WHERE id = ?').get(row.id);
    assert.equal(recovered.delivery_status, 'queued');
  }
});

// restore safety env
process.env.DRY_RUN = 'true';
process.env.WHATSAPP_SENDING_ENABLED = 'false';
process.env.TEST_MODE = 'false';
process.env.TEST_ALLOWED_NUMBERS = '';