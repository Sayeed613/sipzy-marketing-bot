import { Router } from 'express';
import { createQuotation, listQuotations, readQuotation, updateQuotation } from '../services/quotations.js';

const router = Router();
router.get('/', (req, res) => {
  try { const data = listQuotations(req.query || {}); res.json({ success: true, data, meta: { count: data.length } }); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.get('/:id', (req, res) => {
  try {
    const data = readQuotation(req.params.id);
    if (!data) return res.status(404).json({ success: false, error: 'Quotation not found' });
    res.json({ success: true, data });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.post('/', (req, res) => {
  try { res.status(201).json({ success: true, data: createQuotation(req.body || {}) }); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.patch('/:id', (req, res) => {
  try {
    const data = updateQuotation(req.params.id, req.body || {});
    if (!data) return res.status(404).json({ success: false, error: 'Quotation not found' });
    res.json({ success: true, data });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
export default router;