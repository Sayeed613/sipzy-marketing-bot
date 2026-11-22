/**
 * SIPZY Marketing Bot - Database Initialization Script
 *
 * Run once (or on every start) to create the SQLite schema and seed the
 * six SIPZY product variants:
 *
 *   npm run db:init
 *
 * The script is idempotent: tables use IF NOT EXISTS and products use
 * INSERT OR IGNORE on the UNIQUE(product_type, cup_size) key, so
 * running it multiple times never duplicates data.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initDb } from '../db/index.js';

/**
 * Project root (repo root).
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..');

/** Dedicated data directory for the SQLite file. */
const DATA_DIR = join(PROJECT_ROOT, 'data');

/**
 * Main entry point.
 */
function main() {
  // initDb() handles directory creation, schema, and seeding.
  const { file } = initDb();
  console.log(`[db:init] database ready at ${file}`);
  console.log('[db:init] products seeded (6 variants, idempotent)');
}

main();
