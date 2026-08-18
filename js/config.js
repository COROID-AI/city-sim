/* CitySim config — global constants and tuning. Pure module (no DOM). */
(function (global) {
  'use strict';
  var CitySim = (global.CitySim = global.CitySim || {});

  CitySim.config = {
    seed: 20260818,

    // World geometry
    tileSize: 32,          // world pixels per tile at zoom 1
    cityTilesX: 96,
    cityTilesY: 96,
    roadSpacing: 8,        // road grid: a road every N tiles
    roadWidth: 1,          // road width in tiles

    // Simulation start: Day 1 07:00 — morning commute, city feels alive at load
    startDay: 1,
    startHour: 7,
    startMinute: 0,

    // Pacing: sim minutes advanced per real second at 1x.
    // 120 => one sim-hour per 30 real seconds, a full day in 12 real minutes.
    simMinutesPerRealSecond: 120,
    speedMultipliers: [0, 1, 2, 4], // 0 = paused

    // Entity counts
    citizens: 200,
    vehicles: 60,
    buildings: 64,
    unemployedRate: 0.12,

    // Movement speeds (tiles per sim-minute)
    speeds: {
      walk: 2.4,
      car: 7.0,
      bus: 5.5,
      truck: 5.0
    },

    // Economy
    taxRates: { income: 0.2, corporate: 0.2, sales: 0.08 },
    cityUpkeepPerHour: 120,

    // Picking / UX
    pickRadiusPx: 16,
    hoverPickMs: 80,
    minimapSize: 220,

    // Colors (used by renderer/minimap)
    colors: {
      grass: '#3f7d3a',
      park: '#4e9a45',
      water: '#2e6fa3',
      road: '#4a4a52',
      roadMarking: '#6a6a72',
      building: {
        residential: '#b07a4f',
        commercial: '#7a8fb0',
        entertainment: '#a05a8a',
        industrial: '#8a8a7a'
      }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);