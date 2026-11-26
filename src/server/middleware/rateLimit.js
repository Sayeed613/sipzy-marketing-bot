/**
 * Small fixed-window rate limiter.
 *
 * Each limiter owns its own bucket map, so the global API limiter and the
 * stricter auth limiter never share counters. State is in-process only:
 * adequate for the single-node deployment this app targets.
 */
export function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 100, keyGenerator, skip } = {}) {
  const buckets = new Map();

  const cleanup = (now) => {
    if (buckets.size < 5000) return;
    for (const [key, value] of buckets.entries()) {
      if (value.resetAt <= now) buckets.delete(key);
    }
  };

  return (req, res, next) => {
    if (typeof skip === 'function' && skip(req)) return next();
    const now = Date.now();
    cleanup(now);
    const key = typeof keyGenerator === 'function' ? keyGenerator(req) : clientIpKey(req);
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - 1)));
      return next();
    }

    bucket.count += 1;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ success: false, error: 'Too many requests' });
    }
    next();
  };
}

export function clientIpKey(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}
