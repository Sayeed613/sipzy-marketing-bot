import { Router } from 'express';
import {
  getTestCampaignState,
  upsertTestContact,
  setTestContactAuthorization,
  deleteTestContact,
  startTestCampaign,
  stopTestCampaign,
  listTestActivity,
} from '../services/testCampaign.js';

const router = Router();

function fail(res, err, status = 400) {
  return res.status(status).json({ success: false, error: err?.message || 'Request failed' });
}

router.get('/', (_req, res) => {
  try {
    return res.json({ success: true, data: getTestCampaignState() });
  } catch (err) {
    return fail(res, err, 500);
  }
});

router.get('/activity', (req, res) => {
  try {
    const activity = listTestActivity(req.query.limit);
    return res.json({ success: true, data: activity, meta: { count: activity.length } });
  } catch (err) {
    return fail(res, err, 500);
  }
});

router.post('/contacts', (req, res) => {
  try {
    const contact = upsertTestContact({ ...(req.body || {}), actor: req.user?.username || 'dashboard' });
    return res.status(201).json({ success: true, data: contact });
  } catch (err) {
    return fail(res, err, 400);
  }
});

router.patch('/contacts/:id', (req, res) => {
  try {
    if (req.body?.authorized !== undefined) {
      const contact = setTestContactAuthorization(
        req.params.id,
        req.body.authorized === true,
        req.user?.username || 'dashboard'
      );
      if (!contact) return res.status(404).json({ success: false, error: 'Test contact not found' });
      return res.json({ success: true, data: contact });
    }
    // Updating identity/details re-validates the configured-number rule.
    const contact = upsertTestContact({
      ...(req.body || {}),
      phone: req.body?.phone,
      authorized: req.body?.authorized,
      actor: req.user?.username || 'dashboard',
    });
    return res.json({ success: true, data: contact });
  } catch (err) {
    return fail(res, err, 400);
  }
});

router.delete('/contacts/:id', (req, res) => {
  try {
    const deleted = deleteTestContact(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Test contact not found' });
    return res.json({ success: true, data: { id: req.params.id, deleted: true } });
  } catch (err) {
    return fail(res, err, 400);
  }
});

router.post('/start', async (req, res) => {
  try {
    const state = await startTestCampaign({
      ...(req.body || {}),
      actor: req.user?.username || 'dashboard',
    });
    return res.json({ success: true, data: state });
  } catch (err) {
    return fail(res, err, 400);
  }
});

router.post('/stop', (req, res) => {
  try {
    const state = stopTestCampaign(req.user?.username || 'dashboard');
    return res.json({ success: true, data: state });
  } catch (err) {
    return fail(res, err, 400);
  }
});

export default router;
