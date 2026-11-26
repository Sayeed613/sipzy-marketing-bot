import { sanitizeErrorText, isInternalErrorText } from '../utils/errors.js';

/**
 * Defence-in-depth: replaces internal error text (SQL, stack frames) in
 * outgoing JSON error payloads. Route handlers keep their friendly
 * validation messages; only implementation details are hidden.
 */
export function errorSanitizer(_req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object' && body.success === false && typeof body.error === 'string') {
      if (isInternalErrorText(body.error)) {
        return originalJson({ ...body, error: sanitizeErrorText(body.error) });
      }
    }
    return originalJson(body);
  };
  next();
}

export default errorSanitizer;
