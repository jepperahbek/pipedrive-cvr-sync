import type { Request, Response, NextFunction, RequestHandler } from 'express';

export interface RateLimitOptions {
  /** Sliding window length in milliseconds. */
  windowMs: number;
  /** Max requests per client within the window. */
  max: number;
  /** Override client key extraction (default: req.ip). */
  key?: (req: Request) => string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Tiny in-memory sliding-window rate limiter. Fine for a single-tenant
 * serverless warm instance; not a substitute for edge/WAF limits at scale.
 */
export function createRateLimiter(opts: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();
  const keyFn = opts.key ?? ((req) => req.ip || req.socket.remoteAddress || 'unknown');

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyFn(req);
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    res.setHeader('X-RateLimit-Limit', String(opts.max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, opts.max - bucket.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > opts.max) {
      res.status(429).json({
        error: 'rate_limited',
        message: 'For mange forespørgsler. Prøv igen om lidt.',
      });
      return;
    }

    next();
  };
}
