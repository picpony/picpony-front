import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  allowedDevOrigins: [
    '127.0.0.1',
    '.trae.cn',
    'run-agent-6a2d3ff6b85ce4091d8a7232-mqca1293-preview.agent-sandbox-bj-a1-gw.trae.cn',
  ],
  async rewrites() {
    return [
      {
        source: '/api.php/:path*',
        destination: 'https://picpony.top/api.php/:path*',
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'derpicdn.net',
      },
      {
        protocol: 'https',
        hostname: 'picpony.top',
      },
      {
        protocol: 'https',
        hostname: 'wsrv.nl',
      },
    ],
    unoptimized: process.env.NODE_ENV === 'development',
  },
};

export default nextConfig;
