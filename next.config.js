import path from 'node:path';

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
  webpack: (config, { isServer }) => {
    // Force a single React instance across the client bundle.
    // Without this, @react-three/fiber's internal react-reconciler can
    // resolve a different copy of `react` than the app, producing the
    // runtime error: "Cannot read properties of undefined (reading 'ReactCurrentOwner')".
    // Only alias on the client — the server bundle has its own React resolution.
    if (!isServer) {
      const root = process.cwd();
      config.resolve = config.resolve || {};
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        react: path.join(root, 'node_modules', 'react'),
        'react-dom': path.join(root, 'node_modules', 'react-dom'),
        'react-reconciler': path.join(root, 'node_modules', 'react-reconciler'),
        scheduler: path.join(root, 'node_modules', 'scheduler'),
      };
    }
    return config;
  },
};

export default nextConfig;
