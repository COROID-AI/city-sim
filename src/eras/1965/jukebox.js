/**
 * jukebox.js — chrome-and-glass 1965 jukebox:
 *   glowing arch trim, visible record stack in a glass window,
 *   coin slot, selector buttons, full-height pedestal silhouette.
 * Built in local space facing +z; parent adds + rotates.
 */
import * as THREE from '../../../public/js/three/build/three.module.js';
import { C, mat, metal, glassy, emissive, box, cyl, sph, torus } from './util.js';

export function jukebox() {
  const g = new THREE.Group();

  // Main cabinet (deep teak, chrome trim).
  box(g, 0.78, 1.15, 0.5, mat(C.walnut, { roughness: 0.7 }), 0, 0.6, 0);
  // Top arch — chrome half-ring standing in the front X-Y plane.
  torus(g, 0.3, 0.045, metal(C.chrome), 0, 1.55, 0.18, 0, 0, 0, 24, 8, Math.PI);
  // glass arch window showing records — vertical arched glass block.
  const archGlass = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 18, 14, 0, Math.PI, 0, Math.PI / 2),
    glassy(0xc9e9ee, { opacity: 0.35 })
  );
  archGlass.position.set(0, 1.15, 0.21);
  archGlass.scale.set(1, 1.35, 0.18);
  g.add(archGlass);

  // Visible record stack: a spindle of colorful 45s.
  const recMat = [C.red, C.yellow, C.mint, C.sky, C.coral, C.navy];
  for (let i = 0; i < 7; i++) {
    const rec = new THREE.Mesh(
      new THREE.CylinderGeometry(0.19, 0.19, 0.012, 24),
      mat(recMat[i % recMat.length], { roughness: 0.5 })
    );
    rec.position.set(0, 0.85 + i * 0.042, 0.21);
    g.add(rec);
    // label dot
    const label = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.014, 14),
      mat(C.black, { roughness: 0.7 })
    );
    label.position.set(0, 0.85 + i * 0.042, 0.214);
    g.add(label);
  }
  // Spindle post through the records.
  cyl(g, 0.008, 0.008, 0.34, metal(), 0, 1.0, 0.214, 0, 0, 0, 6);

  // Fluted chrome pilasters framing the window.
  for (const sx of [-0.36, 0.36]) {
    cyl(g, 0.022, 0.022, 0.72, metal(), sx, 1.02, 0.22, 0, 0, 0, 10);
  }

  // Coin slot + price sign on the front.
  const front = new THREE.Group();
  box(front, 0.3, 0.16, 0.02, metal(), 0, 0.42, 0.24);
  box(front, 0.1, 0.02, 0.012, mat(C.black), 0, 0.45, 0.245);
  // price reading "5¢ a play"
  const price = label(`5¢ / 3 plays`, 0.3);
  price.position.set(0, 0.3, 0.246);
  front.add(price);
  g.add(front);

  // Selector keys (A1..A8 + BY ) — round plastic buttons.
  for (let r = 0; r < 2; r++) {
    for (let n = 0; n < 4; n++) {
      const kx = -0.12 + n * 0.075;
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.02, 10),
        mat(C.cream, { roughness: 0.5 }));
      k.position.set(kx, 0.7 + r * 0.08, 0.24);
      g.add(k);
      sph(g, 0.026, mat(C.cream, { roughness: 0.5 }), kx, 0.7 + r * 0.08 + 0.012, 0.245, 0, 0, 0, 10);
    }
  }

  // Glowing arch trim (emissive tube around the arch).
  torus(g, 0.3, 0.014, emissive(C.coral, 2.0), 0, 1.55, 0.215, 0, 0, 0, 32, 8, Math.PI);
  // Speaker grille (circle of chrome dots) at the base.
  for (let i = -3; i <= 3; i++) {
    for (let j = -2; j <= 2; j++) {
      sph(g, 0.012, metal(), i * 0.07, 0.22 + j * 0.07, 0.25, 0, 0, 0, 8);
    }
  }
  // Base plinth.
  box(g, 0.86, 0.08, 0.6, mat(C.black, { roughness: 0.4 }), 0, 0.04, 0);
  // Casters.
  for (const [cx, cz] of [[0.3, 0.22], [-0.3, 0.22], [0.3, -0.22], [-0.3, -0.22]]) {
    sph(g, 0.035, mat(C.black, { roughness: 0.7 }), cx, 0.02, cz, 0, 0, 0, 10);
  }
  return g;
}

/** Small canvas label for jukebox / neon. */
export function label(text, width = 0.3) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const cg = c.getContext('2d');
  cg.clearRect(0, 0, 512, 96);
  cg.fillStyle = '#ffffff';
  cg.shadowColor = '#ffd27a';
  cg.shadowBlur = 16;
  cg.font = 'bold 44px Arial, sans-serif';
  cg.textAlign = 'center';
  cg.textBaseline = 'middle';
  cg.fillText(text, 256, 48);
  cg.shadowBlur = 0;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width * 0.19),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true })
  );
  return m;
}