import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: {
    optimizePackageImports: ['react-icons/md'],
  },
  allowedDevOrigins: [
    '127.0.0.1',
    '.trae.cn',
    'run-agent-6a2d3ff6b85ce4091d8a7232-mqca1293-preview.agent-sandbox-bj-a1-gw.trae.cn',
    '171.100.154.38',
    'dev.muyni.dpdns.org',
    '192.168.31.153',
    '192.168.31.12'
  ],
  // /api.php is proxied by app/api.php/[[...path]]/route.ts rather than a
  // rewrite: the backend's session cookie is marked Secure, and only a route
  // handler can rewrite that header when the page is served over plain HTTP.
  async redirects() {
    return [
      {
        source: '/forum',
        destination: '/?tab=forum',
        permanent: false,
      },
    ];
  },
  // 以图搜图 API 走服务端代理，避免 dev.picpony.top → picpony.top 的跨域 CORS。
  // search-api 无状态、不涉及 cookie，rewrites 足矣（区别于 /api.php 的 route handler）。
  async rewrites() {
    return [
      {
        source: '/search-api/:path*',
        destination: 'https://picpony.top/search-api/:path*',
      },
    ];
  },
  images: {
    qualities: [75, 82, 88],
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
      {
        protocol: 'https',
        hostname: '147052.xyz',
      },
    ],
    unoptimized: process.env.NODE_ENV === 'development',
  },
};

export default nextConfig;
