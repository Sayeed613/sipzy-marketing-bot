import { Router } from 'express';
import { createHandoffTask, listHandoffTasks, readHandoffTask, updateHandoffTask } from '../services/handoffs.js';

const router = Router();
router.get('/', (req, res) => {
  try { const data = listHandoffTasks(req.query || {}); res.json({ success: true, data, meta: { count: data.length } }); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.get('/:id', (req, res) => {
  try {
    const data = readHandoffTask(req.params.id);
    if (!data) return res.status(404).json({ success: false, error: 'Handoff task not found' });
    res.json({ success: true, data });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.post('/', (req, res) => {
  try { res.status(201).json({ success: true, data: createHandoffTask(req.body || {}) }); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.patch('/:id', (req, res) => {
  try {
    const data = updateHandoffTask(req.params.id, req.body || {});
    if (!data) return res.status(404).json({ success: false, error: 'Handoff task not found' });
    res.json({ success: true, data });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
export default router;