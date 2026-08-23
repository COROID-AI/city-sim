/**
 * wallArt.js — 2025 contemporary café wall décor:
 *   local-roaster posters, art prints, a community notice shelf, a chalk
 *   A-board outside the door, a subtle brand wall decal, and a living-wall
 *   shelving unit with ceramics.
 *
 * Each piece is built in LOCAL space (centered on origin, front face +z),
 * then mounted with wallPlace(group, wall, anchor). No external assets.
 */
import * as THREE from '../../../public/js/three/build/three.module.js';
import { C, mat, matte, box, cyl, sph } from './util.js';

export const WALL_FRONT = 'front'; // z = +2.5, faces -z
export const WALL_BACK = 'back'; // z = -2.5, faces +z
export const WALL_LEFT = 'left'; // x = -3.5, faces +x
export const WALL_RIGHT = 'right'; // x = +3.5, faces -x

/** Orient a local "front faces +z" group so it faces INTO the room. */
export function wallPlace(group, wall, anchor) {
  if (wall === WALL_FRONT) group.rotation.y = Math.PI;
  else if (wall === WALL_BACK) group.rotation.y = 0;
  else if (wall === WALL_LEFT) group.rotation.y = Math.PI / 2;
  else if (wall === WALL_RIGHT) group.rotation.y = -Math.PI / 2;
  group.position.copy(anchor);
  return group;
}

/** Build a CanvasTexture from a drawing callback. */
export function artworkTexture(W, H, draw) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (draw) draw(g, W, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 6;
  return tex;
}

/** Framed poster internals: art plane + thin matte frame. */
function framedPoster(group, w, h, draw, opts = {}) {
  const W = Math.max(128, Math.round(512 * Math.max(w / h, 1)));
  const H = Math.max(128, Math.round(512 * Math.max(h / w, 1)));
  const tex = artworkTexture(W, H, draw);
  const art = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.72 })
  );
  art.scale.set(w, h, 1);
  group.add(art);
  const frMat = opts.frameMat ?? matte(C.matteBlack, { roughness: 0.4 });
  const t = 0.04;
  const bars = [
    [w + 2 * t, t, 0, h / 2 + t / 2],
    [w + 2 * t, t, 0, -h / 2 - t / 2],
    [t, h + 2 * t, -w / 2 - t / 2, 0],
    [t, h + 2 * t, w / 2 + t / 2, 0],
  ];
  for (const [bw, bh, bx, by] of bars) {
    box(group, bw, bh, t, frMat, bx, by, 0);
  }
}

