/**
 * Error response sanitisation.
 *
 * Services throw friendly validation errors, but lower layers (SQLite,
 * body parsers, drivers) can surface implementation details. Anything
 * that looks internal is replaced with a generic message before it
 * reaches a client.
 */

const INTERNAL_MARKERS = [
  'sqlite_',
  'sqlite3',
  'better-sqlite3',
  'no such table',
  'no such column',
  'unique constraint failed',
  'foreign key constraint failed',
  'database is locked',
  'syntax error',
  'stack',
  'at Object.',
  'at async ',
  'ENOENT',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'node:internal',
  'argon2',
];

export function isInternalErrorText(text) {
  const value = String(text || '');
  if (!value) return false;
  const lower = value.toLowerCase();
  return INTERNAL_MARKERS.some((marker) => lower.includes(marker.toLowerCase()));
}

export function sanitizeErrorText(text, fallback = 'Request could not be completed') {
  const value = String(text || '').trim();
  if (!value) return fallback;
  if (value.length > 500) return fallback;
  if (isInternalErrorText(value)) return fallback;
  return value;
}

/** Never log secrets; redact anything that looks like a credential. */
export function redactSecrets(text) {
  return String(text || '')
    .replace(/(bearer\s+)[A-Za-z0-9._-]+/gi, '$1[redacted]')
    .replace(/((?:password|token|secret|authorization|cookie)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]');
}

/** Redact phone numbers in operational logs (keep a short suffix for support). */
export function redactPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 4) return '[redacted]';
  return `***${digits.slice(-4)}`;
}

export default { sanitizeErrorText, isInternalErrorText, redactSecrets, redactPhone };
