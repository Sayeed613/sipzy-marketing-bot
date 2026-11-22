import { Router } from 'express';
import { listProducts } from '../services/products.js';

const router = Router();

// GET /api/v1/products?product_type=...&active=...
router.get('/', (req, res) => {
  try {
    const { product_type: productType, active } = req.query;
    const products = listProducts({
      productType,
      active: active !== undefined ? (active === 'true' || active === '1') : undefined,
    });
    return res.json({ success: true, data: products });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
