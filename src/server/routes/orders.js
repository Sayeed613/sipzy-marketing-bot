import { Router } from 'express';
import { createOrder, listOrders, readOrder, updateOrder } from '../services/orders.js';

const router = Router();
router.get('/', (req, res) => {
  try { const data = listOrders(req.query || {}); res.json({ success: true, data, meta: { count: data.length } }); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.get('/:id', (req, res) => {
  try {
    const data = readOrder(req.params.id);
    if (!data) return res.status(404).json({ success: false, error: 'Order not found' });
    res.json({ success: true, data });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.post('/', (req, res) => {
  try { res.status(201).json({ success: true, data: createOrder(req.body || {}) }); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.patch('/:id', (req, res) => {
  try {
    const data = updateOrder(req.params.id, req.body || {});
    if (!data) return res.status(404).json({ success: false, error: 'Order not found' });
    res.json({ success: true, data });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
export default router;