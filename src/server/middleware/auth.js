import { getSessionUser } from '../services/auth.js';
import { sessionToken } from '../utils/cookies.js';

export function attachUser(req, _res, next) {
  const token = sessionToken(req);
  req.user = token ? getSessionUser(token) : null;
  next();
}

const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/v1/health',
  '/api/v1/auth/login',
  '/api/v1/auth/logout',
  '/api/v1/auth/setup',
]);

const PUBLIC_PREFIXES = ['/api/v1/whatsapp/webhook'];

export function isPublicPath(pathname) {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function requestPath(req) {
  return String(req.originalUrl || req.url || req.path || '').split('?')[0];
}

function isReadMethod(method) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method);
}

/** Default-deny: every /api route requires a session unless explicitly public. */
export function requireAuth(req, res, next) {
  if (isPublicPath(requestPath(req))) return next();
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  if (req.user.role === 'viewer' && !isReadMethod(req.method)) {
    return res.status(403).json({ success: false, error: 'Viewer accounts are read-only' });
  }
  next();
}

/**
 * Sales may write only within the sales workflow. Every other domain
 * (campaigns, suppressions, WhatsApp sending, products, settings) is
 * admin-only for mutations.
 */
const SALES_WRITE_DOMAINS = new Set([
  'leads',
  'enquiries',
  'conversations',
  'quotations',
  'orders',
]);

export function domainAccess(domain) {
  return (req, res, next) => {
    // Meta webhook endpoints stay public (authenticated by HMAC signature).
    if (isPublicPath(requestPath(req))) return next();
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    if (req.user.role === 'admin') return next();
    if (isReadMethod(req.method)) return next();
    if (req.user.role === 'sales' && SALES_WRITE_DOMAINS.has(domain)) return next();
    return res.status(403).json({ success: false, error: 'Insufficient permissions for this action' });
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions' });
    }
    next();
  };
}

export { requestPath };
