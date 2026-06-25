/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  distDir: 'dist',
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
  eslint: {
    // ESLint runs via `npm run lint`; skip during build to avoid
    // flat-config/legacy-config option conflicts in the build worker.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
