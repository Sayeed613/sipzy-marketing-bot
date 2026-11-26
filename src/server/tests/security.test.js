import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dbFile = path.join(os.tmpdir(), `sipzy-security-${process.pid}-${Date.now()}.db`);
process.env.SIPZY_DB_FILE = dbFile;
process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = '987654321';
process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
process.env.WHATSAPP_VERIFY_TOKEN = 'verify-me-token';
process.env.DRY_RUN = 'true';
process.env.WHATSAPP_SENDING_ENABLED = 'false';
process.env.TEST_MODE = 'false';
process.env.AUTH_LOGIN_MAX_ATTEMPTS = '100';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.RATE_LIMIT_MAX = '10000';

const { initDb, closeDb, getDb } = await import('../db/index.js');
initDb();
const { createApp } = await import('../app.js');

let server;
let baseUrl;
const app = createApp();

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbFile + suffix);
    } catch {
      // disposable temp file
    }
  }
});

async function http(method, pathname, { body, cookie, headers = {} } = {}) {
  const init = {
    method,
    headers: { ...headers },
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  if (cookie) init.headers.Cookie = cookie;
  const res = await fetch(`${baseUrl}${pathname}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  return { status: res.status, body: json, text, setCookies };
}

function sessionCookieFrom(res) {
  const raw = res.setCookies.find((value) => value.startsWith('sipzy_session='));
  assert.ok(raw, 'expected a session cookie');
  return raw.split(';')[0];
}

async function login(username, password) {
  const res = await http('POST', '/api/v1/auth/login', { body: { username, password } });
  assert.equal(res.status, 200, `login failed for ${username}: ${res.text}`);
  return sessionCookieFrom(res);
}

const state = {};

test('initial admin setup succeeds once and never returns the password hash', async () => {
  const res = await http('POST', '/api/v1/auth/setup', {
    body: { username: 'admin', password: 'Sup3rSecretPass!', email: 'admin@sipzy.test' },
  });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.body.data.user.username, 'admin');
  assert.equal(res.body.data.user.role, 'admin');
  assert.equal(res.body.data.user.password_hash, undefined);
  assert.equal(res.body.data.user.password, undefined);
  assert.ok(!('token' in res.body.data));

  const second = await http('POST', '/api/v1/auth/setup', {
    body: { username: 'another', password: 'Sup3rSecretPass!' },
  });
  assert.equal(second.status, 409);
});

test('unauthenticated business API requests are rejected', async () => {
  const routes = [
    ['GET', '/api/v1/leads'],
    ['GET', '/api/v1/enquiries'],
    ['GET', '/api/v1/quotations'],
    ['GET', '/api/v1/orders'],
    ['GET', '/api/v1/dashboard-stats'],
    ['GET', '/api/v1/campaigns'],
    ['GET', '/api/v1/whatsapp/messages'],
    ['POST', '/api/v1/leads'],
  ];
  for (const [method, pathname] of routes) {
    const res = await http(method, pathname, method === 'POST' ? { body: {} } : {});
    assert.equal(res.status, 401, `${method} ${pathname} should be 401, got ${res.status}`);
  }
});

test('health endpoint stays public and exposes no secrets', async () => {
  for (const pathname of ['/api/health', '/api/v1/health']) {
    const res = await http('GET', pathname);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    const text = JSON.stringify(res.body).toLowerCase();
    assert.ok(!text.includes('token'));
    assert.ok(!text.includes('secret'));
  }
});

test('invalid login fails, valid login succeeds', async () => {
  const bad = await http('POST', '/api/v1/auth/login', {
    body: { username: 'admin', password: 'wrong-password' },
  });
  assert.equal(bad.status, 401);
  assert.ok(!JSON.stringify(bad.body).includes('wrong-password'));

  const cookie = await login('admin', 'Sup3rSecretPass!');
  state.adminCookie = cookie;

  const me = await http('GET', '/api/v1/auth/me', { cookie });
  assert.equal(me.status, 200);
  assert.equal(me.body.data.role, 'admin');
  assert.equal(me.body.data.password_hash, undefined);
});

test('admin can create sales and viewer accounts', async () => {
  const sales = await http('POST', '/api/v1/auth/users', {
    cookie: state.adminCookie,
    body: { username: 'sales', password: 'SalesPassw0rd!', role: 'sales' },
  });
  assert.equal(sales.status, 201, sales.text);

  const viewer = await http('POST', '/api/v1/auth/users', {
    cookie: state.adminCookie,
    body: { username: 'viewer', password: 'ViewerPassw0rd!', role: 'viewer' },
  });
  assert.equal(viewer.status, 201, viewer.text);

  const list = await http('GET', '/api/v1/auth/users', { cookie: state.adminCookie });
  assert.equal(list.status, 200);
  for (const user of list.body.data) {
    assert.equal(user.password_hash, undefined);
    assert.equal(user.token, undefined);
  }

  state.salesCookie = await login('sales', 'SalesPassw0rd!');
  state.viewerCookie = await login('viewer', 'ViewerPassw0rd!');
});

test('viewer can read but cannot modify records', async () => {
  const read = await http('GET', '/api/v1/leads', { cookie: state.viewerCookie });
  assert.equal(read.status, 200);

  const create = await http('POST', '/api/v1/leads', {
    cookie: state.viewerCookie,
    body: { business_name: 'Viewer Cafe' },
  });
  assert.equal(create.status, 403);

  const patch = await http('PATCH', '/api/v1/enquiries/000001', {
    cookie: state.viewerCookie,
    body: { enquiry_status: 'new' },
  });
  assert.equal(patch.status, 403);
});

test('sales can write sales records but not admin-only ones', async () => {
  const createLead = await http('POST', '/api/v1/leads', {
    cookie: state.salesCookie,
    body: {
      business_name: 'Sales Cafe',
      city: 'Bengaluru',
      business_cat: 'Cafe',
      phone: '+91 90000 11111',
    },
  });
  assert.equal(createLead.status, 201, createLead.text);
  state.leadId = createLead.body.data.id;

  const createCampaign = await http('POST', '/api/v1/campaigns', {
    cookie: state.salesCookie,
    body: { name: 'Should be blocked', channel: 'whatsapp' },
  });
  assert.equal(createCampaign.status, 403);

  const whatsappSend = await http('POST', '/api/v1/whatsapp/send', {
    cookie: state.salesCookie,
    body: { to: '919999999999', body: 'hello' },
  });
  assert.equal(whatsappSend.status, 403);

  const manageUsers = await http('POST', '/api/v1/auth/users', {
    cookie: state.salesCookie,
    body: { username: 'sneaky', password: 'SneakyPassw0rd!', role: 'admin' },
  });
  assert.equal(manageUsers.status, 403);
});

test('admin has permitted access across business routes', async () => {
  const leads = await http('GET', '/api/v1/leads', { cookie: state.adminCookie });
  assert.equal(leads.status, 200);
  assert.ok(Array.isArray(leads.body.data));

  const stats = await http('GET', '/api/v1/dashboard-stats', { cookie: state.adminCookie });
  assert.equal(stats.status, 200);
  assert.equal(typeof stats.body.data.totalLeads, 'number');

  const campaign = await http('POST', '/api/v1/campaigns', {
    cookie: state.adminCookie,
    body: { name: 'Admin campaign', channel: 'whatsapp' },
  });
  assert.equal(campaign.status, 201, campaign.text);

  const products = await http('GET', '/api/v1/products', { cookie: state.adminCookie });
  assert.equal(products.status, 200);
  assert.equal(products.body.data.length, 6);
});

test('logout invalidates the session', async () => {
  const cookie = await login('admin', 'Sup3rSecretPass!');
  const before = await http('GET', '/api/v1/auth/me', { cookie });
  assert.equal(before.status, 200);

  const logout = await http('POST', '/api/v1/auth/logout', { cookie, body: {} });
  assert.equal(logout.status, 200);

  const afterLogout = await http('GET', '/api/v1/auth/me', { cookie });
  assert.equal(afterLogout.status, 401);
});

test('expired sessions are rejected', async () => {
  const cookie = await login('admin', 'Sup3rSecretPass!');
  const db = getDb();
  const token = decodeURIComponent(cookie.split('=')[1]);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(
    new Date(Date.now() - 60_000).toISOString(),
    tokenHash
  );

  const res = await http('GET', '/api/v1/auth/me', { cookie });
  assert.equal(res.status, 401);
});

test('Meta webhook stays public and rejects invalid signatures', async () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '1555', phone_number_id: '123' },
              contacts: [{ profile: { name: 'Webhook Customer' }, wa_id: '919876500001' }],
              messages: [
                {
                  from: '919876500001',
                  id: 'wamid.security1',
                  timestamp: '1700000000',
                  type: 'text',
                  text: { body: 'Need 1000 cold cups 350ml in Bengaluru' },
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
  const raw = JSON.stringify(payload);
  const signature = 'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(raw).digest('hex');

  const invalid = await http('POST', '/api/v1/whatsapp/webhook', {
    body: raw,
    headers: { 'X-Hub-Signature-256': 'sha256=deadbeef' },
  });
  assert.equal(invalid.status, 401);

  const missing = await http('POST', '/api/v1/whatsapp/webhook', { body: raw });
  assert.equal(missing.status, 401);

  const valid = await http('POST', '/api/v1/whatsapp/webhook', {
    body: raw,
    headers: { 'X-Hub-Signature-256': signature },
  });
  assert.equal(valid.status, 200, valid.text);
  assert.equal(valid.body.data.messages.length, 1);

  const verify = await http(
    'GET',
    '/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me-token&hub.challenge=abc123',
    {}
  );
  assert.equal(verify.status, 200);
  assert.equal(verify.text, 'abc123');
});

test('malformed and oversized bodies are handled safely', async () => {
  const malformed = await http('POST', '/api/v1/auth/login', {
    body: '{"username": "admin",',
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error, 'Malformed request body');

  const big = JSON.stringify({ username: 'x'.repeat(50_000), password: 'y' });
  const oversized = await http('POST', '/api/v1/auth/login', {
    body: big,
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(oversized.status, 413);
});

test('rate limiting blocks repeated requests but never the webhook', async () => {
  const previousMax = process.env.RATE_LIMIT_MAX;
  const previousAuth = process.env.AUTH_RATE_LIMIT_MAX;
  process.env.RATE_LIMIT_MAX = '3';
  process.env.AUTH_RATE_LIMIT_MAX = '1000';

  const limitedApp = createApp();
  const limitedServer = limitedApp.listen(0, '127.0.0.1');
  await new Promise((resolve) => limitedServer.once('listening', resolve));
  const limitedUrl = `http://127.0.0.1:${limitedServer.address().port}`;

  try {
    const statuses = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await fetch(`${limitedUrl}/api/v1/products`, { headers: { Cookie: 'sipzy_session=invalid' } });
      statuses.push(res.status);
    }
    assert.equal(statuses[0], 401);
    assert.ok(statuses.includes(429), `expected a 429, got ${statuses.join(',')}`);

    // Webhook deliveries are exempt from the global limiter.
    const webhookStatuses = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await fetch(`${limitedUrl}/api/v1/whatsapp/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ object: 'whatsapp_business_account', entry: [] }),
      });
      webhookStatuses.push(res.status);
    }
    assert.ok(!webhookStatuses.includes(429));
  } finally {
    await new Promise((resolve) => limitedServer.close(resolve));
    process.env.RATE_LIMIT_MAX = previousMax;
    process.env.AUTH_RATE_LIMIT_MAX = previousAuth;
  }
});

test('auth endpoints have a stricter limit than the global API', async () => {
  const previous = process.env.AUTH_RATE_LIMIT_MAX;
  process.env.AUTH_RATE_LIMIT_MAX = '2';
  process.env.RATE_LIMIT_MAX = '1000';

  const strictApp = createApp();
  const strictServer = strictApp.listen(0, '127.0.0.1');
  await new Promise((resolve) => strictServer.once('listening', resolve));
  const strictUrl = `http://127.0.0.1:${strictServer.address().port}`;

  try {
    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await fetch(`${strictUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'wrong-password' }),
      });
      statuses.push(res.status);
    }
    assert.ok(statuses.includes(429), `expected 429 from login limit, got ${statuses.join(',')}`);
  } finally {
    await new Promise((resolve) => strictServer.close(resolve));
    process.env.AUTH_RATE_LIMIT_MAX = previous;
  }
});

test('brute-force protection reports generic failures without leaking accounts', async () => {
  const unknown = await http('POST', '/api/v1/auth/login', {
    body: { username: 'no-such-user', password: 'irrelevant-password' },
  });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.body.error, 'Invalid username or password');
});

test('audit log records business and permission changes', async () => {
  const res = await http('GET', '/api/v1/auth/audit-logs', { cookie: state.adminCookie });
  assert.equal(res.status, 200);
  const actions = res.body.data.map((entry) => entry.action);
  assert.ok(actions.includes('create_user'));
  assert.ok(actions.some((action) => action.startsWith('leads.')), `actions: ${actions.join(',')}`);
});

test('existing WhatsApp sending stays disabled', async () => {
  const res = await http('POST', '/api/v1/whatsapp/send', {
    cookie: state.adminCookie,
    body: { to: '919876543210', body: 'Hello' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.sent, false);
  assert.equal(res.body.data.reason, 'sending_disabled');
});

test('unauthenticated requests are rejected before any data is returned', async () => {
  const res = await http('GET', '/api/v1/leads', {});
  assert.equal(res.status, 401);
  assert.equal(res.body.data, undefined);
});
