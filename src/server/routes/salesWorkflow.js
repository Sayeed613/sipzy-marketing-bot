import { Router } from 'express';
import { listScenarios, simulateConversation, runScenario, getSalesFunnel } from '../services/salesWorkflow.js';

const router = Router();
router.get('/scenarios', (_req, res) => res.json({ success: true, data: listScenarios() }));
router.get('/funnel', (_req, res) => {
  try { res.json({ success: true, data: getSalesFunnel() }); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.post('/simulate', async (req, res) => {
  try {
    const result = await simulateConversation(req.body || {});
    res.json({ success: true, data: result });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.post('/simulate-scenario', async (req, res) => {
  try {
    const { scenario, ...options } = req.body || {};
    const result = await runScenario(scenario, options);
    res.json({ success: true, data: result });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
export default router;