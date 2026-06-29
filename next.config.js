/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  distDir: 'dist',
  images: { unoptimized: true },
  transpilePackages: ['@react-three/fiber', '@react-three/drei'],
};
module.exports = nextConfig;
