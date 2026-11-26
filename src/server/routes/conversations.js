import { Router } from 'express';
import {
  listConversations,
  readConversation,
  handleInboundWhatsAppMessage,
  approveReply,
  rejectReply,
  regenerateReply,
  updateConversation,
} from '../services/conversations.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    const conversations = listConversations(req.query || {});
    return res.json({ success: true, data: conversations, meta: { count: conversations.length } });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const conversation = readConversation(req.params.id);
    if (!conversation) return res.status(404).json({ success: false, error: 'Conversation not found' });
    return res.json({ success: true, data: conversation });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.patch('/:id', (req, res) => {
  try {
    const conversation = updateConversation(req.params.id, req.body || {});
    if (!conversation) return res.status(404).json({ success: false, error: 'Conversation not found' });
    return res.json({ success: true, data: conversation });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/:id/approve', (req, res) => {
  try {
    const conversation = approveReply(req.params.id, req.body?.approved_by || 'dashboard');
    if (!conversation) return res.status(404).json({ success: false, error: 'Conversation not found' });
    return res.json({ success: true, data: conversation });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/:id/reject', (req, res) => {
  try {
    const conversation = rejectReply(req.params.id, req.body?.note || '');
    if (!conversation) return res.status(404).json({ success: false, error: 'Conversation not found' });
    return res.json({ success: true, data: conversation });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/:id/regenerate', async (req, res) => {
  try {
    const conversation = await regenerateReply(req.params.id);
    if (!conversation) return res.status(404).json({ success: false, error: 'Conversation not found' });
    return res.json({ success: true, data: conversation });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// Test helper endpoint for local processing.
router.post('/process-inbound', async (req, res) => {
  try {
    const conversation = await handleInboundWhatsAppMessage(req.body || {});
    return res.json({ success: true, data: conversation });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

export default router;