/** Local-roaster poster — minimal, kraft-paper style with coffee tones. */
export function roasterPoster(parent, wall, x = 0, y = 0, z = 0, opts = {}) {
  const w = 0.55;
  const h = 0.72;
  const pg = new THREE.Group();
  framedPoster(pg, w, h, (g, W, H) => {
    g.fillStyle = '#f0e9db';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#c97a5a';
    g.beginPath();
    g.arc(W * 0.5, H * 0.38, W * 0.2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2a1a12';
    g.font = 'bold 40px Helvetica, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('LOCAL', W / 2, H * 0.72);
    g.fillText('ROASTER', W / 2, H * 0.85);
    g.font = '18px Helvetica, Arial, sans-serif';
    g.fillText('SINGLE ORIGIN', W / 2, H * 0.14);
  });
  wallPlace(pg, wall, new THREE.Vector3(x, y, z));
  parent.add(pg);
  return pg;
}

/** Minimal art print — abstract Japandi shapes. */
export function artPrint(parent, wall, x = 0, y = 0, z = 0, opts = {}) {
  const w = 0.5;
  const h = 0.6;
  const pg = new THREE.Group();
  framedPoster(pg, w, h, (g, W, H) => {
    g.fillStyle = '#faf8f1';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#a8b59a';
    g.beginPath();
    g.arc(W * 0.3, H * 0.35, W * 0.16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#c97a5a';
    g.fillRect(W * 0.55, H * 0.2, W * 0.24, H * 0.4);
    g.fillStyle = '#1c1c1e';
    g.fillRect(W * 0.6, H * 0.72, W * 0.18, H * 0.1);
  });
  wallPlace(pg, wall, new THREE.Vector3(x, y, z));
  parent.add(pg);
  return pg;
}

/**
 * Community notice shelf — a floating oak shelf with a cork notice board,
 * flyers, and a couple of small ceramics.
 */
export function noticeShelf(parent, wall, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  // Shelf.
  box(g, 0.9, 0.03, 0.24, mat(C.oakLight, { roughness: 0.5 }), 0, 0, 0);
  // Cork board on the wall above the shelf.
  const corkTex = artworkTexture(512, 256, (cg) => {
    cg.fillStyle = '#c9a06a';
    cg.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 900; i++) {
      cg.fillStyle = `rgba(120,85,50,${(0.1 + Math.random() * 0.2).toFixed(3)})`;
      cg.fillRect(Math.random() * 512, Math.random() * 256, 2, 2);
    }
  });
  const cork = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 0.4),
    new THREE.MeshStandardMaterial({ map: corkTex, roughness: 0.95 })
  );
  cork.position.set(0, 0.22, 0.0);
  g.add(cork);
  // A few pinned flyers.
  const flyerMat = (color) => mat(color, { roughness: 0.9 });
  const flyers = [
    [-0.2, 0.24, 0.012, 0xc97a5a],
    [0.0, 0.2, 0.012, 0xa8b59a],
    [0.18, 0.26, 0.012, 0xd9b878],
  ];
  for (const [fx, fy, fz, fc] of flyers) {
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.18), flyerMat(fc));
    fl.position.set(fx, fy, fz);
    g.add(fl);
  }
  // Small ceramics on the shelf.
  cyl(g, 0.03, 0.022, 0.05, mat(C.stoneware, { roughness: 0.5 }), -0.18, 0.045, 0.05);
  cyl(g, 0.025, 0.02, 0.04, mat(C.stonewareDark, { roughness: 0.5 }), 0.16, 0.04, -0.03);
  // Books.
  box(g, 0.05, 0.12, 0.16, mat(C.sage, { roughness: 0.7 }), 0.2, 0.07, 0.04, 0, 0, 0.2);
  box(g, 0.04, 0.1, 0.15, mat(C.terracotta, { roughness: 0.7 }), 0.26, 0.06, 0.0, 0, 0, -0.15);

  wallPlace(g, wall, new THREE.Vector3(x, y, z));
  parent.add(g);
  return g;
}

/** Chalk A-board standing outside the door (on the floor). */
export function chalkBoard(parent, x, y, z, yaw = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;

  // A-frame legs (two angled boards).
  const legMat = mat(0x4a3a2c, { roughness: 0.7 });
  const leg = (rx) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.7, 0.5), legMat);
    m.rotation.x = rx;
    m.position.y = 0.35;
    g.add(m);
  };
  leg(0.18);
  leg(-0.18);
  // Chalk panel.
  const chalkTex = artworkTexture(256, 320, (cg) => {
    cg.fillStyle = '#2a3a2c';
    cg.fillRect(0, 0, 256, 320);
    cg.strokeStyle = '#e8e8e0';
    cg.lineWidth = 6;
    cg.strokeRect(16, 16, 224, 288);
    cg.fillStyle = '#e8e8e0';
    cg.font = 'bold 34px "Comic Sans MS", Arial, sans-serif';
    cg.textAlign = 'center';
    cg.textBaseline = 'top';
    cg.fillText('TODAY', 128, 60);
    cg.fillText('SPECIALS', 128, 100);
    cg.font = '26px Arial, sans-serif';
    cg.fillText('· OAT FLAT WHITE ·', 128, 160);
    cg.fillText('· MATCHA BOMB ·', 128, 200);
    cg.fillText('· CRUFFIN ·', 128, 240);
  });
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.56),
    new THREE.MeshStandardMaterial({ map: chalkTex, roughness: 0.8 })
  );
  panel.position.set(0, 0.42, 0);
  g.add(panel);

  parent.add(g);
  return g;
}

/** Subtle brand wall decal — a small matte black wordmark on the back wall. */
export function brandDecal(parent, wall, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  const tex = artworkTexture(512, 128, (cg) => {
    cg.clearRect(0, 0, 512, 128);
    cg.fillStyle = '#1c1c1e';
    cg.font = 'bold 72px Helvetica, Arial, sans-serif';
    cg.textAlign = 'center';
    cg.textBaseline = 'middle';
    cg.fillText('oak & oat', 256, 64);
  });
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.22),
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6 })
  );
  decal.position.set(0, 0, 0.005);
  g.add(decal);
  wallPlace(g, wall, new THREE.Vector3(x, y, z));
  parent.add(g);
  return g;
}

