import type { NextConfig } from 'next'

/**
 * Fanspot is published under a sub-path of the consulting site
 * (https://khannaconsulting.ai/fanspot), so every route, asset, and public file
 * lives below BASE_PATH. Next prefixes <Link>, router, and static asset URLs
 * automatically; plain `fetch()` calls are NOT rewritten — those go through
 * `apiFetch`/`withBasePath` in `src/lib/api-base.ts`.
 */
const basePath = '/fanspot'

const nextConfig: NextConfig = {
  basePath,
  redirects: async () => [
    // The app serves nothing at the bare root (everything lives under
    // basePath), so send root hits to /fanspot instead of a 404.
    // basePath: false keeps this rule from being double-prefixed to /fanspot/fanspot.
    { source: '/', destination: basePath, permanent: false, basePath: false },
  ],
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  turbopack: {},
  allowedDevOrigins: ['100.112.124.101'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'a.espncdn.com' },
      { protocol: 'https', hostname: 'cdn.espn.com' },
    ],
  },
}

export default nextConfig
