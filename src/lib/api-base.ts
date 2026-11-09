/**
 * Deployment base path (see `basePath` in next.config.ts).
 *
 * Next.js rewrites <Link>, router, and static-asset URLs for the base path, but
 * a plain `fetch('/api/...')` is a raw browser request and would hit the host
 * root instead. Every app-relative request therefore goes through `apiFetch`
 * (client) or `withBasePath` (server-side URL building).
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

/** Prefix an app-relative path with the deployment base path. */
export function withBasePath(path: string): string {
  if (!path.startsWith('/')) return path
  // Already prefixed — never double up.
  if (BASE_PATH && (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`))) return path
  return `${BASE_PATH}${path}`
}

/** `fetch` that resolves an app-relative URL under the deployment base path. */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(withBasePath(input), init)
}
