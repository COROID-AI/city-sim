import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  distDir: 'dist',
  images: {
    unoptimized: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  /**
   * Force a single canonical React/React-DOM/Scheduler instance in the CLIENT
   * bundle (including transitive deps such as @react-three/fiber's
   * react-reconciler). Without this, Next.js can emit two React copies in the
   * browser chunk and react-three-fiber throws:
   *   "Cannot read properties of undefined (reading 'ReactCurrentOwner')"
   * because its reconciler reads React.__SECRET_INTERNALS from a different
   * module instance than the application code.
   *
   * The alias is intentionally restricted to the client build: the server
   * (prerender) bundle must keep resolving Next's own React, which exposes the
   * Server Components `cache` API that client-only React 18.3 lacks.
   */
  webpack: (config, { isServer }) => {
    if (!isServer) {
      const alias = config.resolve.alias || (config.resolve.alias = {});
      alias.react = path.resolve(__dirname, 'node_modules/react');
      alias['react-dom'] = path.resolve(__dirname, 'node_modules/react-dom');
      alias.scheduler = path.resolve(__dirname, 'node_modules/scheduler');
    }
    return config;
  },
};

export default nextConfig;
