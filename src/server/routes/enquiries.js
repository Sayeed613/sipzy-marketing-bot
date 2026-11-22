import { Router } from 'express';
import {
  createEnquiry,
  deleteEnquiry,
  readEnquiry,
  listEnquiries,
  updateEnquiry,
  validateEnquiry,
} from '../services/enquiries.js';
import { analyzeMessage, buildEnquiryFromAnalysis } from '../services/analyzer.js';
import { registerOptOut } from '../services/suppressions.js';

const router = Router();

const MAX_MESSAGE_LENGTH = 5000;

// POST /api/v1/enquiries/from-message
// Analyses a customer message, then saves the resulting enquiry.
// Values the user reviewed and corrected in the dashboard take priority
// over the parser. Nothing is sent to the customer.
router.post('/from-message', (req, res) => {
  const body = req.body || {};
  const { message } = body;

  if (typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({
      success: false,
      error: 'message: a customer message is required',
    });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({
      success: false,
      error: `message: must be ${MAX_MESSAGE_LENGTH} characters or fewer`,
    });
  }

  try {
    const analysis = analyzeMessage(message);

    // Only include fields the client actually sent, so the parser output
    // fills anything the reviewer left untouched.
    const reviewFields = [
      'lead_id',
      'customer_name',
      'business_name',
      'phone',
      'email',
      'product_type',
      'cup_size',
      'quantity',
      'delivery_location',
      'follow_up_date',
      'enquiry_status',
    ];
    const overrides = {};
    for (const field of reviewFields) {
      if (body[field] !== undefined) overrides[field] = body[field];
    }

    const { errors, data } = buildEnquiryFromAnalysis(analysis, overrides);

    if (errors.length) {
      return res.status(400).json({ success: false, error: errors.join('; ') });
    }

    // Keep the original message and let the enquiry service re-validate.
    const enquiry = createEnquiry(data);

    // An explicit opt-out in the message always suppresses the contact,
    // even if the reviewer reclassified the enquiry as something else.
    // `createEnquiry` already handles the opted-out status; registering
    // again is idempotent and returns the same row.
    let suppression = null;
    if (analysis.intent === 'opted_out') {
      suppression = registerOptOut({
        phone: enquiry.phone,
        email: enquiry.email,
        customer_name: enquiry.customer_name,
        business_name: enquiry.business_name,
        source_message: enquiry.original_message,
        enquiry_id: enquiry.id,
      });
    }

    return res.status(201).json({ success: true, data: { enquiry, analysis, suppression } });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/v1/enquiries
router.post('/', (req, res) => {
  try {
    const { errors, data } = validateEnquiry(req.body);
    if (errors.length) {
      return res.status(400).json({
        success: false,
        error: errors.map((e) => `${e.field}: ${e.message}`).join('; '),
      });
    }
    const enquiry = createEnquiry(req.body);
    return res.status(201).json({ success: true, data: enquiry });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/v1/enquiries?lead_id=...&status=...&product_type=...&cup_size=...
router.get('/', (req, res) => {
  try {
    const { lead_id, status, product_type: productType, cup_size: cupSize } = req.query;
    const enquiries = listEnquiries({
      leadId: lead_id,
      status,
      productType,
      cupSize,
    });
    return res.json({ success: true, data: enquiries });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/enquiries/:id
router.get('/:id', (req, res) => {
  try {
    const enquiry = readEnquiry(req.params.id);
    if (!enquiry) {
      return res.status(404).json({ success: false, error: 'Enquiry not found' });
    }
    return res.json({ success: true, data: enquiry });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/v1/enquiries/:id  (partial update)
router.patch('/:id', (req, res) => {
  try {
    const existing = readEnquiry(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Enquiry not found' });
    }
    const updated = updateEnquiry(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Enquiry not found' });
    }
    return res.json({ success: true, data: updated });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// DELETE /api/v1/enquiries/:id
router.delete('/:id', (req, res) => {
  try {
    const deleted = deleteEnquiry(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Enquiry not found' });
    }
    return res.json({ success: true, data: { id: req.params.id, deleted: true } });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
