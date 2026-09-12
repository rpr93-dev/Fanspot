import { NextResponse } from 'next/server'

/**
 * In-memory per-IP token bucket for expensive POST routes (prop-model,
 * concierge, scraper). Generous on purpose: normal dashboard traffic and
 * live polling stay far under the limit; this only sheds abuse loops.
 * Per-process (same lifetime semantics as the route caches).
 */

export const RATE_LIMIT_ERR = 'RATE_LIMITED'

interface Bucket {
  tokens: number
  last: number
}

export interface RateLimitOptions {
  /** Sustained requests allowed per minute. */
  limitPerMinute?: number
  /** Instantaneous burst allowed above the sustained rate. */
  burst?: number
}

const DEFAULTS: Required<RateLimitOptions> = { limitPerMinute: 30, burst: 10 }

const buckets = new Map<string, Bucket>()
let lastSweep = 0

function sweep(now: number): void {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [key, b] of buckets) {
    // Anything empty for 5+ minutes is not worth remembering.
    if (b.tokens <= 0 && now - b.last > 5 * 60_000) buckets.delete(key)
  }
}

export function rateLimitClientKey(request: Request, route: string): string {
  const fwd = request.headers.get('x-forwarded-for')
  const ip = (fwd?.split(',')[0] ?? '').trim() || request.headers.get('x-real-ip') || 'local'
  return `${route}:${ip}`
}

/**
 * Consume one token. Returns null when the request is allowed, or a 429
 * response with Retry-After when the bucket is empty.
 */
export function checkRateLimit(
  request: Request,
  route: string,
  options: RateLimitOptions = {},
): NextResponse | null {
  const { limitPerMinute, burst } = { ...DEFAULTS, ...options }
  const capacity = limitPerMinute + burst
  const refillPerMs = limitPerMinute / 60_000
  const now = Date.now()
  sweep(now)

  const key = rateLimitClientKey(request, route)
  const bucket = buckets.get(key) ?? { tokens: capacity, last: now }
  bucket.tokens = Math.min(capacity, bucket.tokens + (now - bucket.last) * refillPerMs)
  bucket.last = now
  buckets.set(key, bucket)

  if (bucket.tokens < 1) {
    const waitSec = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000))
    return NextResponse.json(
      { error: RATE_LIMIT_ERR, message: 'Too many requests', retryable: true },
      { status: 429, headers: { 'Retry-After': String(waitSec) } },
    )
  }
  bucket.tokens -= 1
  return null
}

/** Test helper: wipe all buckets. */
export function resetRateLimits(): void {
  buckets.clear()
  lastSweep = 0
}
