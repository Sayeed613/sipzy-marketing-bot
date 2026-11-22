import { Router } from 'express';
import {
  createActivity,
  readActivity,
  listActivity,
  deleteActivity,
  validateInput,
} from '../services/activity.js';

const router = Router();

// POST /api/v1/activity
router.post('/', (req, res) => {
  try {
    const { errors, data } = validateInput(req.body);
    if (errors.length) {
      return res.status(400).json({
        success: false,
        error: errors.map((e) => `${e.field}: ${e.message}`).join('; '),
      });
    }
    const activity = createActivity(req.body);
    return res.status(201).json({ success: true, data: activity });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/v1/activity?lead_id=...&channel=...&status=...
router.get('/', (req, res) => {
  try {
    const { lead_id, channel, status } = req.query;
    const activities = listActivity({ leadId: lead_id, channel, status });
    return res.json({ success: true, data: activities });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/activity/:id
router.get('/:id', (req, res) => {
  try {
    const activity = readActivity(req.params.id);
    if (!activity) {
      return res.status(404).json({ success: false, error: 'Activity not found' });
    }
    return res.json({ success: true, data: activity });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/v1/activity/:id
router.delete('/:id', (req, res) => {
  try {
    const deleted = deleteActivity(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Activity not found' });
    }
    return res.json({ success: true, data: { id: req.params.id, deleted: true } });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
