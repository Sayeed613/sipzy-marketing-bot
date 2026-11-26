import { Router } from 'express';
import {
  getGooglePlacesConfig,
  validateSearchInput,
  searchGooglePlaces,
  saveGooglePlaceAsLead,
} from '../services/googlePlaces.js';

const router = Router();

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const rateLimitBuckets = new Map();

function checkRateLimit(key) {
  const now = Date.now();
  const bucket = (rateLimitBuckets.get(key) || []).filter((time) => now - time < RATE_LIMIT_WINDOW_MS);
  if (bucket.length >= RATE_LIMIT_MAX) {
    rateLimitBuckets.set(key, bucket);
    return false;
  }
  bucket.push(now);
  rateLimitBuckets.set(key, bucket);
  return true;
}

function clientKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

async function handleSearch(req, res) {
  try {
    const input = req.method === 'GET' ? req.query : (req.body || {});
    const { errors, data } = validateSearchInput(input);
    if (errors.length) {
      return res.status(400).json({
        success: false,
        error: errors.map((e) => `${e.field}: ${e.message}`).join('; '),
      });
    }

    if (!checkRateLimit(clientKey(req))) {
      return res.status(429).json({
        success: false,
        error: 'Too many Google Places searches. Please wait and try again.',
      });
    }

    const result = await searchGooglePlaces(data);
    return res.json({ success: true, data: result });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ success: false, error: err.message });
  }
}

// GET /api/v1/google-places/config
router.get('/config', (_req, res) => {
  return res.json({ success: true, data: getGooglePlacesConfig() });
});

// POST or GET /api/v1/google-places/search
router.post('/search', handleSearch);
router.get('/search', handleSearch);

router.post('/save', async (req, res) => {
  try {
    if (!checkRateLimit(clientKey(req))) {
      return res.status(429).json({
        success: false,
        error: 'Too many Google Places requests. Please wait and try again.',
      });
    }
    const result = await saveGooglePlaceAsLead(req.body || {});
    const status = result.created ? 201 : 200;
    const data = result.lead
      ? { ...result.lead, saved: result.saved, created: result.created, duplicate: result.duplicate, lead: result.lead }
      : result;
    return res.status(status).json({ success: true, data });
  } catch (err) {
    const status = err.status || 400;
    return res.status(status).json({ success: false, error: err.message });
  }
});

export default router;
