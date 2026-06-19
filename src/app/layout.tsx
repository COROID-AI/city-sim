import type { Metadata } from 'next';
import '../globals.css';

export const metadata: Metadata = {
  title: 'Coroid City',
  description: 'Browser-based city simulation',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
