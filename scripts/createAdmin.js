#!/usr/bin/env node
/**
 * Create (or promote) a dashboard account.
 *
 * Usage:
 *   npm run admin:create -- --username admin --role admin
 *   ADMIN_USERNAME=admin ADMIN_PASSWORD=... npm run admin:create
 *
 * If no password is supplied, a random one is generated and printed once.
 * Passwords are hashed with Argon2id; nothing is stored in plaintext.
 */

import 'dotenv/config';
import crypto from 'node:crypto';
import { initDb, closeDb } from '../src/server/db/index.js';
import {
  createUser,
  getUserByUsername,
  listUsers,
  ROLES,
  writeAuditLog,
} from '../src/server/services/auth.js';

function arg(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
    return process.argv[index + 1];
  }
  return undefined;
}

async function main() {
  initDb();

  const username = arg('username') || process.env.ADMIN_USERNAME || process.env.SIPZY_ADMIN_USERNAME || '';
  const role = (arg('role') || process.env.ADMIN_ROLE || ROLES.ADMIN).toLowerCase();
  const email = arg('email') || process.env.ADMIN_EMAIL || '';
  let password = arg('password') || process.env.ADMIN_PASSWORD || process.env.SIPZY_ADMIN_PASSWORD || '';

  if (!username) {
    console.error('A username is required. Use --username <name> or ADMIN_USERNAME.');
    console.error(`Existing users: ${listUsers().map((u) => `${u.username} (${u.role})`).join(', ') || 'none'}`);
    process.exitCode = 1;
    return;
  }

  if (![ROLES.ADMIN, ROLES.SALES, ROLES.VIEWER].includes(role)) {
    console.error('Role must be admin, sales or viewer.');
    process.exitCode = 1;
    return;
  }

  let generated = false;
  if (!password) {
    password = crypto.randomBytes(18).toString('base64url');
    generated = true;
  }

  const existing = getUserByUsername(username);
  if (existing) {
    console.error(`User "${existing.username}" already exists.`);
    process.exitCode = 1;
    return;
  }

  const user = await createUser({ username, password, email, role });
  writeAuditLog({
    actorUsername: 'cli',
    action: 'create_user_cli',
    entityType: 'user',
    entityId: user.id,
    metadata: { role: user.role },
  });

  console.log(`Created ${user.username} with role ${user.role}.`);
  if (generated) {
    console.log(`One-time password: ${password}`);
    console.log('Store it securely and change it after first login.');
  }
}

main()
  .catch((err) => {
    console.error('Failed to create user:', err.message);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
