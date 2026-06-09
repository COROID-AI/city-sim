import type { ReactElement } from 'react';
import { CityView } from '@/components/city/CityView';

/**
 * City sim landing page.
 *
 * Renders the full 3-column CityView (canvas + dashboard + log +
 * mini-map). The view is marked `'use client'` so it can own the
 * simulation loop; this file stays a server component for static
 * export compatibility.
 */
export default function HomePage(): ReactElement {
  return (
    <main className="min-h-screen w-full bg-ground p-4 text-foreground">
      <CityView />
    </main>
  );
}
