import { Router } from 'express';
import { analyzeMessage } from '../services/analyzer.js';

const router = Router();

const MAX_MESSAGE_LENGTH = 5000;

// POST /api/v1/analyze-message
// Analyses a customer message and returns structured extraction.
// Does NOT save anything and does NOT contact the customer.
router.post('/analyze-message', (req, res) => {
  const { message } = req.body || {};

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
    return res.json({ success: true, data: analysis });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
