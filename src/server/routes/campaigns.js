import { Router } from 'express';
import {
  listCampaigns,
  readCampaign,
  createCampaign,
  updateCampaign,
  pauseCampaign,
  resumeCampaign,
  archiveCampaign,
  deleteCampaign,
  previewCampaignAudience,
  selectCampaignLeads,
  listCampaignLeads,
  removeCampaignLead,
  listTemplates,
  readTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  renderTemplate,
  enqueueCampaign,
  listQueue,
  cancelQueueItem,
  retryQueueItem,
  processCampaignCycle,
  getSchedulerConfig,
  updateSchedulerConfig,
  getCampaignStats,
} from '../services/campaigns.js';

const router = Router();

function handle(res, fn) {
  try {
    return res.json({ success: true, data: fn() });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
}

router.get('/settings', (_req, res) => handle(res, () => getSchedulerConfig()));
router.patch('/settings', (req, res) => handle(res, () => updateSchedulerConfig(req.body || {})));

router.get('/templates', (req, res) => {
  try {
    const templates = listTemplates(req.query || {});
    return res.json({ success: true, data: templates, meta: { count: templates.length } });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});
router.get('/templates/:id', (req, res) => {
  try {
    const template = readTemplate(req.params.id);
    if (!template) return res.status(404).json({ success: false, error: 'Template not found' });
    return res.json({ success: true, data: template });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});
router.post('/templates', (req, res) => {
  try {
    const template = createTemplate(req.body || {});
    return res.status(201).json({ success: true, data: template });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});
router.patch('/templates/:id', (req, res) => {
  try {
    const template = updateTemplate(req.params.id, req.body || {});
    if (!template) return res.status(404).json({ success: false, error: 'Template not found' });
    return res.json({ success: true, data: template });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});
router.delete('/templates/:id', (req, res) => {
  try {
    const deleted = deleteTemplate(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Template not found' });
    return res.json({ success: true, data: { id: req.params.id, deleted: true } });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});
router.post('/templates/:id/render', (req, res) => {
  try {
    const template = readTemplate(req.params.id);
    if (!template) return res.status(404).json({ success: false, error: 'Template not found' });
    return res.json({ success: true, data: { body: renderTemplate(template, req.body?.variables || {}) } });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/queue', (req, res) => {
  try {
    const queue = listQueue(req.query || {});
    return res.json({ success: true, data: queue, meta: { count: queue.length } });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});
router.post('/queue/process', async (req, res) => {
  try {
    const result = await processCampaignCycle(req.body || {});
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});
router.post('/queue/:id/cancel', (req, res) => {
  try {
    const cancelled = cancelQueueItem(req.params.id, req.body?.reason || 'cancelled');
    if (!cancelled) return res.status(404).json({ success: false, error: 'Queue item not found or already final' });
    return res.json({ success: true, data: { id: req.params.id, cancelled: true } });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});
router.post('/queue/:id/retry', (req, res) => {
  try {
    const item = retryQueueItem(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Queue item not found' });
    return res.json({ success: true, data: item });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/preview', (req, res) => {
  try {
    const preview = previewCampaignAudience(req.body || {});
    return res.json({ success: true, data: preview });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/', (req, res) => {
  try {
    const campaigns = listCampaigns(req.query || {});
    return res.json({ success: true, data: campaigns, meta: { count: campaigns.length } });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});
router.get('/:id', (req, res) => {
  try {
    const campaign = readCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });
    return res.json({ success: true, data: campaign });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});
router.post('/', (req, res) => {
  try {
    const campaign = createCampaign(req.body || {});
    return res.status(201).json({ success: true, data: campaign });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});
router.patch('/:id', (req, res) => {
  try {
    const campaign = updateCampaign(req.params.id, req.body || {});
    if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });
    return res.json({ success: true, data: campaign });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});
router.delete('/:id', (req, res) => {
  try {
    const deleted = deleteCampaign(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Campaign not found' });
    return res.json({ success: true, data: { id: req.params.id, deleted: true } });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});
router.post('/:id/pause', (req, res) => {
  try {
    const campaign = pauseCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });
    return res.json({ success: true, data: campaign });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});
router.post('/:id/resume', (req, res) => {
  try {
    const campaign = resumeCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });
    return res.json({ success: true, data: campaign });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});
router.post('/:id/archive', (req, res) => {
  try {
    const campaign = archiveCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });
    return res.json({ success: true, data: campaign });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});
router.post('/:id/leads', (req, res) => {
  try {
    const leads = selectCampaignLeads(req.params.id, req.body || {});
    return res.json({ success: true, data: leads });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});
router.get('/:id/leads', (req, res) => {
  try {
    const leads = listCampaignLeads(req.params.id);
    return res.json({ success: true, data: leads, meta: { count: leads.length } });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});
router.delete('/:id/leads/:leadId', (req, res) => {
  try {
    const removed = removeCampaignLead(req.params.id, req.params.leadId);
    if (!removed) return res.status(404).json({ success: false, error: 'Campaign lead not found' });
    return res.json({ success: true, data: { removed: true } });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});
router.post('/:id/enqueue', (req, res) => {
  try {
    const result = enqueueCampaign(req.params.id, req.body || {});
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});
router.get('/:id/stats', (req, res) => {
  try {
    const stats = getCampaignStats(req.params.id);
    if (!stats) return res.status(404).json({ success: false, error: 'Campaign not found' });
    return res.json({ success: true, data: stats });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// Top-level aliases for alternative API naming.
router.get('/outreach-queue', (req, res) => {
  try {
    const queue = listQueue(req.query || {});
    return res.json({ success: true, data: queue, meta: { count: queue.length } });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});
router.get('/message-templates', (req, res) => {
  try {
    const templates = listTemplates(req.query || {});
    return res.json({ success: true, data: templates, meta: { count: templates.length } });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});
router.get('/scheduler', (_req, res) => {
  try {
    return res.json({ success: true, data: getSchedulerConfig() });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

export default router;