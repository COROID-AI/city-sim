import TimeCityCanvas from './TimeCityCanvas';

export default function SceneShell() {
  return (
    <div className="flex h-screen w-screen flex-col bg-slate-950">
      <header
        data-testid="scene-header"
        className="flex items-center justify-between border-b border-slate-700 bg-slate-900 px-6 py-4"
      >
        <h1 className="text-2xl font-bold text-white">Time City</h1>
        <span className="text-sm text-slate-400">3D City Simulation</span>
      </header>
      <main className="relative flex-1 overflow-hidden">
        <TimeCityCanvas />
      </main>
    </div>
  );
}
