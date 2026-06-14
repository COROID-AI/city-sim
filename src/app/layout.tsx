import type { ReactNode } from 'react';

export const metadata = {
  title: 'Dark Factory City',
  description: 'A dark-factory city simulation',
};

export default function RootLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
