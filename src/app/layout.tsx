import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'City Sim',
  description: 'A browser-based city simulation built with Next.js and Canvas.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
