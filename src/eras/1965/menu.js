/**
 * menu.js — 1965 letterboard menu + neon-style interior signs.
 *
 * The menu is a plastic letterboard: black slat backing, white removable
 * letters in fitted rows, era-accurate prices ("COFFEE ... 15", "COFFEE 25"),
 * milkshakes and sandwiches. The neon OPEN sign is a glowing arc tube.
 */
import * as THREE from '../../../public/js/three/lib/three.module.js';
import { C, mat, metal, emissive, box, cyl } from './util.js';
import { artworkTexture, WALL_LEFT } from './wallArt.js';

const MENU_LINES = [
  { left: 'COFFEE', right: '15' },
  { left: 'COFFEE W/ CREAM', right: '15' },
  { left: 'ESPRESSO', right: '20' },
  { left: 'HOT CHOCOLATE', right: '20' },
  { left: 'MILKSHAKE', right: '25' },
  { left: 'MALTED', right: '30' },
  { left: 'EGG CREAM', right: '20' },
  { left: 'TUNA SANDWICH', right: '35' },
  { left: 'GRILLED CHEESE', right: '30' },
  { left: 'HAM & CHEESE', right: '35' },
  { left: 'FRIES', right: '15' },
  { left: 'PIE', right: '25' },
  { left: 'CAKE', right: '20' },
  { left: 'CHERRY COKE', right: '15' },
  { left: 'ORANGE SODA', right: '15' },
];

/** Draw a MENU_LINES tile with white letters between gold channel rails. */
function menuTexture() {
  const W = 512;
  const H = 640;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  // Black letterboard body.
  g.fillStyle = '#171a1e';
  g.fillRect(0, 0, W, H);
  // Inner recess.
  g.fillStyle = '#0e1013';
  g.fillRect(W * 0.03, H * 0.02, W * 0.94, H * 0.96);
  // Vertical channel rails (the letterboard track slots).
  g.strokeStyle = 'rgba(200,180,120,0.28)';
  g.lineWidth = 4;
  for (let i = 0; i < 24; i++) {
    const y = H * 0.02 + (i / 24) * H * 0.96;
    g.beginPath();
    g.moveTo(W * 0.05, y);
    g.lineTo(W * 0.95, y);
    g.stroke();
  }
  // Header
  g.fillStyle = '#f2ead8';
  g.font = 'bold 44px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.fillText('TODAY\'S BOARD', W / 2, H * 0.045);
  g.fillStyle = '#c23b2e';
  g.font = 'italic 32px Georgia, serif';
  g.fillText('— The Casbah Café —', W / 2, H * 0.115);
  g.strokeStyle = 'rgba(230,200,120,0.5)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(W * 0.08, H * 0.17);
  g.lineTo(W * 0.92, H * 0.17);
  g.stroke();

  const rowH = (H * 0.82) / MENU_LINES.length;
  MENU_LINES.forEach((line, i) => {
    const y = H * 0.185 + i * rowH;
    g.fillStyle = '#fdfdf8';
    g.font = 'bold 28px "Courier New", monospace';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(line.left, W * 0.07, y);
    g.textAlign = 'right';
    g.fillStyle = '#f5c84c';
    g.fillText(line.right, W * 0.93, y);
    // dot leaders
    g.fillStyle = 'rgba(240,200,90,0.35)';
    g.font = '20px Arial, sans-serif';
    g.textAlign = 'center';
    let dots = '';
    const approx = 0.6 - line.left.length * 0.028 - line.right.length * 0.03;
    for (let d = 0; d < Math.max(2, Math.round(approx * 18)); d++) dots += '·';
    g.fillText(dots, W / 2, y);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Full letterboard menu board hung above the counter / jukebox area. */
export function menuBoard(group, wall = 'back', x = -1.45, y = 1.75, z = -2.52) {
  const w = 1.15;
  const h = 1.4;
  const pg = new THREE.Group();
  const tex = menuTexture();
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 })
  );
  pg.add(face);

  // Beveled chrome clip-frame.
  const fm = metal(C.chrome, { roughness: 0.3 });
  const bars = [
    [w + 0.06, 0.04, 0, h / 2 + 0.02],
    [w + 0.06, 0.04, 0, -h / 2 - 0.02],
    [0.04, h + 0.06, -w / 2 - 0.02, 0],
    [0.04, h + 0.06, w / 2 + 0.02, 0],
  ];
  for (const [bw, bh, bx, by] of bars) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.05), fm);
    b.position.set(bx, by, 0);
    pg.add(b);
  }
  // Mount on the wall chosen by caller.
  if (wall === 'left') pg.rotation.y = Math.PI / 2;
  else if (wall === 'right') pg.rotation.y = -Math.PI / 2;
  pg.position.set(x, y, z);
  group.add(pg);
  return pg;
}

/** Neon OPEN-style interior sign (glass tube, warm glow). */
export function neonSign(group, wall = 'front', x = -0.2, y = 2.25, z = 2.49) {
  const g = new THREE.Group();
  const tubeMat = emissive(C.coral, 2.2);
  const tubeMat2 = emissive(C.gold, 1.8);
  const backer = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.34, 0.03),
    mat(C.black, { roughness: 0.4 })
  );
  backer.position.set(0, 0, 0);
  g.add(backer);

  const letters = 'OPEN';
  const letterW = 0.17;
  const gap = 0.1;
  const total = letters.length * letterW + (letters.length - 1) * gap;
  for (let i = 0; i < letters.length; i++) {
    const lx = -total / 2 + i * (letterW + gap) + letterW / 2;
    const ch = drawLetter(letters[i]);
    const lmat = new THREE.Mesh(
      new THREE.PlaneGeometry(letterW * 0.86, 0.24),
      new THREE.MeshStandardMaterial({ map: ch, transparent: true, emissive: C.coral, emissiveIntensity: 1.6 })
    );
    lmat.position.set(lx, 0.05, 0.02);
    g.add(lmat);
    // glow halo mesh behind each letter
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(letterW * 0.92, 0.28),
      new THREE.MeshBasicMaterial({ color: C.coral, transparent: true, opacity: 0.18 })
    );
    glow.position.set(lx, 0.05, -0.01);
    g.add(glow);
  }
  // Bottom script line.
  const sub = new THREE.Mesh(
    new THREE.PlaneGeometry(0.55, 0.06),
    new THREE.MeshStandardMaterial({
      map: artworkTexture(256, 32, (cg) => {
        cg.fillStyle = '#ffca8e';
        cg.font = 'italic bold 24px Georgia, serif';
        cg.textAlign = 'center';
        cg.textBaseline = 'middle';
        cg.fillText('~ espresso bar ~', 128, 16);
      }),
      transparent: true,
      emissive: C.amber,
      emissiveIntensity: 0.9,
    })
  );
  sub.position.set(0, -0.13, 0.02);
  g.add(sub);

  if (wall === 'front') g.rotation.y = Math.PI; // faces -z
  else if (wall === WALL_LEFT) g.rotation.y = Math.PI / 2;
  else if (wall === 'right') g.rotation.y = -Math.PI / 2;
  g.position.set(x, y, z);
  group.add(g);
  return g;
}

/** Canvas glyph texture for one neon letter (white core + bloom). */
function drawLetter(ch) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.shadowColor = C.coral;
  g.shadowBlur = 22;
  g.fillStyle = '#ffffff';
  g.font = 'bold 96px "Arial Black", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(ch, 64, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}