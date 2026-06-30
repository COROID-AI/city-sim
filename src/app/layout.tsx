import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Coroid City Simulation',
  description: 'A time-period city simulation built with React Three Fiber',
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
