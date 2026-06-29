'use client';

import dynamic from 'next/dynamic';

const PageContent = dynamic(() => import('./PageContent'), { ssr: false });

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <PageContent />
    </main>
  );
}
