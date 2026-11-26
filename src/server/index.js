import 'dotenv/config';
import { createApp } from './app.js';
import { initDb, closeDb, DB_FILE } from './db/index.js';
import { bootstrapAdminFromEnv, countUsers } from './services/auth.js';
import { backfillFromOptOuts, migrateSuppressionPhones } from './services/suppressions.js';
import { recoverQueue } from './services/campaigns.js';

/**
 * SIPZY Marketing Bot - Backend Entry
 *
 * Database: SQLite via better-sqlite3, file stored in data/sipzy.db
 * (excluded from Git). All SQL is parameterized.
 *
 * Outbound WhatsApp sending, the campaign scheduler and paid AI providers
 * remain disabled by default (DRY_RUN=true, WHATSAPP_SENDING_ENABLED=false,
 * AI_PROVIDER=local).
 */

const PORT = Number(process.env.PORT || 4000);

let server = null;

async function main() {
  // initDb is idempotent; safe to run on every start.
  initDb();
  console.log(`[sipzy] database initialised at ${DB_FILE}`);

  // Security foundation: create the first admin from environment variables
  // when the users table is empty. Existing accounts are never overwritten.
  try {
    const bootstrapped = await bootstrapAdminFromEnv();
    if (bootstrapped) {
      console.log(`[sipzy] initial admin created from environment: ${bootstrapped.username}`);
    } else if (countUsers() === 0) {
      console.warn(
        '[sipzy] no users exist yet. Set ADMIN_USERNAME/ADMIN_PASSWORD or run: npm run admin:create'
      );
    }
  } catch (err) {
    console.error('[sipzy] admin bootstrap failed:', err.message);
  }

  // Canonicalise Indian phone numbers written by older versions. Rows that
  // would collide are left intact; matching understands both spellings.
  const migrated = migrateSuppressionPhones();
  if (migrated.updated > 0 || migrated.conflicts > 0) {
    console.log(
      `[sipzy] suppression phones: canonicalised ${migrated.updated}, kept ${migrated.conflicts} on legacy spellings`
    );
  }

  // Recover any outreach queue rows left in 'sending' by a previous crash.
  recoverQueue();

  // Honour opt-outs recorded before the suppression table existed. This
  // only inserts/merges suppression rows; enquiries and leads are untouched.
  const backfilled = backfillFromOptOuts();
  if (backfilled.scanned > 0) {
    console.log(
      `[sipzy] suppression registry: scanned ${backfilled.scanned} opted-out enquiries, added ${backfilled.added}`
    );
  }

  const app = createApp();

  server = app
    .listen(PORT, () => {
      console.log(`[sipzy] backend listening on http://localhost:${PORT}`);
      console.log(`[sipzy] API v1 ready at http://localhost:${PORT}/api/v1`);
    })
    .on('error', (err) => {
      console.error('[sipzy] failed to start server:', err.message);
      process.exit(1);
    });
}

main().catch((err) => {
  console.error('[sipzy] startup failed:', err.message);
  closeDb();
  process.exit(1);
});

// Graceful shutdown: stop accepting connections, then close SQLite so WAL
// data is checkpointed before exit.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[sipzy] shutting down (${signal})...`);
  const finish = () => {
    closeDb();
    process.exit(0);
  };
  if (server) {
    server.close(finish);
    // Do not wait forever on keep-alive sockets.
    setTimeout(finish, 5000).unref?.();
  } else {
    finish();
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
