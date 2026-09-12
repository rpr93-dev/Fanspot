import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkRateLimit, rateLimitClientKey, resetRateLimits, RATE_LIMIT_ERR } from '@/lib/rate-limit'

function request(ip: string): Request {
  return new Request('http://localhost/api/prop-model', {
    method: 'POST',
    headers: { 'x-forwarded-for': `${ip}, 10.0.0.1` },
  })
}

const LIMITS = { limitPerMinute: 5, burst: 2 } // capacity 7

describe('per-IP token bucket', () => {
  beforeEach(() => resetRateLimits())

  it('allows up to capacity then returns a retryable 429', () => {
    const req = request('1.2.3.4')
    for (let i = 0; i < 7; i++) {
      expect(checkRateLimit(req, 'route-a', LIMITS)).toBe(null)
    }
    expect(checkRateLimit(req, 'route-a', LIMITS)?.status).toBe(429)
  })

  it('429 body has the RATE_LIMITED contract', async () => {
    const req = request('9.9.9.9')
    for (let i = 0; i < 7; i++) checkRateLimit(req, 'contract', LIMITS)
    const denied = checkRateLimit(req, 'contract', LIMITS)!
    expect(denied.status).toBe(429)
    expect(denied.headers.get('Retry-After')).toMatch(/^\d+$/)
    const body = await denied.json()
    expect(body.error).toBe(RATE_LIMIT_ERR)
    expect(body.retryable).toBe(true)
  })

  it('buckets are per IP and per route', () => {
    for (let i = 0; i < 7; i++) checkRateLimit(request('5.5.5.5'), 'route-a', LIMITS)
    expect(checkRateLimit(request('5.5.5.5'), 'route-a', LIMITS)).not.toBe(null)
    // Different IP on the same route is unaffected.
    expect(checkRateLimit(request('6.6.6.6'), 'route-a', LIMITS)).toBe(null)
    // Same IP on a different route is unaffected.
    expect(checkRateLimit(request('5.5.5.5'), 'route-b', LIMITS)).toBe(null)
  })

  it('refills at the sustained rate', () => {
    vi.useFakeTimers()
    try {
      const req = request('7.7.7.7')
      for (let i = 0; i < 7; i++) checkRateLimit(req, 'refill', LIMITS)
      expect(checkRateLimit(req, 'refill', LIMITS)).not.toBe(null)
      vi.advanceTimersByTime(12000) // 5/min -> 0.083 tokens/sec -> ~1 token in 12s
      expect(checkRateLimit(req, 'refill', LIMITS)).toBe(null)
    } finally {
      vi.useRealTimers()
    }
  })

  it('client key derives from the first x-forwarded-for hop', () => {
    expect(rateLimitClientKey(request('8.8.8.8'), 'r')).toBe('r:8.8.8.8')
  })

  it('generous default (30/min) does not trip normal polling bursts', () => {
    const req = request('4.4.4.4')
    for (let i = 0; i < 30; i++) {
      expect(checkRateLimit(req, 'defaults')).toBe(null)
    }
  })
})
