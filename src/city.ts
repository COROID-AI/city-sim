import type { BuildingDatum, CityLayout, LampDatum, RoadRect, TreeDatum } from './types';

/** deterministic PRNG so layouts are stable across reloads */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FACADES = ['#c9bda6', '#b8ac96', '#a99e88', '#d8ccb6', '#c4b7a0', '#e3d9c3', '#b3a894'];
const ACCENTS = ['#8a6a4a', '#6e5a48', '#9a7c54', '#7a5c44', '#a89068', '#5f4e3a'];

function colorFromYear(year: number, darken = 0): string {
  const i = Math.floor((year - 1850) / 32) % FACADES.length;
  const hex = FACADES[Math.max(0, Math.min(FACADES.length - 1, i))];
  return shade(hex, darken);
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function generateCity(): CityLayout {
  const buildings: BuildingDatum[] = [];
  const roads: RoadRect[] = [];
  const sidewalks: RoadRect[] = [];
  const lamps: LampDatum[] = [];
  const trees: TreeDatum[] = [];

  const stWidth = 4.4;
  const extent = 112;
  const streetXs = [-48, 0, 48];
  const streetZs = [-48, 0, 48];
  for (const x of streetXs) roads.push({ cx: x, cz: 0, w: stWidth, d: extent + stWidth });
  for (const z of streetZs) roads.push({ cx: 0, cz: z, w: extent + stWidth, d: stWidth });
  // sidewalks: 1.4 wide box strips just outside road rects
  for (const x of streetXs) {
    for (const side of [-1, 1]) {
      sidewalks.push({ cx: x + side * (stWidth / 2 + 0.7), cz: 0, w: 1.4, d: extent + stWidth + 2.8 });
    }
  }
  for (const z of streetZs) {
    for (const side of [-1, 1]) {
      sidewalks.push({ cx: 0, cz: z + side * (stWidth / 2 + 0.7), w: extent + stWidth + 2.8, d: 1.4 });
    }
  }

  const quadrants = [
    { dx: -24, dz: -24, seed: 101 },
    { dx: 24, dz: -24, seed: 202 },
    { dx: -24, dz: 24, seed: 303 },
    { dx: 24, dz: 24, seed: 404 },
  ];

  let id = 1;
  const blockSide = 21.5;
  const pad = 1.5;

  for (const q of quadrants) {
    const r = mulberry32(q.seed);
    for (let bx = 0; bx < 2; bx++) {
      for (let bz = 0; bz < 2; bz++) {
        const cx = q.dx + (bx === 0 ? -10.7 : 10.7);
        const cz = q.dz + (bz === 0 ? -10.7 : 10.7);
        if (Math.abs(cx) < 9 && Math.abs(cz) < 9) continue; // central park
        const type = r() < 0.42 ? 'low' : r() < 0.74 ? 'mid' : 'tower';
        const n = type === 'low' ? 4 : type === 'mid' ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const w = 4.8 + r() * 3.4;
          const d = 4.8 + r() * 3.4;
          const ox = r() * (blockSide - w - pad * 2) - blockSide / 2 + pad;
          const oz = r() * (blockSide - d - pad * 2) - blockSide / 2 + pad;
          const builtYear = Math.floor(1850 + r() * 185);
          const modern = Math.min(1, Math.max(0, (builtYear - 1850) / 185));
          const h = type === 'tower' ? 16 + r() * 28 : type === 'mid' ? 8 + r() * 10 : 4 + r() * 5;
          buildings.push({
            id,
            cx: cx + ox,
            cz: cz + oz,
            w,
            d,
            h,
            modern,
            built: builtYear,
            color: colorFromYear(builtYear),
            accent: ACCENTS[Math.floor(r() * ACCENTS.length)],
            neon: modern > 0.75 ? (r() < 0.4 ? ['#ff4aa8', '#4affff', '#b48aff'][Math.floor(r() * 3)] : '') : '',
          });
          id++;
        }
      }
    }
  }

  // landmark high-rises around the central park
  const landmarks: BuildingDatum[] = [
    { id: 1001, cx: -32, cz: -32, w: 13, d: 13, h: 32, modern: 0.2, built: 1912, color: '#a98060', accent: '#6e5a48', landmark: true, label: 'Clock Tower' },
    { id: 1002, cx: 32, cz: 32, w: 11, d: 11, h: 26, modern: 0.85, built: 1998, color: '#7f9eb2', accent: '#5e7c90', landmark: true, label: 'Exchange' },
    { id: 1003, cx: -32, cz: 32, w: 9, d: 15, h: 15, modern: 0.3, built: 1890, color: '#a8844c', accent: '#8a6a3a', landmark: true, label: 'Station House' },
  ];
  buildings.unshift(...landmarks);

  // central park
  const park = { cx: 0, cz: 0, w: 34, d: 34 };
  // trees
  const tr = mulberry32(909);
  for (let i = 0; i < 24; i++) {
    const ang = tr() * Math.PI * 2;
    const rad = 2 + tr() * (park.w / 2 - 2);
    trees.push({ x: Math.cos(ang) * rad, z: Math.sin(ang) * rad, s: 0.8 + tr() * 0.9 });
  }

  // street lamps along the avenues
  const lr = mulberry32(515);
  for (let i = 0; i < 14; i++) {
    const along = -40 + i * (80 / 13);
    if (i % 2 === 0) lamps.push({ x: along, z: 0.1 });
    else lamps.push({ x: 0.1, z: along });
  }

  return { buildings, roads, sidewalks, park, lamps, trees };
}