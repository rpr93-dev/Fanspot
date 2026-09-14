import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
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
