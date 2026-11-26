import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

/**
 * SIPZY Marketing Bot - SQLite Database Layer
 *
 * Local, free, zero-network-setup SQLite database:
 *  - Database file lives in <code>data/</code> at the project root.
 *  - Excluded from Git via <code>.gitignore</code>.
 *  - All SQL uses parameterized queries (no string concatenation).
 *  - <code>initDb()</code> is idempotent: safe to run on every start;
 *    never duplicates products, never drops existing data.
 *
 * Tables created:
 *  - leads      (business leads)
 *  - enquiries  (customer enquiries)
 *  - activity   (outreach activity)
 *  - products   (product catalogue)
 *  - contact_suppressions (permanent do-not-contact registry)
 *
 * The <code>products</code> table is seeded exactly once with the six
 * SIPZY variants (Cold/Hot x 250ml/350ml/450ml) via
 * <code>INSERT OR IGNORE</code> on the unique (type, size) pair, so
 * repeated initialization never duplicates rows.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Project root (repo root). */
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

/** Dedicated data directory for the SQLite file. */
const DATA_DIR = path.join(PROJECT_ROOT, 'data');

/**
 * The SQLite file. `SIPZY_DB_FILE` lets the automated tests point at a
 * throwaway database instead of the real one.
 */
const DB_FILE = process.env.SIPZY_DB_FILE
  ? path.resolve(process.env.SIPZY_DB_FILE)
  : path.join(DATA_DIR, 'sipzy.db');

/** In-memory id counter used to generate short, URL-safe ids. */
let idCounter = 0;

/**
 * Generate a compact numeric id (000001, 000002, ...).
 */
function generateId() {
  idCounter += 1;
  return String(idCounter).padStart(6, '0');
}

/**
 * Ensure the data directory exists. Idempotent no-op if already present.
 */
function ensureDataDirectory() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
}

/**
 * Initialize (or open) the SQLite database with schema and seed the
 * product catalogue. Safe to call on every startup:
 * - Tables use IF NOT EXISTS so existing rows are preserved.
 * - Products use INSERT OR IGNORE on the UNIQUE(product_type, cup_size)
 *   key, so the six variants exist exactly once.
 *
 * @returns {{file: string}} { file } for diagnostics.
 */
