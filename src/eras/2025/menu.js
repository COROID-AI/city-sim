/**
 * menu.js — 2025 contemporary café menu boards + QR-code ordering stickers.
 *
 * Minimal sans-serif printed menu boards showing 2025-appropriate prices
 * (flat white $4.50–$5.50, cold brew, matcha, oat milk +50¢) plus small
 * QR-code table-ordering stickers on the tables.
 */
import * as THREE from '../../../public/js/three/lib/three.module.js';
import { C, mat, metal, canvasTexture } from './util.js';

export const MENU_LINES = [
  { left: 'FLAT WHITE', right: '$4.50' },
  { left: 'FLAT WHITE (LARGE)', right: '$5.50' },
  { left: 'COLD BREW', right: '$5.00' },
  { left: 'COLD BREW (NITRO)', right: '$6.00' },
  { left: 'MATCHA LATTE', right: '$5.50' },
  { left: 'HOUSE DRIP', right: '$4.00' },
  { left: 'FILTER (POUR-OVER)', right: '$5.00' },
  { left: 'CORTADO', right: '$4.75' },
  { left: 'LONG BLACK', right: '$4.25' },
  { left: 'OAT / ALMOND MILK', right: '+50¢' },
  { left: 'PASTRY', right: '$4.50' },
  { left: 'TOAST', right: '$7.00' },
];

/**
 * Minimal sans-serif menu board texture — off-white card, thin ink rules,
 * left-aligned items and right-aligned prices.
 */
export function menuTexture() {
  const W = 512;
  const H = 640;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');

  // Paper card.
  g.fillStyle = '#f6f3ec';
  g.fillRect(0, 0, W, H);
  // Thin matte frame.
  g.strokeStyle = '#d8d2c4';
  g.lineWidth = 8;
  g.strokeRect(16, 16, W - 32, H - 32);

  // Header.
  g.fillStyle = '#1a1a1c';
  g.font = 'bold 40px Helvetica, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.fillText('MENU', W / 2, H * 0.05);
  g.font = '18px Helvetica, Arial, sans-serif';
  g.fillText('SINGLE ORIGIN · SMALL BATCH', W / 2, H * 0.115);
  g.strokeStyle = '#cfc9bb';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(W * 0.08, H * 0.165);
  g.lineTo(W * 0.92, H * 0.165);
  g.stroke();

  const rowH = (H * 0.82) / MENU_LINES.length;
  MENU_LINES.forEach((line, i) => {
    const y = H * 0.185 + i * rowH;
    g.fillStyle = '#1a1a1c';
    g.font = 'bold 24px Helvetica, Arial, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(line.left, W * 0.07, y);
    g.textAlign = 'right';
    g.fillText(line.right, W * 0.93, y);
    // faint dot leaders
    g.fillStyle = 'rgba(26,26,28,0.18)';
    g.font = '16px Helvetica, Arial, sans-serif';
    g.textAlign = 'center';
    let dots = '';
    const approx = 0.5 - line.left.length * 0.03 - line.right.length * 0.04;
    for (let d = 0; d < Math.max(2, Math.round(approx * 16)); d++) dots += '·';
    g.fillText(dots, W / 2, y);
  });

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Printed menu board hung on a wall. `wall` is 'back' | 'left' | 'right'.
 */
export function menuBoard(group, wall = 'back', x = 0, y = 1.8, z = -2.52, scale = 1) {
  const w = 1.0 * scale;
  const h = 1.25 * scale;
  const pg = new THREE.Group();
  const tex = menuTexture();
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 })
  );
  pg.add(face);

  // Thin matte black frame bars.
  const fm = mat(C.matteBlack, { roughness: 0.4 });
  const t = 0.03;
  const bars = [
    [w + 2 * t, t, 0, h / 2 + t / 2],
    [w + 2 * t, t, 0, -h / 2 - t / 2],
    [t, h + 2 * t, -w / 2 - t / 2, 0],
    [t, h + 2 * t, w / 2 + t / 2, 0],
  ];
  for (const [bw, bh, bx, by] of bars) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, t), fm);
    b.position.set(bx, by, 0);
    pg.add(b);
  }

  if (wall === 'left') pg.rotation.y = Math.PI / 2;
  else if (wall === 'right') pg.rotation.y = -Math.PI / 2;
  pg.position.set(x, y, z);
  group.add(pg);
  return pg;
}

/**
 * QR-code ordering sticker — a small white card with a black QR-style pattern
 * and a tiny "SCAN TO ORDER" caption. Placed on tables.
 */
export function qrSticker(group, x, y, z, size = 0.12) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  // QR finder patterns (three corners) + random-ish modules.
  g.fillStyle = '#1a1a1c';
  for (const [fx, fy] of [[8, 8], [88, 8], [8, 88]]) {
    g.fillRect(fx, fy, 32, 32);
    g.fillStyle = '#ffffff';
    g.fillRect(fx + 8, fy + 8, 16, 16);
    g.fillStyle = '#1a1a1c';
    g.fillRect(fx + 12, fy + 12, 8, 8);
  }
  // Data modules.
  for (let i = 0; i < 60; i++) {
    const mx = 8 + Math.floor(Math.random() * 11) * 4;
    const my = 8 + Math.floor(Math.random() * 11) * 4;
    if ((mx < 40 && my < 40) || (mx > 80 && my < 40) || (mx < 40 && my > 80)) continue;
    g.fillStyle = Math.random() > 0.5 ? '#1a1a1c' : '#ffffff';
    g.fillRect(mx, my, 4, 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;

  const sticker = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6 })
  );
  sticker.position.set(x, y, z);
  sticker.rotation.x = -Math.PI / 2;
  group.add(sticker);
  return sticker;
}