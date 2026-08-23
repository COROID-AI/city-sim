/**
 * wallArt.js — 1965 wall décor:
 *   bold 60s travel/coffee posters, hand-painted instant-coffee ad,
 *   stripe sunburst wall art, starburst clock, string art, macramé hanging.
 *
 * Each piece is built in LOCAL space (centered on origin, front face +z),
 * then mounted with wallPlace(group, wall, anchor) or the poster wrappers.
 * No external assets — every texture is drawn onto canvas at build time.
 */
import * as THREE from '../../../public/js/three/build/three.module.js';
import { C, mat, box, sph, torus } from './util.js';

export const WALL_FRONT = 'front'; // z = +2.5, faces -z
export const WALL_BACK = 'back'; // z = -2.5, faces +z
export const WALL_LEFT = 'left'; // x = -3.5, faces +x
export const WALL_RIGHT = 'right'; // x = +3.5, faces -x

/**
 * Orient a local "front faces +z" group/mesh so it faces INTO the room from
 * the given wall, then move it to the (world) anchor.
 */
export function wallPlace(group, wall, anchor) {
  if (wall === WALL_FRONT) group.rotation.y = Math.PI;
  else if (wall === WALL_BACK) group.rotation.y = 0;
  else if (wall === WALL_LEFT) group.rotation.y = Math.PI / 2;
  else if (wall === WALL_RIGHT) group.rotation.y = -Math.PI / 2;
  group.position.copy(anchor);
  return group;
}

/** Place a pre-built local group onto a wall. */
export function placeOnWall(group, wall, x, y, z) {
  return wallPlace(group, wall, new THREE.Vector3(x, y, z));
}

/** Build a CanvasTexture from a drawing callback (same ergonomics as util). */
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

/**
 * Framed poster internals: art plane + walnut frame added to `group` in
 * local space (front face +z).
 */
export function framedPoster(group, w, h, draw, opts = {}) {
  const W = Math.max(128, Math.round(512 * Math.max(w / h, 1)));
  const H = Math.max(128, Math.round(512 * Math.max(h / w, 1)));
  const tex = artworkTexture(W, H, draw);
  const art = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.72 })
  );
  art.scale.set(w, h, 1);
  group.add(art);

  const frMat = opts.frameMat ?? mat(C.walnutDark, { roughness: 0.6 });
  const t = 0.05;
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

