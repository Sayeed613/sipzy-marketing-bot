import { writeAuditLog } from '../services/auth.js';

/**
 * Audit trail for business mutations.
 *
 * Logs quotation, order, lead, campaign and permission changes. Only the
 * shape of the request is recorded (domain, method, id) - never bodies,
 * credentials, tokens or customer message content.
 */

const AUDITED_DOMAINS = new Set([
  'leads',
  'quotations',
  'orders',
  'campaigns',
  'test-campaign',
  'suppressions',
  'enquiries',
  'conversations',
  'handoffs',
  'users',
  'auth',
]);

const METHOD_ACTIONS = {
  POST: 'create',
  PATCH: 'update',
  PUT: 'update',
  DELETE: 'delete',
};

function domainFromPath(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  // /api/v1/<domain>/...
  if (parts[0] === 'api' && parts[1] === 'v1') return parts[2] || '';
  if (parts[0] === 'api') return parts[1] || '';
  return parts[0] || '';
}

function entityIdFromPath(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  const index = parts[0] === 'api' && parts[1] === 'v1' ? 3 : 2;
  const candidate = parts[index];
  if (!candidate) return '';
  // Ignore collection-level verbs such as /campaigns/queue/process.
  return /^[A-Za-z0-9_-]{1,128}$/.test(candidate) && candidate.length >= 3 ? candidate.slice(0, 128) : '';
}

function actionFromPath(method, pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  const tail = parts[parts.length - 1] || '';
  if (method === 'POST' && ['pause', 'resume', 'archive', 'approve', 'reject', 'retry', 'cancel', 'process'].includes(tail)) {
    return tail;
  }
  return METHOD_ACTIONS[method] || method.toLowerCase();
}

export function auditMutations(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const pathname = String(req.originalUrl || req.url || '').split('?')[0];
  const domain = domainFromPath(pathname);
  if (!AUDITED_DOMAINS.has(domain)) return next();
  // Auth login/logout are audited in their handlers.
  if (domain === 'auth') return next();

  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    writeAuditLog({
      actorUserId: req.user?.id || null,
      actorUsername: req.user?.username || '',
      action: `${domain}.${actionFromPath(req.method, pathname)}`,
      entityType: domain,
      entityId: entityIdFromPath(pathname),
      metadata: { method: req.method, status: res.statusCode },
      ip: String(req.ip || req.socket?.remoteAddress || ''),
    });
  });
  next();
}

export default auditMutations;
