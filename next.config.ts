import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The Docker runner stage ships only `.next/standalone` (server.js plus the
  // traced subset of node_modules), not a full `yarn install`.
  output: 'standalone',
};

export default nextConfig;
