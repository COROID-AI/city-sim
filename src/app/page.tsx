import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold text-white">Coroid City Simulation</h1>
      <Link
        href="/time-city"
        className="rounded-lg bg-blue-600 px-6 py-3 text-lg font-semibold text-white transition hover:bg-blue-500"
      >
        Enter Time City →
      </Link>
    </main>
  );
}
