import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Time City',
  description: 'A time-period city simulation',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
