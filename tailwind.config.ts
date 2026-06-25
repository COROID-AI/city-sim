import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/ui/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'city-bg': '#0a0e14',
        'city-panel': '#111827',
        'city-accent': '#3b82f6',
      },
    },
  },
  plugins: [],
};

export default config;