function initDb() {
  ensureDataDirectory();

  // Use the shared singleton connection so schema migrations and runtime
  // queries share one SQLite handle; closeDb() can shut it down cleanly.
  const db = getDb();
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id            TEXT PRIMARY KEY,
      business_name TEXT NOT NULL DEFAULT '',
      business_cat  TEXT NOT NULL DEFAULT '',
      contact_person TEXT NOT NULL DEFAULT '',
      email         TEXT NOT NULL DEFAULT '',
      phone         TEXT NOT NULL DEFAULT '',
      city          TEXT NOT NULL DEFAULT '',
      address       TEXT NOT NULL DEFAULT '',
      website       TEXT NOT NULL DEFAULT '',
      lead_source   TEXT NOT NULL DEFAULT '',
      permission_notes TEXT NOT NULL DEFAULT '',
      outreach_status TEXT NOT NULL DEFAULT 'new',
      lead_qualification TEXT NOT NULL DEFAULT 'not_reviewed',
      verification_status TEXT NOT NULL DEFAULT 'unverified',
      website_verified INTEGER NOT NULL DEFAULT 0,
      phone_verified INTEGER NOT NULL DEFAULT 0,
      address_verified INTEGER NOT NULL DEFAULT 0,
      business_active INTEGER,
      verification_source TEXT NOT NULL DEFAULT '',
      verification_notes TEXT NOT NULL DEFAULT '',
      last_verified_at TEXT,
      verified_by TEXT NOT NULL DEFAULT '',
      place_id TEXT NOT NULL DEFAULT '',
      approved_for_outreach INTEGER NOT NULL DEFAULT 0,
      approved_by TEXT NOT NULL DEFAULT '',
      approved_at TEXT,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS enquiries (
      id               TEXT PRIMARY KEY,
      lead_id          TEXT,
      customer_name    TEXT NOT NULL DEFAULT '',
      business_name    TEXT NOT NULL DEFAULT '',
      phone            TEXT NOT NULL DEFAULT '',
      email            TEXT NOT NULL DEFAULT '',
      product_type     TEXT NOT NULL DEFAULT '',
      cup_size         TEXT NOT NULL DEFAULT '',
      quantity         INTEGER NOT NULL DEFAULT 0,
      delivery_location TEXT NOT NULL DEFAULT '',
      enquiry_status   TEXT NOT NULL DEFAULT 'new',
      original_message TEXT NOT NULL DEFAULT '',
      ai_summary       TEXT,
      follow_up_date   TEXT NOT NULL DEFAULT '',
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity (
      id           TEXT PRIMARY KEY,
      lead_id      TEXT NOT NULL DEFAULT '',
      channel      TEXT NOT NULL DEFAULT '',
      activity_type TEXT NOT NULL DEFAULT '',
      message_ref  TEXT NOT NULL DEFAULT '',
      delivery_status TEXT NOT NULL DEFAULT 'pending',
      activity_date TEXT NOT NULL,
      notes        TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS products (
      id           TEXT PRIMARY KEY,
      product_type TEXT NOT NULL DEFAULT '',
      cup_size     TEXT NOT NULL DEFAULT '',
      description  TEXT NOT NULL DEFAULT '',
      active       INTEGER NOT NULL DEFAULT 1,
      UNIQUE(product_type, cup_size)
    );

    -- Permanent do-not-contact registry. Rows are only ever created or
    -- enriched here; the API deliberately exposes no delete route.
    CREATE TABLE IF NOT EXISTS contact_suppressions (
      id            TEXT PRIMARY KEY,
      contact_key   TEXT NOT NULL UNIQUE,
      phone         TEXT NOT NULL DEFAULT '',
      email         TEXT NOT NULL DEFAULT '',
      customer_name TEXT NOT NULL DEFAULT '',
      business_name TEXT NOT NULL DEFAULT '',
      reason        TEXT NOT NULL DEFAULT 'opted_out',
      source_message TEXT NOT NULL DEFAULT '',
      enquiry_id    TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_suppressions_phone ON contact_suppressions(phone);
    CREATE INDEX IF NOT EXISTS idx_suppressions_email ON contact_suppressions(email);
  `);

  // Seed the six SIPZY product variants exactly once.
  const products = [
    { id: '000001', product_type: 'Cold', cup_size: '250ml', description: 'Foldable cold cup with straw intake, 250ml' },
    { id: '000002', product_type: 'Cold', cup_size: '350ml', description: 'Foldable cold cup with straw intake, 350ml' },
    { id: '000003', product_type: 'Cold', cup_size: '450ml', description: 'Foldable cold cup with straw intake, 450ml' },
    { id: '000004', product_type: 'Hot',  cup_size: '250ml', description: 'Foldable hot cup with 3-fold closure, 250ml' },
    { id: '000005', product_type: 'Hot',  cup_size: '350ml', description: 'Foldable hot cup with 3-fold closure, 350ml' },
    { id: '000006', product_type: 'Hot',  cup_size: '450ml', description: 'Foldable hot cup with 3-fold closure, 450ml' },
  ];

  const insert = db.prepare(
    `INSERT OR IGNORE INTO products (id, product_type, cup_size, description, active)
     VALUES (@id, @product_type, @cup_size, @description, 1)`
  );
  const update = db.prepare(
    `UPDATE products SET description = @description, product_type = @product_type, cup_size = @cup_size, active = 1 WHERE id = @id`
  );

  for (const p of products) {
    insert.run(p);
    update.run(p);
  }

  // Backfill columns added after the initial schema so existing databases
  // keep working without a destructive migration. Leads gained a lead
  // qualification field for internal assessment; it is NOT customer intent.
  // Verification fields are manual review data and must never be fabricated.
  const leadColumns = db.prepare('PRAGMA table_info(leads)').all().map((column) => column.name);
  const addLeadColumn = (name, sql) => {
    if (!leadColumns.includes(name)) db.exec(sql);
  };
  addLeadColumn('lead_qualification', "ALTER TABLE leads ADD COLUMN lead_qualification TEXT NOT NULL DEFAULT 'not_reviewed'");
  addLeadColumn('verification_status', "ALTER TABLE leads ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified'");
  addLeadColumn('website_verified', 'ALTER TABLE leads ADD COLUMN website_verified INTEGER NOT NULL DEFAULT 0');
  addLeadColumn('phone_verified', 'ALTER TABLE leads ADD COLUMN phone_verified INTEGER NOT NULL DEFAULT 0');
  addLeadColumn('address_verified', 'ALTER TABLE leads ADD COLUMN address_verified INTEGER NOT NULL DEFAULT 0');
  addLeadColumn('business_active', 'ALTER TABLE leads ADD COLUMN business_active INTEGER');
  addLeadColumn('verification_source', "ALTER TABLE leads ADD COLUMN verification_source TEXT NOT NULL DEFAULT ''");
  addLeadColumn('verification_notes', "ALTER TABLE leads ADD COLUMN verification_notes TEXT NOT NULL DEFAULT ''");
  addLeadColumn('last_verified_at', 'ALTER TABLE leads ADD COLUMN last_verified_at TEXT');
  addLeadColumn('verified_by', "ALTER TABLE leads ADD COLUMN verified_by TEXT NOT NULL DEFAULT ''");
  addLeadColumn('place_id', "ALTER TABLE leads ADD COLUMN place_id TEXT NOT NULL DEFAULT ''");
  addLeadColumn('approved_for_outreach', "ALTER TABLE leads ADD COLUMN approved_for_outreach INTEGER NOT NULL DEFAULT 0");
  addLeadColumn('approved_by', "ALTER TABLE leads ADD COLUMN approved_by TEXT NOT NULL DEFAULT ''");
  addLeadColumn('approved_at', 'ALTER TABLE leads ADD COLUMN approved_at TEXT');

  db.exec('CREATE INDEX IF NOT EXISTS idx_leads_verification_status ON leads(verification_status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_leads_place_id ON leads(place_id)');

  // WhatsApp Cloud API foundation: permanent inbox of inbound messages and
  // webhook delivery events. Additive only; no existing tables changed.
  db.exec(`
    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id TEXT PRIMARY KEY,
      external_id TEXT NOT NULL UNIQUE,
      direction TEXT NOT NULL DEFAULT 'inbound',
      phone TEXT NOT NULL DEFAULT '',
      normalized_phone TEXT NOT NULL DEFAULT '',
      contact_name TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      message_type TEXT NOT NULL DEFAULT 'text',
      raw_payload TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'received',
      delivery_status TEXT NOT NULL DEFAULT '',
      analysis_json TEXT,
      enquiry_id TEXT,
      lead_id TEXT,
      draft_reply TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
      id TEXT PRIMARY KEY,
      event_key TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone ON whatsapp_messages(normalized_phone);
    CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_created ON whatsapp_messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_enquiry ON whatsapp_messages(enquiry_id);
  `);

  // ---- Outbound Campaign Engine (additive only) ----
  // Safe migrations for campaign management, audience, templates, queue,
  // scheduler settings and WhatsApp permission tracking on leads.
  const campaignColumns = db.prepare('PRAGMA table_info(campaigns)').all().map((c) => c.name);
  // campaigns table itself is created below with IF NOT EXISTS; column
  // backfill only matters for databases created before a column existed.

  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      target_city TEXT NOT NULL DEFAULT '',
      business_categories TEXT NOT NULL DEFAULT '[]',
      lead_qualification TEXT NOT NULL DEFAULT '',
      channel TEXT NOT NULL DEFAULT 'whatsapp',
      status TEXT NOT NULL DEFAULT 'draft',
      intro_template_id TEXT,
      followup_template_id TEXT,
      filters_json TEXT NOT NULL DEFAULT '{}',
      max_followup_attempts INTEGER NOT NULL DEFAULT 3,
      followup_interval_hours INTEGER NOT NULL DEFAULT 48,
      exclude_previously_contacted INTEGER NOT NULL DEFAULT 1,
      exclude_duplicates INTEGER NOT NULL DEFAULT 1,
      exclude_suppressed INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      paused_at TEXT,
      archived_at TEXT
    );

    CREATE TABLE IF NOT EXISTS campaign_leads (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      lead_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'selected',
      eligibility_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(campaign_id, lead_id)
    );

    CREATE TABLE IF NOT EXISTS message_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      channel TEXT NOT NULL DEFAULT 'whatsapp',
      template_type TEXT NOT NULL DEFAULT 'custom',
      status TEXT NOT NULL DEFAULT 'draft',
      whatsapp_template_name TEXT NOT NULL DEFAULT '',
      whatsapp_template_status TEXT NOT NULL DEFAULT 'draft',
      body TEXT NOT NULL DEFAULT '',
      variables TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outreach_queue (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      lead_id TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'whatsapp',
      template_id TEXT,
      sequence INTEGER NOT NULL DEFAULT 0,
      message_body TEXT NOT NULL DEFAULT '',
      scheduled_at TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      delivery_status TEXT NOT NULL DEFAULT 'queued',
      last_attempt_at TEXT,
      next_followup_at TEXT,
      stop_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(campaign_id, lead_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS campaign_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
    CREATE INDEX IF NOT EXISTS idx_campaign_leads_campaign ON campaign_leads(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_leads_lead ON campaign_leads(lead_id);
    CREATE INDEX IF NOT EXISTS idx_templates_channel ON message_templates(channel);
    CREATE INDEX IF NOT EXISTS idx_queue_campaign ON outreach_queue(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_queue_status ON outreach_queue(delivery_status);
    CREATE INDEX IF NOT EXISTS idx_queue_scheduled ON outreach_queue(scheduled_at);
  `);

  // Seed default scheduler settings once.
  const seedSetting = db.prepare(
    `INSERT OR IGNORE INTO campaign_settings (key, value, updated_at) VALUES (?, ?, ?)`
  );
  const nowSeed = new Date().toISOString();
  const defaultSettings = [
    ['scheduler_enabled', 'false'],
    ['max_new_contacts_per_interval', '20'],
    ['interval_minutes', '15'],
    ['daily_limit', '200'],
    ['business_hours_start', '09:00'],
    ['business_hours_end', '18:00'],
    ['timezone', 'Asia/Kolkata'],
    ['followup_interval_hours', '48'],
    ['max_followup_attempts', '3'],
    ['last_run_at', ''],
  ];
  for (const [key, value] of defaultSettings) {
    seedSetting.run(key, value, nowSeed);
  }

  // WhatsApp permission tracking on leads (additive, safe migration).
  const leadColumnsNow = db.prepare('PRAGMA table_info(leads)').all().map((c) => c.name);
  const addLeadColumnNow = (name, sql) => {
    if (!leadColumnsNow.includes(name)) db.exec(sql);
  };
  addLeadColumnNow('whatsapp_opt_in', "ALTER TABLE leads ADD COLUMN whatsapp_opt_in INTEGER NOT NULL DEFAULT 0");
  addLeadColumnNow('whatsapp_permission_source', "ALTER TABLE leads ADD COLUMN whatsapp_permission_source TEXT NOT NULL DEFAULT ''");
  addLeadColumnNow('whatsapp_opt_in_at', 'ALTER TABLE leads ADD COLUMN whatsapp_opt_in_at TEXT');

  // ---- AI Sales Conversation Engine (additive only) ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      lead_id TEXT,
      phone TEXT NOT NULL DEFAULT '',
      normalized_phone TEXT NOT NULL DEFAULT '',
      customer_name TEXT NOT NULL DEFAULT '',
      business_name TEXT NOT NULL DEFAULT '',
      business_category TEXT NOT NULL DEFAULT '',
      product_type TEXT NOT NULL DEFAULT '',
      cup_size TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 0,
      delivery_location TEXT NOT NULL DEFAULT '',
      budget TEXT NOT NULL DEFAULT '',
      sample_required INTEGER NOT NULL DEFAULT 0,
      price_enquiry INTEGER NOT NULL DEFAULT 0,
      purchase_timeline TEXT NOT NULL DEFAULT '',
      missing_info TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'new',
      last_customer_message_at TEXT,
      last_message TEXT NOT NULL DEFAULT '',
      ai_reply TEXT NOT NULL DEFAULT '',
      reply_status TEXT NOT NULL DEFAULT 'draft',
      reply_approved_by TEXT NOT NULL DEFAULT '',
      requires_template INTEGER NOT NULL DEFAULT 0,
      linked_enquiry_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'inbound',
      body TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'whatsapp',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(normalized_phone);
    CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
    CREATE INDEX IF NOT EXISTS idx_conversations_lead ON conversations(lead_id);
    CREATE INDEX IF NOT EXISTS idx_conversation_messages_conv ON conversation_messages(conversation_id);
  `);

  // ---- Controlled WhatsApp test campaign (separate from general campaigns) ----
  // This mode never touches outreach_queue or the background scheduler. It
  // only sends to contacts that are both in TEST_ALLOWED_NUMBERS and marked
  // authorized here.
  db.exec(`
    CREATE TABLE IF NOT EXISTS test_campaign_contacts (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL DEFAULT '',
      normalized_phone TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      lead_id TEXT,
      authorized INTEGER NOT NULL DEFAULT 0,
      authorized_by TEXT NOT NULL DEFAULT '',
      authorized_at TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS test_campaign_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'stopped',
      template_id TEXT,
      template_name TEXT NOT NULL DEFAULT '',
      language_code TEXT NOT NULL DEFAULT 'en_US',
      recipients_total INTEGER NOT NULL DEFAULT 0,
      recipients_sent INTEGER NOT NULL DEFAULT 0,
      recipients_dry_run INTEGER NOT NULL DEFAULT 0,
      recipients_failed INTEGER NOT NULL DEFAULT 0,
      skipped_json TEXT NOT NULL DEFAULT '[]',
      last_error TEXT NOT NULL DEFAULT '',
      started_by TEXT NOT NULL DEFAULT '',
      started_at TEXT,
      stopped_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_test_campaign_contacts_authorized ON test_campaign_contacts(authorized);
    CREATE INDEX IF NOT EXISTS idx_test_campaign_runs_status ON test_campaign_runs(status);
    CREATE INDEX IF NOT EXISTS idx_test_campaign_runs_created ON test_campaign_runs(created_at);
  `);

  // ---- End-to-End Sales Workflow / Operations (additive only) ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS handoff_tasks (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      enquiry_id TEXT,
      lead_id TEXT,
      assigned_to TEXT NOT NULL DEFAULT '',
      customer_name TEXT NOT NULL DEFAULT '',
      business_name TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'open',
      due_date TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quotations (
      id TEXT PRIMARY KEY,
      enquiry_id TEXT,
      conversation_id TEXT,
      lead_id TEXT,
      product_type TEXT NOT NULL DEFAULT '',
      cup_size TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL DEFAULT 0,
      delivery_charges REAL NOT NULL DEFAULT 0,
      total_price REAL NOT NULL DEFAULT 0,
      validity_days INTEGER NOT NULL DEFAULT 7,
      valid_until TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      enquiry_id TEXT,
      quotation_id TEXT,
      conversation_id TEXT,
      lead_id TEXT,
      product_type TEXT NOT NULL DEFAULT '',
      cup_size TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending_confirmation',
      notes TEXT NOT NULL DEFAULT '',
      confirmed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_handoff_tasks_status ON handoff_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_handoff_tasks_conversation ON handoff_tasks(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_quotations_enquiry ON quotations(enquiry_id);
    CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status);
    CREATE INDEX IF NOT EXISTS idx_orders_enquiry ON orders(enquiry_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  `);

  // ---- Security foundation (additive only) ----
  // Users, sessions and audit logs for admin authentication. Existing data
  // is untouched; passwords are never stored in plaintext.
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      ip TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      actor_username TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT '',
      entity_id TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      ip TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_user_id);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

    CREATE INDEX IF NOT EXISTS idx_enquiries_phone ON enquiries(phone);
    CREATE INDEX IF NOT EXISTS idx_enquiries_status ON enquiries(enquiry_status);
    CREATE INDEX IF NOT EXISTS idx_conversations_status2 ON conversations(status);
    CREATE INDEX IF NOT EXISTS idx_quotations_status2 ON quotations(status);
    CREATE INDEX IF NOT EXISTS idx_orders_status2 ON orders(status);
  `);

  // Do NOT close the DB here: getDb() relies on this same connection
  // for all later queries. Closing it would leave services with a
  // dangling handle.
  return { file: DB_FILE };
}

let _db = null;

/**
 * Get the singleton SQLite connection. Lazy-initializes on first call.
 * @returns {Database}
 */
function getDb() {
  if (!_db) {
    // Guarantee the parent directory exists before opening the file.
    ensureDataDirectory();
    _db = new Database(DB_FILE);
    _db.pragma('journal_mode = WAL');
  }
  return _db;
}

/**
 * Close the database connection (normally called on graceful shutdown).
 */
function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// Palette of shared error codes/names for the services layer.
export { generateId, getDb, closeDb, initDb, DB_FILE, DATA_DIR };

export default getDb;
