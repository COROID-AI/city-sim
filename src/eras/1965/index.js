/**
 * index.js — 1965 mid-century espresso-bar café era module.
 *
 * Assembles the full 1965 interior:
 *   counter equipment (chrome espresso machine with glass dome + steam
 *   wands, round-key electric cash register, glass cake stand, chrome
 *   sugar dispensers), plastic letterboard menu with era prices, neon
 *   OPEN-style sign, chrome-and-glass jukebox with glowing arch trim and
 *   a visible record stack, mid-century splayed-leg tables + molded
 *   chairs + tableware, sputnik pendant, starburst clock, sunburst art,
 *   60s travel/coffee posters, string art, macramé, and a cast of five
 *   60s patrons (slim suits, shift dresses, beehives, leather jacket,
 *   teens at the jukebox).
 */
import * as THREE from '../../../public/js/three/lib/three.module.js';
import { canvasTexture } from './util.js';
import {
  travelPoster,
  instantAd,
  sunburst,
  starburstClock,
  stringArt,
  macrame,
  wallPlace,
  WALL_BACK,
  WALL_LEFT,
  WALL_RIGHT,
} from './wallArt.js';
import { espressoMachine, cashRegister, cakeStand, sugarDispenser } from './counter.js';
import { menuBoard, neonSign } from './menu.js';
import { windowTable, roundTable } from './tables.js';
import { jukebox } from './jukebox.js';
import { buildPeople } from './people.js';
import { sputnikLamp, cafeLamp } from './lights.js';

