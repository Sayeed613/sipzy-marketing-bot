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
 * SIPZY variants (Cold/Hot x 250ml/350ml/500ml) via
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

  const db = new Database(DB_FILE);
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
    { id: '000001', product_type: 'Cold', cup_size: '250ml', description: '250ml cold-foam paper cup' },
    { id: '000002', product_type: 'Cold', cup_size: '350ml', description: '350ml cold-foam paper cup' },
    { id: '000003', product_type: 'Cold', cup_size: '500ml', description: '500ml cold-foam paper cup' },
    { id: '000004', product_type: 'Hot',  cup_size: '250ml', description: '250ml hot-drink paper cup' },
    { id: '000005', product_type: 'Hot',  cup_size: '350ml', description: '350ml hot-drink paper cup' },
    { id: '000006', product_type: 'Hot',  cup_size: '500ml', description: '500ml hot-drink paper cup' },
  ];

  const insert = db.prepare(
    `INSERT OR IGNORE INTO products (id, product_type, cup_size, description, active)
     VALUES (@id, @product_type, @cup_size, @description, 1)`
  );

  for (const p of products) {
    insert.run(p);
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

  db.exec('CREATE INDEX IF NOT EXISTS idx_leads_verification_status ON leads(verification_status)');

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
