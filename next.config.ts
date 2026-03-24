import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'derpicdn.net',
      },
    ],
  },
};

export default nextConfig;
