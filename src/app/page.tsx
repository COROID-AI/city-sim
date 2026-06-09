import { CityCanvas } from '@/components/city/CityCanvas';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-surface text-foreground">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-xl font-semibold">City Sim</h1>
        <p className="text-sm text-muted">A small browser city simulator.</p>
      </header>
      <section className="p-6">
        <CityCanvas />
      </section>
    </main>
  );
}
