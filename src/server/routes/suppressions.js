import { Router } from 'express';
import {
  checkOutreachAllowed,
  listSuppressions,
} from '../services/suppressions.js';
import { checkLeadOutreach } from '../services/outreach.js';

/**
 * Contact suppression API — read-only by design.
 *
 * There is intentionally no POST, PATCH or DELETE route: suppressions are
 * created automatically when an enquiry is classified as opted-out and can
 * never be removed from the dashboard.
 */
const router = Router();

// GET /api/v1/suppressions?q=nadia@example.com
router.get('/', (req, res) => {
  try {
    const records = listSuppressions({ q: req.query.q });
    return res.json({
      success: true,
      data: records,
      meta: { count: records.length, deletable: false },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/suppressions/check?phone=...&email=...&lead_id=...
// The guard any future outreach path must call before sending.
router.get('/check', (req, res) => {
  try {
    const { phone = '', email = '', lead_id: leadId = '' } = req.query;

    if (leadId) {
      const result = checkLeadOutreach(String(leadId));
      if (!result) {
        return res.status(404).json({ success: false, error: 'Lead not found' });
      }
      return res.json({
        success: true,
        data: {
          allowed: result.allowed,
          reason: result.reason,
          suppression: result.suppression,
          lead_id: result.lead.id,
          business_name: result.lead.business_name,
        },
      });
    }

    if (!String(phone).trim() && !String(email).trim()) {
      return res.status(400).json({
        success: false,
        error: 'phone, email or lead_id is required',
      });
    }

    const result = checkOutreachAllowed({ phone, email });
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
