import express from 'express';
import cors from 'cors';
import { getDb } from './db/index.js';
import leadsRouter from './routes/leads.js';
import enquiriesRouter from './routes/enquiries.js';
import productsRouter from './routes/products.js';
import activityRouter from './routes/activity.js';
import analyzerRouter from './routes/analyzer.js';
import suppressionsRouter from './routes/suppressions.js';
import googlePlacesRouter from './routes/googlePlaces.js';
import whatsappRouter from './routes/whatsapp.js';
import campaignsRouter from './routes/campaigns.js';
import testCampaignRouter from './routes/testCampaign.js';
import conversationsRouter from './routes/conversations.js';
import handoffsRouter from './routes/handoffs.js';
import quotationsRouter from './routes/quotations.js';
import ordersRouter from './routes/orders.js';
import salesWorkflowRouter from './routes/salesWorkflow.js';
import authRouter from './routes/auth.js';
import { attachUser, requireAuth, domainAccess } from './middleware/auth.js';
import { createRateLimiter, clientIpKey } from './middleware/rateLimit.js';
import { auditMutations } from './middleware/audit.js';
import { errorSanitizer } from './middleware/errorSanitizer.js';
import { listLeads } from './services/leads.js';
import { listEnquiries } from './services/enquiries.js';
import { outreachStats } from './services/outreach.js';
import outreachRouter from './routes/outreach.js';

/**
 * Build the Express application (middleware + routes).
 *
 * Kept separate from the process entry point so tests can exercise the
 * HTTP surface on an ephemeral port without starting production startup
 * migrations or binding to the configured port.
 */
