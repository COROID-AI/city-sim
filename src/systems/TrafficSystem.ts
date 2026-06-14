  coverageThreshold: {
    global: {
      lines: 80,
      functions: 80,
      statements: 80,
      branches: 70,
    },
    // Per-file floor for the two systems that already have dedicated
    // tests. The threshold allows a soft margin for the few helpers
    // that are not part of the public test surface (e.g. a
    // `pickPhaseFor(hour)` helper in TrafficSystem).
    './src/systems/EconomySystem.ts': { lines: 80, functions: 60, statements: 80 },
    './src/systems/TimeSystem.ts':      { lines: 80, functions: 80, statements: 80 },
    './src/systems/EventBus.ts':        { lines: 80, functions: 60, statements: 80 },
    './src/systems/NeedSystem.ts':      { lines: 80, functions: 80, statements: 80 },
  },
};