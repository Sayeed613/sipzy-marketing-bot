import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { readLead } from '../services/leads.js';
import { checkLeadOutreach } from '../services/outreach.js';
import { createActivity, listActivity } from '../services/activity.js';
import { buildIntroMessage, canComposeForLead, phoneForWhatsAppLink } from '../services/outreach-compose.js';

const router = Router();

/**
 * POST /api/v1/outreach/compose
 * Body: { lead_id }
 * Returns a personalized intro message + wa.me link, only if the lead
 * passes all safeguards (verified, approved, not suppressed, no opt-out).
 */
router.post('/compose', (req, res) => {
  try {
    const { lead_id } = req.body || {};
    if (!lead_id || typeof lead_id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'lead_id is required',
      });
    }

    const lead = readLead(lead_id);
    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found',
      });
    }

    // Use the existing outreach readiness guard.
    const check = checkLeadOutreach(lead_id);
    if (!check || !check.allowed) {
      return res.json({
        success: true,
        data: {
          lead,
          allowed: false,
          reason: check?.reason || 'unknown',
          message: null,
          wa_link: null,
        },
      });
    }

    // Generate the personalized intro message (local logic only).
    const message = buildIntroMessage(lead);
    const waPhone = phoneForWhatsAppLink(lead.phone);
    const encodedMessage = encodeURIComponent(message);
    const wa_link = waPhone ? `https://wa.me/${waPhone}?text=${encodedMessage}` : null;

    return res.json({
      success: true,
      data: {
        lead,
        allowed: true,
        message,
        wa_link,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * POST /api/v1/outreach/record
 * Body: { lead_id, message, notes?, delivery_status?, activity_type? }
 * Records the outreach attempt in the existing activity table.
 * channel is always 'whatsapp' for composer-generated messages.
 */
router.post('/record', (req, res) => {
  try {
    const { lead_id, message, notes, delivery_status, activity_type } = req.body || {};
    if (!lead_id || typeof lead_id !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'lead_id is required',
      });
    }

    // Verify the lead still exists.
    const lead = readLead(lead_id);
    if (!lead) {
      return res.status(404).json({
        success: false,
        error: 'Lead not found',
      });
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    const activity = createActivity({
      lead_id,
      channel: 'whatsapp',
      activity_type: activity_type || 'message',
      message_ref: message?.trim().slice(0, 500) || '',
      delivery_status: delivery_status || 'pending',
      activity_date: now,
      notes: notes
        ? `Outreach composer message. ${notes}`
        : 'Outreach composer message — sent manually via WhatsApp.',
    });

    return res.status(201).json({
      success: true,
      data: activity,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /api/v1/outreach/activity?lead_id=...
 * List outreach activities for a lead (reuses existing activity service).
 */
router.get('/activity', (req, res) => {
  try {
    const { lead_id } = req.query;
    const activities = listActivity({ leadId: lead_id });
    return res.json({
      success: true,
      data: activities,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

export default router;
