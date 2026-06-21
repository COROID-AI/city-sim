import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  distDir: 'dist',
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
  // Pin the workspace root to this project so Next.js does not pick up
  // a parent directory's lockfile (which causes spurious pages-router
  // _document/_error scanning during static export).
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
