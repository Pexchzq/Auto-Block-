type Bucket = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

const buckets = new Map<string, Bucket>();

function clientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  const firstForwarded = forwardedFor.split(",")[0]?.trim();
  return firstForwarded
    || request.headers.get("x-real-ip")
    || "unknown";
}

function cleanup(now: number) {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function checkRateLimit(request: Request, options: RateLimitOptions): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const now = Date.now();
  cleanup(now);

  const bucketKey = `${options.key}:${clientIp(request)}`;
  const existing = buckets.get(bucketKey);
  const bucket = existing && existing.resetAt > now
    ? existing
    : { count: 0, resetAt: now + options.windowMs };

  bucket.count += 1;
  buckets.set(bucketKey, bucket);

  if (bucket.count <= options.limit) return { ok: true };
  return {
    ok: false,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

export function rateLimitResponse(retryAfterSeconds: number) {
  return {
    body: { error: `Too many requests. Retry after ${retryAfterSeconds} seconds.` },
    init: {
      status: 429,
      headers: { "retry-after": String(retryAfterSeconds) },
    },
  };
}
