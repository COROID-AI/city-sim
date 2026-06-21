export default function Home() {
  return (
    <main
      id="city-sim-boot"
      className="flex min-h-screen flex-col items-center justify-center gap-4 p-8"
    >
      <h1 className="text-4xl font-bold text-slate-100">City Sim</h1>
      {/*
       * Smoke-test target canvas. The id="city-canvas" is stable so the
       * Playwright E2E test (src/__tests__/e2e/city-smoke.spec.ts) keeps
       * passing when the downstream page-implementation task replaces this.
       */}
      <canvas
        id="city-canvas"
        data-testid="city-canvas"
        width={1024}
        height={640}
        className="border border-slate-700 bg-slate-900"
        aria-label="City simulation canvas"
      />
      <p className="text-lg text-slate-400">
        Initializing simulation engine&hellip;
      </p>
    </main>
  );
}
