import { COOKIE_NAME, SESSION_MAX_AGE_MS } from '../services/auth.js';

export function parseCookies(req) {
  const out = {};
  const header = req?.headers?.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(rest.join('='));
    } catch {
      out[key] = rest.join('=');
    }
  }
  return out;
}

export function sessionToken(req) {
  return parseCookies(req)[COOKIE_NAME] || '';
}

function cookieFlags() {
  const secure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
  return ['HttpOnly', 'Path=/', 'SameSite=Lax', ...(secure ? ['Secure'] : [])];
}

export function sessionCookie(token) {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`,
    ...cookieFlags(),
  ].join('; ');
}

export function clearSessionCookie() {
  return [`${COOKIE_NAME}=`, 'Max-Age=0', ...cookieFlags()].join('; ');
}

export { COOKIE_NAME };