export const era1965 = {
  id: 'year-1965',
  label: '1965',
  year: 1965,
  hudText: 'Mid-Century Espresso Bar',
  assets: [],
  metadata: {
    tint: '#e05a2e',
    caption: { name: 'Mid-century Espresso Bar', vibe: 'Chrome, jukebox gold, and a nickel for the single' },
    inspectables: [
      { id: 'cash-register', name: 'Electric Cash Register', object: 'cash-register', story: 'Electric cash register — 1965: round keys and a printed receipt ring the sale' },
      { id: 'espresso', name: 'Chrome Espresso Machine', object: 'espresso-machine', story: 'Chrome espresso machine — 1965: steam wands and glass-domed shots' },
      { id: 'jukebox', name: 'Jukebox', object: 'jukebox', story: 'Jukebox — 1965: a nickel buys the single' },
      { id: 'menu', name: 'Letterboard Menu', object: 'menu-board', story: 'Letterboard menu — 1965: espresso at 25¢, a sandwich and a shake' },
      { id: 'neon', name: 'Neon OPEN Sign', object: 'neon-open', story: 'Neon sign — 1965: the café glows OPEN late into the night' },
    ],
    presets: [
      { id: 'counter', name: 'Counter & Machine', position: [-3.1, 1.4, 2.2], target: [-2.9, 1.1, 0.6] },
      { id: 'menu', name: 'Letterboard Menu', position: [-0.3, 1.6, 2.2], target: [-1.0, 1.3, -2.0] },
      { id: 'music', name: 'Jukebox', position: [2.6, 1.0, 2.2], target: [2.9, 0.9, 0.2] },
      { id: 'seating', name: 'Seating Area', position: [-0.4, 1.5, 2.2], target: [-0.2, 0.9, 0.2] },
      { id: 'posters', name: 'Posters & Clock', position: [1.2, 1.6, 2.2], target: [0.8, 1.2, -2.0] },
    ],
    overview: { position: [3.1, 1.9, 2.3], target: [0, 1.05, -0.3] },
  },
  build(ctx) {
    const group = new THREE.Group();
    group.name = 'era-1965';

    // Warm terracotta/mint area rug under the centre island.
    buildRug(group, -0.6, 0.006, -0.55, 0.85);

    // ------------------------------------------------------------------
    // Countertop equipment (counter worktop at y ≈ 0.90 / x -3.4..-2.5).
    // ------------------------------------------------------------------
    const machine = espressoMachine();
    machine.name = 'espresso-machine';
    machine.position.set(-2.86, 0.905, 0.7);
    machine.rotation.y = Math.PI / 2; // steam wands face the room (+x)
    group.add(machine);

    const register = cashRegister();
    register.name = 'cash-register';
    register.position.set(-2.84, 0.905, -0.45);
    register.rotation.y = Math.PI / 2;
    group.add(register);

    const stand = cakeStand();
    stand.name = 'cake-stand';
    stand.position.set(-3.0, 0.905, 1.45);
    group.add(stand);

    const sugar1 = sugarDispenser();
    sugar1.position.set(-3.3, 0.905, 0.25);
    group.add(sugar1);
    const sugar2 = sugarDispenser();
    sugar2.position.set(-3.32, 0.905, 0.0);
    group.add(sugar2);

    // ------------------------------------------------------------------
    // Jukebox — chrome-and-glass centerpiece against the right wall.
    // ------------------------------------------------------------------
    const juke = jukebox();
    juke.name = 'jukebox';
    juke.position.set(3.18, 0, 0.15);
    juke.rotation.y = -Math.PI / 2; // front faces -x into the room
    group.add(juke);

    // ------------------------------------------------------------------
    // Tables.
    // ------------------------------------------------------------------
    windowTable(group, 1.15, 1.25, 0.0); // by the front window
    windowTable(group, -0.6, -0.55, 0.12); // centre island
    roundTable(group, 2.35, -1.0); // near the jukebox

    // ------------------------------------------------------------------
    // Letterboard menu + neon OPEN sign.
    // ------------------------------------------------------------------
    menuBoard(group, 'back', -2.72, 1.6, -2.46).name = 'menu-board';
    neonSign(group, 'front', 0.25, 2.3, 2.47).name = 'neon-open';

    // ------------------------------------------------------------------
    // Wall décor.
    // ------------------------------------------------------------------
    travelPoster(group, WALL_RIGHT, 3.46, 1.78, -1.15);
    instantAd(group, WALL_BACK, 0.4, 1.5, -2.46);

    const sunGrp = new THREE.Group();
    sunGrp.name = 'sunburst-wall';
    sunburst(sunGrp, 0.34);
    wallPlace(sunGrp, WALL_LEFT, new THREE.Vector3(-3.46, 2.05, 0.5));
    group.add(sunGrp);

    const clockGrp = new THREE.Group();
    clockGrp.name = 'starburst-clock';
    starburstClock(clockGrp, 0.3);
    wallPlace(clockGrp, WALL_BACK, new THREE.Vector3(1.15, 2.05, -2.46));
    group.add(clockGrp);

    const macGrp = new THREE.Group();
    macGrp.name = 'macrame-hanging';
    macrame(macGrp, 0.34, 0.74);
    wallPlace(macGrp, WALL_RIGHT, new THREE.Vector3(3.46, 1.5, -2.1));
    group.add(macGrp);

    const stringGrp = new THREE.Group();
    stringGrp.name = 'string-art';
    stringArt(stringGrp, 0.27);
    wallPlace(stringGrp, WALL_LEFT, new THREE.Vector3(-3.46, 1.35, 2.1));
    group.add(stringGrp);

    // ------------------------------------------------------------------
    // Lighting.
    // ------------------------------------------------------------------
    sputnikLamp(group, 0.05, 1.18, -0.1);
    cafeLamp(group, 2.35, 0.72, -1.0); // table lamp on the round table near the jukebox

    // ------------------------------------------------------------------
    // Patrons.
    // ------------------------------------------------------------------
    group.add(buildPeople());

    return group;
  },
  enter(ctx) {},
  exit() {},
};

/**
 * Warm terracotta/mint area rug under the centre table (canvas texture).
 */
function buildRug(group, x, y, z, r) {
  const tex = canvasTexture(512, 512, (g) => {
    g.clearRect(0, 0, 512, 512);
    g.fillStyle = '#efe4c8';
    g.beginPath();
    g.arc(256, 256, 250, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#c96f4a';
    g.beginPath();
    g.arc(256, 256, 210, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#8bc9b1';
    g.beginPath();
    g.arc(256, 256, 162, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f7f1de';
    g.beginPath();
    g.arc(256, 256, 118, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 12; i++) {
      g.fillStyle = i % 2 ? '#c96f4a' : '#e9a94c';
      g.beginPath();
      const a0 = (i / 12) * Math.PI * 2;
      const a1 = ((i + 0.5) / 12) * Math.PI * 2;
      g.moveTo(256, 256);
      g.lineTo(256 + Math.cos(a0) * 116, 256 + Math.sin(a0) * 116);
      g.lineTo(256 + Math.cos(a1) * 116, 256 + Math.sin(a1) * 116);
      g.closePath();
      g.fill();
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  const rug = new THREE.Mesh(
    new THREE.PlaneGeometry(r * 2, r * 2),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 })
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(x, y, z);
  rug.receiveShadow = true;
  group.add(rug);
}