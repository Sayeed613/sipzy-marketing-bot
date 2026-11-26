import { Router } from 'express';
import { normalizePhone } from '../services/suppressions.js';
import {
  getWhatsAppConfig,
  validateWhatsAppConfig,
  getVerifyToken,
  verifyWebhookSignature,
  processWhatsAppWebhook,
  listWhatsAppMessages,
  readWhatsAppMessage,
  updateWhatsAppMessage,
  sendWhatsAppMessage,
  WhatsAppError,
} from '../services/whatsapp.js';

const router = Router();

router.get('/status', (_req, res) => {
  return res.json({ success: true, data: getWhatsAppConfig() });
});

// Meta webhook verification (GET) and event delivery (POST).
router.get('/webhook', (req, res) => {
  const mode = String(req.query['hub.mode'] || '').trim();
  const token = String(req.query['hub.verify_token'] || '').trim();
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token && token === getVerifyToken() && challenge !== undefined) {
    return res.status(200).type('text/plain').send(String(challenge));
  }
  return res.sendStatus(403);
});

router.post('/webhook', async (req, res) => {
  const signature = req.get('x-hub-signature-256');
  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));

  if (!verifyWebhookSignature(rawBody, signature)) {
    return res.sendStatus(401);
  }

  try {
    const result = await processWhatsAppWebhook(req.body || {});
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

router.get('/messages', (req, res) => {
  try {
    const { phone, enquiry_id: enquiryId, status, limit } = req.query;
    const messages = listWhatsAppMessages({
      phone: phone ? String(phone) : undefined,
      enquiry_id: enquiryId ? String(enquiryId) : undefined,
      status: status ? String(status) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return res.json({ success: true, data: messages, meta: { count: messages.length } });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/messages/:id', (req, res) => {
  try {
    const message = readWhatsAppMessage(req.params.id);
    if (!message) return res.status(404).json({ success: false, error: 'Message not found' });
    return res.json({ success: true, data: message });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/messages/:id', (req, res) => {
  try {
    const updated = updateWhatsAppMessage(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ success: false, error: 'Message not found' });
    return res.json({ success: true, data: updated });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/test-number', (req, res) => {
  const errors = validateWhatsAppConfig();
  if (errors.length) {
    return res.status(503).json({ success: false, error: errors.join('; ') });
  }
  const phone = String(req.body?.phone || process.env.TEST_WHATSAPP_NUMBER || '').trim();
  const normalized = normalizePhone(phone);
  return res.json({
    success: true,
    data: {
      configured: true,
      input: phone,
      normalized,
      valid: Boolean(normalized),
      test_mode: process.env.TEST_MODE === 'true',
      sending_enabled: process.env.WHATSAPP_SENDING_ENABLED === 'true' && process.env.DRY_RUN !== 'true',
    },
  });
});

router.post('/send', async (req, res) => {
  try {
    const result = await sendWhatsAppMessage(req.body || {});
    return res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof WhatsAppError) {
      return res.status(err.status || 400).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Simulate an inbound WhatsApp message for local testing.
// This bypasses Meta signature verification (auth-protected, not public)
// and feeds directly into the full webhook processing pipeline so the
// message is stored, analysed, linked to a conversation, and audited —
// without needing Meta Cloud API credentials or a real WhatsApp message.
// Simulate an inbound WhatsApp message for local testing.
// This bypasses Meta signature verification (auth-protected, not public)
// and feeds directly into the full webhook processing pipeline so the
// message is stored, analysed, linked to a conversation, and audited —
// without needing Meta Cloud API credentials or a real WhatsApp message.
router.post('/simulate-inbound', async (req, res) => {
  try {
    const body = req.body || {};
    const phone = String(body.phone || body.from || '').trim();
    const messageBody = String(body.body || body.text || '').trim();
    const contactName = String(body.contact_name || body.contact?.profile?.name || '').trim();
    const externalId = String(body.external_id || body.id || `sim-${crypto.randomUUID()}`).trim();

    if (!phone) {
      return res.status(400).json({ success: false, error: 'phone or from is required' });
    }
    if (!messageBody) {
      return res.status(400).json({ success: false, error: 'body or text is required' });
    }

    // Build a Meta-shaped webhook payload from the simplified input.
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'sim-entry',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: phone, phone_number_id: 'sim' },
                contacts: contactName
                  ? [{ profile: { name: contactName }, wa_id: phone }]
                  : [{ wa_id: phone }],
                messages: [
                  {
                    from: phone,
                    id: externalId,
                    timestamp: String(Date.now() / 1000).slice(0, 10),
                    type: 'text',
                    text: { body: messageBody },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const result = await processWhatsAppWebhook(payload);

    return res.json({
      success: true,
      data: {
        simulated: true,
        phone,
        message_body: messageBody,
        external_id: externalId,
        contact_name: contactName,
        results: result,
      },
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

export default router;