/**
 * Shared fetch for ESPN's public site APIs.
 *
 * ESPN intermittently 403s datacenter egress IPs that send no (or a
 * non-browser) User-Agent, which used to take down scores, schedules, and
 * team dashboards wholesale. Every server-side ESPN request should go
 * through here so the header can't be forgotten on the next route.
 */
const ESPN_UA = 'Mozilla/5.0 (compatible; Fanspot/1.0; +https://github.com/rpr93-dev/Fanspot)'

export function espnFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (!headers.has('User-Agent')) headers.set('User-Agent', ESPN_UA)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  return fetch(input, { ...init, headers })
}