/** 60s travel poster: half sun over sea, jet trail. */
export function travelPoster(parent, wall, x = 0, y = 0, z = 0, opts = {}) {
  const w = 0.62;
  const h = 0.86;
  const pg = new THREE.Group();
  framedPoster(pg, w, h, (g, W, H) => {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#e2542c');
    sky.addColorStop(0.55, '#f2a03c');
    sky.addColorStop(1, '#f7c65e');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // half sun
    g.fillStyle = '#fff2c9';
    g.beginPath();
    g.arc(W * 0.72, H * 0.34, W * 0.16, Math.PI * 1.05, Math.PI * 1.95);
    g.fill();
    // sea bands
    for (let i = 0; i < 10; i++) {
      const sy = H * (0.55 + i * 0.04);
      g.fillStyle = i % 2 === 0 ? '#145870' : '#1d86a6';
      g.fillRect(0, sy, W, H * 0.04 + 2);
    }
    g.fillStyle = '#0e3b52';
    g.fillRect(0, H * 0.9, W, H * 0.1);
    // jet trail
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = Math.max(6, H * 0.014);
    g.beginPath();
    g.moveTo(W * 0.05, H * 0.8);
    g.quadraticCurveTo(W * 0.45, H * 0.26, W * 0.93, H * 0.36);
    g.stroke();
    g.fillStyle = '#fdf6e3';
    g.font = `italic bold ${Math.round(H * 0.075)}px Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillText('JET AGE', W / 2, H * 0.045);
    g.font = `bold ${Math.round(H * 0.042)}px Arial, sans-serif`;
    g.fillStyle = '#2b1c10';
    g.fillText('FILTER COFFEE · ESPRESSO', W / 2, H * 0.16);
    g.fillStyle = '#fdf6e3';
    g.font = `bold ${Math.round(H * 0.05)}px Arial, sans-serif`;
    g.fillText('TAKE OFF TO THE CASBAH CAFÉ', W / 2, H * 0.78);
  }, opts);
  wallPlace(pg, wall, new THREE.Vector3(x, y, z));
  parent.add(pg);
  return pg;
}

/** Hand-painted "Instant Coffee" wall ad. */
export function instantAd(parent, wall = WALL_BACK, x = 0, y = 0, z = 0, opts = {}) {
  const w = 0.52;
  const h = 0.72;
  const pg = new THREE.Group();
  framedPoster(pg, w, h, (g, W, H) => {
    g.fillStyle = '#f7efdc';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#c23b2e';
    g.lineWidth = Math.max(4, W * 0.02);
    g.strokeRect(W * 0.03, H * 0.03, W * 0.94, H * 0.94);
    g.fillStyle = '#c23b2e';
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.moveTo(W * 0.06 + i * 18, H * 0.42 + i * 12);
      g.lineTo(W * 0.94 + i * 18, H * 0.42 + i * 12);
      g.lineTo(W * 0.94 + i * 18 - W * 0.22, H * 0.42 + (i + 1) * 12);
      g.lineTo(W * 0.06 + i * 18 - W * 0.22, H * 0.42 + (i + 1) * 12);
      g.closePath();
      g.fill();
    }
    // cup + steam
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(W / 2, H * 0.13, W * 0.11, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#1c1f24';
    g.lineWidth = 7;
    g.stroke();
    g.strokeStyle = 'rgba(60,60,60,0.6)';
    g.lineWidth = 4;
    const steam = [0.2, 0.5, 0.8];
    for (const s of steam) {
      g.beginPath();
      g.arc(W / 2 + (s - 0.5) * W * 0.16, H * 0.03, W * 0.03, Math.PI, 0);
      g.stroke();
    }
    g.fillStyle = '#1c1f24';
    g.font = `bold ${Math.round(H * 0.08)}px Arial, sans-serif`;
    g.textAlign = 'center';
    g.fillText('COFFEE', W / 2, H * 0.4);
    g.fillStyle = '#c23b2e';
    g.font = `bold ${Math.round(H * 0.055)}px Arial, sans-serif`;
    g.fillText('INSTANT', W / 2, H * 0.49);
    g.fillStyle = '#1c1f24';
    g.font = `bold ${Math.round(H * 0.06)}px 'Trebuchet MS', Arial, sans-serif`;
    g.fillText('“Just Add Water!”', W / 2, H * 0.82);
    g.font = `${Math.round(H * 0.032)}px Arial, sans-serif`;
    g.fillStyle = '#7a5330';
    g.fillText('— no pot, no percolator —', W / 2, H * 0.9);
  }, opts);
  wallPlace(pg, wall, new THREE.Vector3(x, y, z));
  parent.add(pg);
  return pg;
}

/** Stripe sunburst wall art (terracotta + gold wedges, chrome hub+rim). */
export function sunburst(group, radius = 0.34) {
  const N = 12;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2;
    const a1 = ((i + 0.5) / N) * Math.PI * 2;
    const a2 = ((i + 1) / N) * Math.PI * 2;
    const color = i % 2 === 0 ? C.terracotta : C.gold;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(Math.cos(a0) * radius, Math.sin(a0) * radius);
    shape.lineTo(Math.cos(a1) * radius, Math.sin(a1) * radius);
    shape.lineTo(Math.cos(a2) * radius, Math.sin(a2) * radius);
    shape.closePath();
    const m = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      mat(color, { side: THREE.DoubleSide, roughness: 0.6 })
    );
    m.position.z = 0.002;
    group.add(m);
  }
  const hub = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.16, 20),
    mat(C.chrome, { metalness: 0.9, roughness: 0.25 })
  );
  hub.position.z = 0.006;
  group.add(hub);
  // Chrome rim — default torus lies in the XY plane (ring around +z).
  torus(group, radius, 0.013, mat(C.chrome, { metalness: 0.9, roughness: 0.25 }), 0, 0, 0.004, 0, 0, 0, 28, 8);
}

/** Starburst clock with rays, canvas dial, hands and center cap. */
export function starburstClock(group, r = 0.3) {
  const rays = 10;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const xe = Math.cos(a) * r * 1.22;
    const ye = Math.sin(a) * r * 1.22;
    const xk = Math.cos(a + Math.PI / rays) * r * 0.85;
    const yk = Math.sin(a + Math.PI / rays) * r * 0.85;
    const tri = new THREE.Shape();
    tri.moveTo(0, 0);
    tri.lineTo(xe, ye);
    tri.lineTo(xk, yk);
    tri.closePath();
    const m = new THREE.Mesh(
      new THREE.ShapeGeometry(tri),
      mat(i % 2 === 0 ? C.gold : C.terracottaDark, { side: THREE.DoubleSide, roughness: 0.55 })
    );
    m.position.z = 0.002;
    group.add(m);
  }
  const face = new THREE.Mesh(new THREE.CircleGeometry(r * 0.62, 24), mat(C.cream));
  face.position.z = 0.01;
  group.add(face);
  // Canvas dial with ticks + 12/3/6/9.
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  const cg = cv.getContext('2d');
  const cx = 128;
  const cy = 128;
  cg.fillStyle = '#f4ecd8';
  cg.beginPath();
  cg.arc(cx, cy, 112, 0, Math.PI * 2);
  cg.fill();
  cg.strokeStyle = '#4e3823';
  cg.lineWidth = 9;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    cg.beginPath();
    cg.moveTo(cx + Math.cos(a) * 80, cy + Math.sin(a) * 80);
    cg.lineTo(cx + Math.cos(a) * 100, cy + Math.sin(a) * 100);
    cg.stroke();
  }
  cg.fillStyle = '#1c1f24';
  cg.font = 'bold 34px Arial, sans-serif';
  cg.textAlign = 'center';
  cg.textBaseline = 'middle';
  for (const [label, idx] of [['12', 0], ['3', 1], ['6', 2], ['9', 3]]) {
    const a = (idx / 4) * Math.PI * 2 - Math.PI / 2;
    cg.fillText(label, cx + Math.cos(a) * 64, cy + Math.sin(a) * 64);
  }
  const cvTex = new THREE.CanvasTexture(cv);
  cvTex.colorSpace = THREE.SRGBColorSpace;
  const dial = new THREE.Mesh(
    new THREE.PlaneGeometry(r * 1.24, r * 1.24),
    new THREE.MeshStandardMaterial({ map: cvTex, transparent: true, roughness: 0.6 })
  );
  dial.position.z = 0.04;
  group.add(dial);
  const handMat = mat(C.black, { roughness: 0.5 });
  box(group, 0.028, r * 0.5, 0.02, handMat, 0, r * 0.2, 0.07, 0, 0, 0.35);
  box(group, 0.028, r * 0.66, 0.02, handMat, 0, r * 0.06, 0.07, 0, 0, -0.5);
  sph(group, 0.03, mat(C.walnutDark), 0, 0, 0.075, 0, 0, 0, 10);
}

/** String-art / nailed-thread panel in a wood hoop. */
export function stringArt(group, r = 0.24) {
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(r, 0.022, 8, 28), mat(C.walnut, { roughness: 0.5 }));
  group.add(hoop);
  const N = 20;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r * 0.84, Math.sin(a) * r * 0.84, 0.002));
  }
  const step = 6;
  const lm1 = new THREE.LineBasicMaterial({ color: C.coral });
  const lm2 = new THREE.LineBasicMaterial({ color: C.gold });
  for (let i = 0; i < N; i++) {
    const a = pts[i];
    const b = pts[(i + step) % N];
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    group.add(new THREE.Line(geo, i % 2 === 0 ? lm1 : lm2));
  }
}

/** Small macramé hanging: dowel, knotted cone body, dangling fringe. */
export function macrame(group, w = 0.3, h = 0.66) {
  // Horizontal dowel (cylinder axis rotated to X).
  const dowel = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, w, 8), mat(C.walnutDark));
  dowel.position.set(0, h * 0.44, 0);
  dowel.rotation.z = Math.PI / 2;
  group.add(dowel);
  // Knotted cone body (axis vertical, hanging down).
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(w / 2.05, w / 2.05, h * 0.58, 10, 1),
    mat(C.ivory, { roughness: 0.95 })
  );
  body.position.set(0, 0, 0);
  group.add(body);
  // Dangling fringe strands.
  for (let i = 0; i < 9; i++) {
    const lx = (i - 4) * w * 0.11;
    const fringe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.006, h * 0.16, 4),
      mat(C.ivory, { roughness: 0.9 })
    );
    fringe.position.set(lx, -h * 0.37, 0);
    group.add(fringe);
  }
}