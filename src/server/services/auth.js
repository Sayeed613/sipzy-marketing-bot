import crypto from 'node:crypto';
import argon2 from 'argon2';
import { getDb } from '../db/index.js';

const SESSION_HOURS = Number(process.env.SESSION_MAX_AGE_HOURS || 8);
const SESSION_MAX_AGE_MS = SESSION_HOURS * 60 * 60 * 1000;
const COOKIE_NAME = 'sipzy_session';

const ROLES = Object.freeze({
  ADMIN: 'admin',
  SALES: 'sales',
  VIEWER: 'viewer',
});

const VALID_ROLES = new Set(Object.values(ROLES));

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS || 5);
const loginAttempts = new Map();

function nowIso() {
  return new Date().toISOString();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function redactUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function validateUsername(username) {
  const value = String(username || '').trim();
  if (value.length < 3 || value.length > 64) return null;
  if (!/^[a-zA-Z0-9_.-]+$/.test(value)) return null;
  return value;
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 8) return null;
  return value;
}

function validateRole(role) {
  const value = String(role || '').trim().toLowerCase();
  if (!VALID_ROLES.has(value)) return null;
  return value;
}

export async function hashPassword(password) {
  return argon2.hash(String(password), {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(String(hash), String(password));
  } catch {
    return false;
  }
}

export function getUserById(id) {
  if (!id) return null;
  return getDb().prepare('SELECT id, username, email, role, disabled, created_at, updated_at, last_login_at FROM users WHERE id = ?').get(id) || null;
}

export function getUserByUsername(username) {
  const normalized = validateUsername(username);
  if (!normalized) return null;
  return getDb().prepare('SELECT id, username, email, role, disabled, password_hash, created_at, updated_at, last_login_at FROM users WHERE username = ?').get(normalized) || null;
}

export function countUsers() {
  return getDb().prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

export function listUsers() {
  return getDb()
    .prepare('SELECT id, username, email, role, disabled, created_at, updated_at, last_login_at FROM users ORDER BY created_at ASC')
    .all();
}

export async function createUser({ username, password, email = '', role = ROLES.VIEWER }) {
  const cleanUsername = validateUsername(username);
  if (!cleanUsername) throw new Error('username must be 3-64 characters and use only letters, numbers, dots, underscores or hyphens');
  const cleanPassword = validatePassword(password);
  if (!cleanPassword) throw new Error('password must be at least 8 characters');
  const cleanRole = validateRole(role);
  if (!cleanRole) throw new Error('role must be admin, sales or viewer');
  const cleanEmail = String(email || '').trim().slice(0, 254);

  const existing = getUserByUsername(cleanUsername);
  if (existing) throw new Error('username already exists');

  const id = crypto.randomUUID();
  const hash = await hashPassword(cleanPassword);
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO users (id, username, email, password_hash, role, disabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(id, cleanUsername, cleanEmail, hash, cleanRole, now, now);

  return getUserById(id);
}

export async function authenticateUser(username, password, context = {}) {
  const cleanUsername = validateUsername(username);
  if (!cleanUsername) throw new Error('invalid_credentials');
  const ip = String(context.ip || 'unknown');

  const throttleKey = `${ip}:${cleanUsername}`;
  const record = loginAttempts.get(throttleKey);
  const now = Date.now();
  if (record && record.count >= LOGIN_MAX_ATTEMPTS && now - record.firstAt < LOGIN_WINDOW_MS) {
    throw new Error('too_many_attempts');
  }

  const user = getUserByUsername(cleanUsername);
  const valid = user && !user.disabled && (await verifyPassword(user.password_hash, password));

  if (!valid) {
    const current = loginAttempts.get(throttleKey) || { count: 0, firstAt: now };
    if (now - current.firstAt >= LOGIN_WINDOW_MS) {
      current.count = 0;
      current.firstAt = now;
    }
    current.count += 1;
    loginAttempts.set(throttleKey, current);
    throw new Error('invalid_credentials');
  }

  loginAttempts.delete(throttleKey);
  const updatedNow = nowIso();
  getDb().prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(updatedNow, updatedNow, user.id);
  return getUserById(user.id);
}

export function createSession(userId, context = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const id = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_MAX_AGE_MS);
  getDb()
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, ip, user_agent, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      userId,
      hashToken(token),
      String(context.ip || '').slice(0, 128),
      String(context.userAgent || '').slice(0, 512),
      now.toISOString(),
      now.toISOString(),
      expires.toISOString()
    );
  return { token, expiresAt: expires.toISOString() };
}

export function getSessionUser(token) {
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT s.id AS session_id, s.user_id, s.expires_at, s.last_seen_at, u.id, u.username, u.email, u.role, u.disabled
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(hashToken(token));
  if (!row) return null;
  if (row.disabled) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    getDb().prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
    return null;
  }

  // Sliding session refresh: update last_seen_at occasionally.
  const lastSeen = new Date(row.last_seen_at).getTime();
  if (Date.now() - lastSeen > 5 * 60 * 1000) {
    getDb().prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(nowIso(), row.session_id);
  }

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    sessionId: row.session_id,
  };
}

