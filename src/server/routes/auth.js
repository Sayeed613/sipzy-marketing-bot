import { Router } from 'express';
import {
  authenticateUser,
  createSession,
  destroySession,
  getSessionUser,
  createUser,
  listUsers,
  updateUserRole,
  setUserDisabled,
  writeAuditLog,
  listAuditLogs,
  countUsers,
  ROLES,
} from '../services/auth.js';
import { parseCookies, sessionCookie, clearSessionCookie, COOKIE_NAME } from '../utils/cookies.js';

const router = Router();

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

function userAgent(req) {
  return String(req.get('user-agent') || '');
}

function currentUser(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  return token ? getSessionUser(token) : null;
}

function isAdmin(req) {
  return req.user?.role === ROLES.ADMIN || currentUser(req)?.role === ROLES.ADMIN;
}

function adminOnly(req, res) {
  if (!isAdmin(req)) {
    res.status(403).json({ success: false, error: 'Admin access required' });
    return false;
  }
  return true;
}

// GET /api/v1/auth/me — session probe used by the dashboard.
router.get('/me', (req, res) => {
  const user = req.user || currentUser(req);
  if (!user) return res.status(401).json({ success: false, error: 'Not authenticated' });
  // Never expose the internal session identifier or any token material.
  const { id, username, email, role } = user;
  return res.json({ success: true, data: { id, username, email, role } });
});

// POST /api/v1/auth/login
router.post('/login', async (req, res) => {
  const username = req.body?.username ?? req.body?.user ?? req.body?.email;
  const password = req.body?.password;
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ success: false, error: 'username and password are required' });
  }

  try {
    const user = await authenticateUser(username, password, { ip: clientIp(req) });
    const session = createSession(user.id, { ip: clientIp(req), userAgent: userAgent(req) });
    res.setHeader('Set-Cookie', sessionCookie(session.token));
    writeAuditLog({
      actorUserId: user.id,
      actorUsername: user.username,
      action: 'login',
      entityType: 'session',
      entityId: user.id,
      metadata: {},
      ip: clientIp(req),
    });
    return res.json({ success: true, data: { user, expires_at: session.expiresAt } });
  } catch (err) {
    if (err.message === 'too_many_attempts') {
      return res.status(429).json({ success: false, error: 'Too many login attempts. Try again later.' });
    }
    return res.status(401).json({ success: false, error: 'Invalid username or password' });
  }
});

// POST /api/v1/auth/logout
router.post('/logout', (req, res) => {
  const token = parseCookies(req)[COOKIE_NAME];
  const user = token ? getSessionUser(token) : null;
  destroySession(token);
  res.setHeader('Set-Cookie', clearSessionCookie());
  if (user) {
    writeAuditLog({
      actorUserId: user.id,
      actorUsername: user.username,
      action: 'logout',
      entityType: 'session',
      entityId: user.sessionId,
      metadata: {},
      ip: clientIp(req),
    });
  }
  return res.json({ success: true, data: { logged_out: true } });
});

// POST /api/v1/auth/setup — one-time initial admin creation.
// Only available while no user account exists.
router.post('/setup', async (req, res) => {
  if (countUsers() > 0) {
    return res.status(409).json({ success: false, error: 'Initial setup already completed' });
  }
  try {
    const user = await createUser({
      username: req.body?.username,
      password: req.body?.password,
      email: req.body?.email,
      role: ROLES.ADMIN,
    });
    const session = createSession(user.id, { ip: clientIp(req), userAgent: userAgent(req) });
    res.setHeader('Set-Cookie', sessionCookie(session.token));
    writeAuditLog({
      actorUserId: user.id,
      actorUsername: user.username,
      action: 'initial_setup',
      entityType: 'user',
      entityId: user.id,
      metadata: {},
      ip: clientIp(req),
    });
    return res.status(201).json({ success: true, data: { user, expires_at: session.expiresAt } });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// ---- User management (admin only) ----
router.get('/users', (req, res) => {
  if (!adminOnly(req, res)) return;
  const users = listUsers();
  return res.json({ success: true, data: users, meta: { count: users.length } });
});

router.post('/users', async (req, res) => {
  if (!adminOnly(req, res)) return;
  const actor = req.user || currentUser(req);
  try {
    const created = await createUser({
      username: req.body?.username,
      password: req.body?.password,
      email: req.body?.email,
      role: req.body?.role || ROLES.VIEWER,
    });
    writeAuditLog({
      actorUserId: actor?.id || null,
      actorUsername: actor?.username || '',
      action: 'create_user',
      entityType: 'user',
      entityId: created.id,
      metadata: { role: created.role },
      ip: clientIp(req),
    });
    return res.status(201).json({ success: true, data: created });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.patch('/users/:id/role', (req, res) => {
  if (!adminOnly(req, res)) return;
  const actor = req.user || currentUser(req);
  try {
    const updated = updateUserRole(req.params.id, req.body?.role);
    writeAuditLog({
      actorUserId: actor?.id || null,
      actorUsername: actor?.username || '',
      action: 'update_user_role',
      entityType: 'user',
      entityId: updated.id,
      metadata: { role: updated.role },
      ip: clientIp(req),
    });
    return res.json({ success: true, data: updated });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/users/:id/disable', (req, res) => {
  if (!adminOnly(req, res)) return;
  const actor = req.user || currentUser(req);
  try {
    const updated = setUserDisabled(req.params.id, req.body?.disabled !== false);
    writeAuditLog({
      actorUserId: actor?.id || null,
      actorUsername: actor?.username || '',
      action: 'disable_user',
      entityType: 'user',
      entityId: updated.id,
      metadata: { disabled: Boolean(updated.disabled) },
      ip: clientIp(req),
    });
    return res.json({ success: true, data: updated });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/audit-logs', (req, res) => {
  if (!adminOnly(req, res)) return;
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  return res.json({ success: true, data: listAuditLogs(limit) });
});

export default router;
