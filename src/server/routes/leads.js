import { Router } from 'express';
import {
  upsertLead,
  createLead,
  readLead,
  updateLead,
  deleteLead,
  validateLead,
  importLeadsFromCsv,
  leadsToCsv,
  findDuplicateLeadGroups,
} from '../services/leads.js';
import {
  listLeadsWithSuppression,
  listOutreachReadyLeads,
} from '../services/outreach.js';

const router = Router();

// POST /api/v1/leads  ->  upsert (idempotent)
router.post('/', (req, res) => {
  try {
    const { errors, data } = validateLead(req.body);
    if (errors.length) {
      return res.status(400).json({
        success: false,
        error: errors.map((e) => `${e.field}: ${e.message}`).join('; '),
      });
    }
    const lead = upsertLead(req.body);
    return res.status(201).json({ success: true, data: lead });
  } catch (err) {
    if (err.message.includes('already exists')) {
      return res.status(409).json({ success: false, error: err.message });
    }
    return res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/v1/leads/outreach-ready
// The only list a future outreach campaign may send to: suppressed contacts
// and leads with an opted-out enquiry are excluded. Must stay before /:id.
router.get('/outreach-ready', (_req, res) => {
  try {
    const leads = listOutreachReadyLeads();
    return res.json({ success: true, data: leads, meta: { count: leads.length } });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/leads?status=...&city=...&category=...&qualification=...&search=...
// &exclude_suppressed=true&duplicates=true
// Every row carries `suppressed` / `suppression_reason` flags so the
// dashboard can show which contacts must not be contacted.
router.get('/', (req, res) => {
  try {
    const {
      status,
      city,
      category,
      qualification,
      search,
      verification_status,
      quality,
      exclude_suppressed: excludeSuppressedRaw,
      duplicates,
    } = req.query;
    const leads = listLeadsWithSuppression({
      status,
      city,
      category,
      qualification,
      search,
      verification_status,
      quality,
      excludeSuppressed: excludeSuppressedRaw === 'true',
      duplicatesOnly: duplicates === 'true',
    });
    return res.json({ success: true, data: leads });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/leads/import  (CSV text in JSON body: { csv: "..." })
router.post('/import', (req, res) => {
  try {
    const csv = req.body?.csv ?? req.body?.data;
    if (typeof csv !== 'string' || csv.trim() === '') {
      return res.status(400).json({ success: false, error: 'csv: CSV text is required' });
    }
    const result = importLeadsFromCsv(csv);
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/v1/leads/export  (same filters as GET /, returns CSV)
router.get('/export', (req, res) => {
  try {
    const {
      status,
      city,
      category,
      qualification,
      search,
      verification_status,
      quality,
      exclude_suppressed: excludeSuppressedRaw,
      duplicates,
    } = req.query;
    const leads = listLeadsWithSuppression({
      status,
      city,
      category,
      qualification,
      search,
      verification_status,
      quality,
      excludeSuppressed: excludeSuppressedRaw === 'true',
      duplicatesOnly: duplicates === 'true',
    });
    const csv = leadsToCsv(leads);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sipzy-leads.csv"');
    return res.send(csv);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/leads/duplicates
router.get('/duplicates', (_req, res) => {
  try {
    const groups = findDuplicateLeadGroups();
    return res.json({ success: true, data: groups, meta: { count: groups.length } });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/v1/leads/:id  (partial update)
router.patch('/:id', (req, res) => {
  try {
    const updated = updateLead(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }
    return res.json({ success: true, data: updated });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/v1/leads/:id
router.get('/:id', (req, res) => {
  try {
    const lead = readLead(req.params.id);
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }
    return res.json({ success: true, data: lead });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/v1/leads/:id
router.delete('/:id', (req, res) => {
  try {
    const deleted = deleteLead(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }
    return res.json({ success: true, data: { id: req.params.id, deleted: true } });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
