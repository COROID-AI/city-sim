/* Game tuning: weapons, quality tiers, world constants. */

export const PLANET_RADIUS = 10;
export const POPULATION_START = 7_900_000_000;

export const WEAPONS = [
  {
    id: 'missile',
    name: 'Missile',
    key: '1',
    cooldown: 0.9,
    power: 4,
    crater: { radiusDeg: 7, char: 0.85, lava: 0.55 },
    fxScale: 1,
    shake: 0.22,
    sfx: 'explosion-s',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M12 2 L15 8 L15 15 L9 15 L9 8 Z"/><path d="M9 15 L6 20 M15 15 L18 20"/><path d="M9 11 L6 13 M15 11 L18 13"/><circle cx="12" cy="19.5" r="1.3" fill="currentColor" stroke="none"/></svg>`
  },
  {
    id: 'laser',
    name: 'Laser',
    key: '2',
    cooldown: 0,           // heat-driven, see weapons.js
    power: 0,              // applied per tick
    crater: { radiusDeg: 2.6, char: 0.5, lava: 0.75 },
    fxScale: 0.45,
    shake: 0.05,
    sfx: 'laser',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M12 3 L8.5 9 H15.5 Z"/><path d="M3 12 H21"/><path d="M4.5 14.5 H14 M9.5 17 H19.5"/></svg>`
  },
  {
    id: 'asteroid',
    name: 'Asteroid',
    key: '3',
    cooldown: 5,
    power: 16,
    crater: { radiusDeg: 17, char: 0.95, lava: 0.6 },
    fxScale: 2.2,
    shake: 0.55,
    sfx: 'explosion-m',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M7 4 L15 3 L20 9 L18 17 L10 20 L4 14 Z"/><circle cx="10" cy="10" r="1.7"/><circle cx="14.5" cy="14" r="1.2"/></svg>`
  },
  {
    id: 'nuke',
    name: 'Nuke',
    key: '4',
    cooldown: 8,
    power: 26,
    crater: { radiusDeg: 23, char: 1.0, lava: 0.85 },
    fxScale: 3.4,
    shake: 0.95,
    sfx: 'nuke',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="8.4"/><g fill="currentColor" stroke="none"><path d="M12 12 L8.6 5.9 A7 7 0 0 1 15.4 5.9 Z"/><path d="M12 12 L8.6 5.9 A7 7 0 0 1 15.4 5.9 Z" transform="rotate(120 12 12)"/><path d="M12 12 L8.6 5.9 A7 7 0 0 1 15.4 5.9 Z" transform="rotate(240 12 12)"/><circle cx="12" cy="12" r="1.4"/></g></svg>`
  },
  {
    id: 'blackhole',
    name: 'Black Hole',
    key: '5',
    cooldown: 13,
    power: 34,             // total across its lifetime
    crater: { radiusDeg: 5, char: 0.7, lava: 0.95 },
    fxScale: 1.4,
    shake: 0.3,
    sfx: 'blackhole',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><ellipse cx="12" cy="12" rx="9" ry="3.4" transform="rotate(-18 12 12)" stroke-dasharray="3 2.2"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>`
  },
  {
    id: 'railgun',
    name: 'Railgun',
    key: '6',
    cooldown: 1.6,
    power: 6,
    crater: { radiusDeg: 4.5, char: 0.9, lava: 0.35 },
    fxScale: 0.8,
    shake: 0.3,
    sfx: 'railgun',
    icon: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13.5 2 L5.5 13.5 H10.5 L8.5 22 L18.5 9.5 H13 Z"/></svg>`
  }
];

/* Quality tiers — the adaptive graphics budget (finding: bloom + particle
 * counts tanking frame rate on weak GPUs). particleMul scales every emitter;
 * pool capacity itself stays fixed so tier switches never reallocate. */
export const QUALITY_TIERS = [
  {
    id: 'high', label: 'HIGH', bloom: true, bloomStrength: 0.85, bloomIters: 2,
    dpr: Math.min(window.devicePixelRatio || 1, 2), samples: 4,
    particleMul: 1, maxSparks: 6000, clouds: true, cloudOctaves: 5, stars: 1900
  },
  {
    id: 'medium', label: 'MEDIUM', bloom: true, bloomStrength: 0.65, bloomIters: 1,
    dpr: Math.min(window.devicePixelRatio || 1, 1.5), samples: 2,
    particleMul: 0.55, maxSparks: 3000, clouds: true, cloudOctaves: 4, stars: 1300
  },
  {
    id: 'low', label: 'LOW', bloom: false, bloomStrength: 0, bloomIters: 0,
    dpr: 1, samples: 0,
    particleMul: 0.28, maxSparks: 1200, clouds: false, cloudOctaves: 3, stars: 850
  }
];

export const TIER_INDEX = { high: 0, medium: 1, low: 2 };

export const STAGE_MESSAGES = [
  { at: 0.25, msg: 'SEISMIC ACTIVITY RISING' },
  { at: 0.50, msg: 'MANTLE INSTABILITY DETECTED' },
  { at: 0.75, msg: 'PLANETARY CORE EXPOSED' }
];

export const GO_FLAVOR = [
  '"It was, statistically, someone else\'s problem." — Orbital Command',
  'Terra Prime is survived by its moon.',
  'Real estate prices have never been lower.',
  'The core breach was visible from three systems away.',
  'A moment of silence, then another volley.'
];