export function destroySession(token) {
  if (!token) return;
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function destroySessionsForUser(userId) {
  if (!userId) return;
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function updateUserRole(userId, role) {
  const cleanRole = validateRole(role);
  if (!cleanRole) throw new Error('invalid role');
  const user = getUserById(userId);
  if (!user) throw new Error('user not found');
  getDb().prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(cleanRole, nowIso(), userId);
  return getUserById(userId);
}

export function setUserDisabled(userId, disabled) {
  const user = getUserById(userId);
  if (!user) throw new Error('user not found');
  getDb().prepare('UPDATE users SET disabled = ?, updated_at = ? WHERE id = ?').run(disabled ? 1 : 0, nowIso(), userId);
  if (disabled) destroySessionsForUser(userId);
  return getUserById(userId);
}

export async function changePasswordAsync(userId, newPassword) {
  const cleanPassword = validatePassword(newPassword);
  if (!cleanPassword) throw new Error('password must be at least 8 characters');
  const user = getUserById(userId);
  if (!user) throw new Error('user not found');
  const hash = await hashPassword(cleanPassword);
  getDb().prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, nowIso(), userId);
  destroySessionsForUser(userId);
  return getUserById(userId);
}

export function writeAuditLog({ actorUserId = null, actorUsername = '', action, entityType = '', entityId = '', metadata = {}, ip = '' }) {
  try {
    getDb()
      .prepare(
        `INSERT INTO audit_logs (id, actor_user_id, actor_username, action, entity_type, entity_id, metadata, ip, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        actorUserId,
        String(actorUsername || '').slice(0, 128),
        String(action || '').slice(0, 255),
        String(entityType || '').slice(0, 64),
        String(entityId || '').slice(0, 128),
        JSON.stringify(metadata || {}),
        String(ip || '').slice(0, 128),
        nowIso()
      );
  } catch {
    // Audit logging must never break the primary request.
  }
}

export function listAuditLogs(limit = 100) {
  return getDb().prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?').all(Number(limit) || 100);
}

export async function bootstrapAdminFromEnv() {
  if (countUsers() > 0) return null;
  const username =
    process.env.ADMIN_USERNAME ||
    process.env.SIPZY_ADMIN_USERNAME ||
    process.env.INITIAL_ADMIN_USERNAME;
  const password =
    process.env.ADMIN_PASSWORD ||
    process.env.SIPZY_ADMIN_PASSWORD ||
    process.env.INITIAL_ADMIN_PASSWORD;
  if (!username || !password) return null;
  const email = process.env.ADMIN_EMAIL || process.env.SIPZY_ADMIN_EMAIL || '';
  const user = await createUser({ username, password, email, role: ROLES.ADMIN });
  writeAuditLog({
    actorUserId: user.id,
    actorUsername: user.username,
    action: 'bootstrap_admin',
    entityType: 'user',
    entityId: user.id,
    metadata: { source: 'environment' },
  });
  return user;
}

export { COOKIE_NAME, ROLES, SESSION_MAX_AGE_MS };
export default {
  ROLES,
  hashPassword,
  verifyPassword,
  getUserById,
  getUserByUsername,
  countUsers,
  listUsers,
  createUser,
  authenticateUser,
  createSession,
  getSessionUser,
  destroySession,
  destroySessionsForUser,
  updateUserRole,
  setUserDisabled,
  changePasswordAsync,
  writeAuditLog,
  listAuditLogs,
  bootstrapAdminFromEnv,
  COOKIE_NAME,
  SESSION_MAX_AGE_MS,
};