export function createApp() {
  const app = express();

  // ---- CORS (trusted origins only) -----
  const configuredOrigins = String(process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedOrigins = configuredOrigins.length
    ? configuredOrigins
    : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173'];

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    })
  );

  // ---- Body parsing with size limits -----
  app.use(
    express.json({
      limit: process.env.REQUEST_BODY_LIMIT || '10kb',
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: process.env.REQUEST_BODY_LIMIT || '10kb' }));

  // ---- Rate limiting -----
  const globalLimiter = createRateLimiter({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
    max: Number(process.env.RATE_LIMIT_MAX || 100),
    keyGenerator: clientIpKey,
    // Health checks and Meta webhook deliveries must never be throttled.
    // originalUrl is used because req.path is mount-relative here.
    skip: (req) => {
      const pathname = String(req.originalUrl || req.url || '').split('?')[0];
      return (
        pathname === '/api/health' ||
        pathname === '/api/v1/health' ||
        pathname === '/api/v1/whatsapp/webhook' ||
        pathname.startsWith('/api/v1/whatsapp/webhook/')
      );
    },
  });
  const authLimiter = createRateLimiter({
    windowMs: Number(
      process.env.AUTH_RATE_LIMIT_WINDOW_MS || process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000
    ),
    max: Number(process.env.AUTH_RATE_LIMIT_MAX || 10),
    keyGenerator: clientIpKey,
  });
  app.use('/api', globalLimiter);

  // ---- Authentication context + default protection -----
  app.use(attachUser);
  app.use('/api/v1/auth/login', authLimiter);
  app.use('/api/v1/auth/setup', authLimiter);
  app.use('/api', requireAuth);
  app.use(auditMutations);
  app.use(errorSanitizer);

  // ---- Health checks (public, no secrets) ----
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'sipzy-marketing-bot',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/v1/health', (_req, res) => {
    try {
      getDb().prepare('SELECT COUNT(*) AS n FROM products').get();
      res.json({
        status: 'ok',
        service: 'sipzy-marketing-bot',
        timestamp: new Date().toISOString(),
        db: 'ready',
      });
    } catch {
      res.status(503).json({
        status: 'degraded',
        service: 'sipzy-marketing-bot',
        timestamp: new Date().toISOString(),
        db: 'unavailable',
      });
    }
  });

  // ---- Dashboard statistics endpoint ----
  // Registered before the generic /api/v1 routers: campaignsRouter exposes
  // '/:id', which would otherwise shadow this fixed path.
  app.get('/api/v1/dashboard-stats', (_req, res) => {
    try {
      const leads = listLeads();
      const enquiries = listEnquiries({});

      const newEnquiries = enquiries.filter((e) => e.enquiry_status === 'new').length;
      const interestedCustomers = enquiries.filter(
        (e) => e.enquiry_status === 'interest-requested' || e.enquiry_status === 'more-info-requested'
      ).length;
      const quoteRequests = enquiries.filter(
        (e) =>
          e.enquiry_status === 'quote-requested' ||
          e.enquiry_status === 'quotation-sent' ||
          e.enquiry_status === 'sample-requested'
      ).length;
      const sampleRequests = enquiries.filter((e) => e.enquiry_status === 'sample-requested').length;
      const confirmedOrders = enquiries.filter(
        (e) => e.enquiry_status === 'confirmed-order' || e.enquiry_status === 'negotiation'
      ).length;
      const optedOut = enquiries.filter((e) => e.enquiry_status === 'opted-out').length;
      const conversionRate = enquiries.length
        ? Math.round((confirmedOrders / enquiries.length) * 1000) / 10
        : 0;

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
          sampleRequests,
          optedOut,
          conversionRate,
          suppressedContacts: outreach.suppressedContacts,
          outreachReadyLeads: outreach.outreachReadyLeads,
        },
      });
    } catch {
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  // ---- Mount API v1 routes ----
  app.use('/api/v1/auth', authRouter);

  app.use('/api/v1/leads', domainAccess('leads'), leadsRouter);
  app.use('/api/v1/enquiries', domainAccess('enquiries'), enquiriesRouter);
  app.use('/api/v1/products', domainAccess('products'), productsRouter);
  app.use('/api/v1/activity', domainAccess('activity'), activityRouter);
  app.use('/api/v1', domainAccess('analyzer'), analyzerRouter);
  app.use('/api/v1/suppressions', domainAccess('suppressions'), suppressionsRouter);
  app.use('/api/v1/google-places', domainAccess('google-places'), googlePlacesRouter);
  app.use('/api/v1/whatsapp', domainAccess('whatsapp'), whatsappRouter);
  app.use('/api/v1/conversations', domainAccess('conversations'), conversationsRouter);
  app.use('/api/v1/handoffs', domainAccess('handoffs'), handoffsRouter);
  app.use('/api/v1/quotations', domainAccess('quotations'), quotationsRouter);
  app.use('/api/v1/orders', domainAccess('orders'), ordersRouter);
  app.use('/api/v1/sales-workflow', domainAccess('sales-workflow'), salesWorkflowRouter);
  app.use('/api/v1/test-campaign', domainAccess('campaigns'), testCampaignRouter);
  app.use('/api/v1/campaigns', domainAccess('campaigns'), campaignsRouter);
  app.use('/api/v1', domainAccess('campaigns'), campaignsRouter);

  // Outreach Composer (reuses existing leads/outreach/activity safeguards)
  app.use('/api/v1/outreach', domainAccess('leads'), outreachRouter);

  // ---- 404 handler for unknown routes ----
  app.use((_req, res) => {
    res.status(404).json({ success: false, error: 'Not found' });
  });

  // ---- Error handler ----
  // Malformed/oversized bodies and blocked CORS origins are reported as
  // plain JSON; stack traces and SQL details never reach the client.
  app.use((err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode || 500);
    if (err?.type === 'entity.too.large' || status === 413) {
      return res.status(413).json({ success: false, error: 'Request body too large' });
    }
    if (err?.type === 'entity.parse.failed' || (status === 400 && err instanceof SyntaxError)) {
      return res.status(400).json({ success: false, error: 'Malformed request body' });
    }
    if (err?.message === 'Not allowed by CORS') {
      return res.status(403).json({ success: false, error: 'Origin not allowed' });
    }
    if (status >= 400 && status < 500) {
      return res.status(status).json({ success: false, error: 'Request could not be completed' });
    }
    console.error('[sipzy] unhandled error:', err instanceof Error ? err.message : 'unknown');
    return res.status(500).json({ success: false, error: 'Internal server error' });
  });

  return app;
}

export default createApp;