/** Small potted plant for shelves / tables. */
export function pottedPlant(parent, x, y, z, scale = 1) {
  const g = new THREE.Group();
  cyl(g, 0.05, 0.035, 0.09, mat(C.terracotta, { roughness: 0.6 }), 0, 0.045, 0, 0, 0, 0, 12);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    cyl(g, 0.008, 0.008, 0.16, mat(C.leaf, { roughness: 0.8 }), Math.cos(a) * 0.02, 0.13, Math.sin(a) * 0.02, 0.5, 0, a, 6);
    sph(g, 0.02, mat(C.leafLight, { roughness: 0.8 }), Math.cos(a) * 0.06, 0.2, Math.sin(a) * 0.06, 0.3, 0, a, 8);
  }
  g.position.set(x, y, z);
  g.scale.setScalar(scale);
  parent.add(g);
  return g;
}

/**
 * Living-wall shelving unit — a tall oak ladder-style shelving unit with
 * monstera, plants, and ceramics.
 */
export function shelvingUnit(parent, x, y, z, yaw = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;

  const oakMat = mat(C.oakLight, { roughness: 0.5 });
  const blackMat = matte(C.matteBlack, { roughness: 0.4 });
  // Uprights.
  box(g, 0.05, 1.9, 0.05, oakMat, -0.3, 0.95, 0);
  box(g, 0.05, 1.9, 0.05, oakMat, 0.3, 0.95, 0);
  // Shelves.
  for (const sy of [0.3, 0.75, 1.2, 1.6]) {
    box(g, 0.65, 0.03, 0.28, oakMat, 0, sy, 0);
    // Matte black shelf brackets.
    box(g, 0.03, 0.06, 0.2, blackMat, -0.26, sy - 0.03, 0);
    box(g, 0.03, 0.06, 0.2, blackMat, 0.26, sy - 0.03, 0);
  }

  // Monstera on the top shelf.
  monstera(g, -0.1, 1.66, 0, 0.8);
  // Pothos hanging off a shelf.
  pothos(g, 0.2, 0.76, 0, 0.9);
  // Ceramics on shelves.
  cyl(g, 0.04, 0.03, 0.06, mat(C.stoneware, { roughness: 0.5 }), -0.12, 0.34, 0.02);
  cyl(g, 0.035, 0.025, 0.05, mat(C.stonewareDark, { roughness: 0.5 }), 0.12, 0.33, -0.02);
  cyl(g, 0.045, 0.035, 0.07, mat(C.cream, { roughness: 0.55 }), 0.05, 0.79, 0.02);
  // Small plant on a lower shelf.
  pottedPlant(g, 0.0, 1.24, 0, 0.7);

  parent.add(g);
  return g;
}

/** Monstera plant — big leaves on stems. */
export function monstera(parent, x, y, z, scale = 1) {
  const g = new THREE.Group();
  cyl(g, 0.04, 0.045, 0.28, mat(C.terracotta, { roughness: 0.6 }), 0, 0.14, 0, 0, 0, 0, 12);
  const leafMat = mat(C.leaf, { roughness: 0.75 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const len = 0.3;
    cyl(g, 0.01, 0.01, len, mat(C.leafDark, { roughness: 0.8 }), Math.cos(a) * 0.02, 0.3, Math.sin(a) * 0.02, 0.5, 0, a, 6);
    // Leaf (flattened sphere / disc).
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), leafMat);
    leaf.position.set(Math.cos(a) * 0.26, 0.46, Math.sin(a) * 0.26);
    leaf.rotation.set(0.3, a, 0.2);
    leaf.scale.set(1, 0.15, 1);
    g.add(leaf);
  }
  g.position.set(x, y, z);
  g.scale.setScalar(scale);
  parent.add(g);
  return g;
}

/** Hanging pothos — trailing vines from a small pot. */
export function pothos(parent, x, y, z, scale = 1) {
  const g = new THREE.Group();
  cyl(g, 0.03, 0.025, 0.06, mat(C.terracotta, { roughness: 0.6 }), 0, 0.03, 0, 0, 0, 0, 12);
  const vineMat = mat(C.leafLight, { roughness: 0.8 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const len = 0.28 + (i % 2) * 0.08;
    cyl(g, 0.008, 0.008, len, vineMat, Math.cos(a) * 0.02, 0.06 - len / 2, Math.sin(a) * 0.02, 0.2, 0, a, 6);
    sph(g, 0.02, vineMat, Math.cos(a) * 0.03, 0.06 - len + 0.01, Math.sin(a) * 0.03, 0.2, 0, a, 8);
  }
  g.position.set(x, y, z);
  g.scale.setScalar(scale);
  parent.add(g);
  return g;
}