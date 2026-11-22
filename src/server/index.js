import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { initDb, closeDb, DB_FILE, DATA_DIR, getDb } from './db/index.js';
import leadsRouter from './routes/leads.js';
import enquiriesRouter from './routes/enquiries.js';
import productsRouter from './routes/products.js';
import activityRouter from './routes/activity.js';
import analyzerRouter from './routes/analyzer.js';
import suppressionsRouter from './routes/suppressions.js';
import googlePlacesRouter from './routes/googlePlaces.js';
import { listLeads } from './services/leads.js';
import { listEnquiries } from './services/enquiries.js';
import { backfillFromOptOuts, migrateSuppressionPhones } from './services/suppressions.js';
import { outreachStats } from './services/outreach.js';

/**
 * SIPZY Marketing Bot - Backend Entry
 *
 * REST + (future) WhatsApp webhook endpoint. No external APIs wired yet:
 * - No WhatsApp SDK / WhatsApp Cloud API configured
 * - No AI / LLM client initialised
 * - No email service connected
 *
 * Database: SQLite via better-sqlite3, file stored in data/sipzy.db
 * (excluded from Git). All SQL is parameterized.
 */

const PORT = Number(process.env.PORT || 4000);

const app = express();

// ---- Middleware -----
app.use(cors()); // allow the Vite dev server origin during development
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ---- Mount API v1 routes ----
app.use('/api/v1/leads', leadsRouter);
app.use('/api/v1/enquiries', enquiriesRouter);
app.use('/api/v1/products', productsRouter);
app.use('/api/v1/activity', activityRouter);
app.use('/api/v1', analyzerRouter);
app.use('/api/v1/suppressions', suppressionsRouter);
app.use('/api/v1/google-places', googlePlacesRouter);

// ---- Health check (before DB init so it always works) ----
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'sipzy-marketing-bot',
    timestamp: new Date().toISOString(),
  });
});

// ---- Synthetic health that includes DB readiness ----
// The DB is initialised at startup (initDb()). This endpoint confirms
// the service is up and the DB is ready.
// NOTE: uses getDb() to run a lightweight query but does NOT close the
// shared singleton (_db) - the services hold the same connection and
// closing it would break them until the next request reopens it.
app.get('/api/v1/health', async (_req, res) => {
  try {
    const db = getDb();
    // Just touch the products table; discard the result.
    db.prepare('SELECT COUNT(*) AS n FROM products').get();
    res.json({
      status: 'ok',
      service: 'sipzy-marketing-bot',
      timestamp: new Date().toISOString(),
      db: 'ready',
    });
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      service: 'sipzy-marketing-bot',
      timestamp: new Date().toISOString(),
      db: 'unavailable',
      error: err.message,
    });
  }
});

// ---- Dashboard statistics endpoint ----
app.get('/api/v1/dashboard-stats', (_req, res) => {
  try {
    const leads = listLeads();
    const enquiries = listEnquiries({});

    // Enquiry statuses per the SIPZY marketing definition:
    //  - 'new'                     => new enquiry
    //  - 'interest-requested'      => customer replied interested
    //  - 'more-info-requested'     => more information requested
    //  - 'quote-requested'         => quote requested
    //  - 'quotation-sent'          => quotation sent
    //  - 'sample-requested'        => sample requested
    //  - 'negotiation'             => negotiation
    //  - 'confirmed-order'         => confirmed order
    //  - 'not-interested'          => not interested
    //  - 'opted-out'               => customer opted out
    const newEnquiries = enquiries.filter((e) => e.enquiry_status === 'new').length;
    const interestedCustomers = enquiries.filter((e) => e.enquiry_status === 'interest-requested' || e.enquiry_status === 'more-info-requested').length;
    const quoteRequests = enquiries.filter((e) => e.enquiry_status === 'quote-requested' || e.enquiry_status === 'quotation-sent' || e.enquiry_status === 'sample-requested').length;
    const confirmedOrders = enquiries.filter((e) => e.enquiry_status === 'confirmed-order' || e.enquiry_status === 'negotiation').length;

    const outreach = outreachStats();

    res.json({
      status: 'ok',
      success: true,
      data: {
        totalLeads: leads.length,
        totalEnquiries: enquiries.length,
        newEnquiries,
        interestedCustomers,
        quoteRequests,
        confirmedOrders,
        suppressedContacts: outreach.suppressedContacts,
        outreachReadyLeads: outreach.outreachReadyLeads,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---- 404 handler for unknown API routes --------------------------
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found', path: _req.originalUrl });
});

// ---- 500 handler for caught errors --------------------------------
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ---- Startup -----------------------------------------------------
async function main() {
  // initDb is idempotent; safe to run on every start.
  initDb();
  console.log(`[sipzy] database initialised at ${DB_FILE}`);

  // Canonicalise Indian phone numbers written by older versions. Rows that
  // would collide are left intact; matching understands both spellings.
  const migrated = migrateSuppressionPhones();
  if (migrated.updated > 0 || migrated.conflicts > 0) {
    console.log(
      `[sipzy] suppression phones: canonicalised ${migrated.updated}, kept ${migrated.conflicts} on legacy spellings`
    );
  }

  // Honour opt-outs recorded before the suppression table existed. This
  // only inserts/merges suppression rows; enquiries and leads are untouched.
  const backfilled = backfillFromOptOuts();
  if (backfilled.scanned > 0) {
    console.log(
      `[sipzy] suppression registry: scanned ${backfilled.scanned} opted-out enquiries, added ${backfilled.added}`
    );
  }

  app.listen(PORT, () => {
    console.log(`[sipzy] backend listening on http://localhost:${PORT}`);
    console.log(`[sipzy] API v1 ready at http://localhost:${PORT}/api/v1`);
  }).on('error', (err) => {
    console.error('[sipzy] failed to start server:', err.message);
    process.exit(1);
  });
}

main();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[sipzy] shutting down...');
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[sipzy] shutting down...');
  closeDb();
  process.exit(0);
});
