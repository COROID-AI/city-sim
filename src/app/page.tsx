export default function Home() {
  return (
    <main className="flex h-screen w-screen items-center justify-center bg-slate-900 text-white">
      <div className="text-center">
        <h1 className="text-4xl font-bold">City Sim</h1>
        <p className="mt-4 text-lg text-slate-300">
          <a href="/time-city" className="text-blue-400 underline">
            Enter Time City
          </a>
        </p>
      </div>
    </main>
  );
}
