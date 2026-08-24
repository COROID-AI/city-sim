/**
 * counter.js — 2025 contemporary café countertop equipment:
 *   a sleek multi-boiler espresso machine with a touchscreen + pressure/flow
 *   readouts, a pour-over station (gooseneck kettle, V60s, scales), a batch
 *   brewer filling insulated carafes, an iPad-as-register POS on a stand with
 *   a tap-to-pay contactless reader, tablet order screens, oat/almond milk
 *   cartons, and a pastry case with modern minimal labels.
 */
import * as THREE from '../../../public/js/three/lib/three.module.js';
import { C, mat, matte, metal, glassy, emissive, box, cyl, sph, torus } from './util.js';

/**
 * Sleek multi-boiler espresso machine with a dark matte body, chrome group
 * heads, steam wands, and a touchscreen showing pressure/flow readouts.
 */
export function espressoMachine() {
  const g = new THREE.Group();

  // Matte black body.
  box(g, 0.5, 0.34, 0.66, matte(C.matteBlack, { roughness: 0.4 }), 0, 0.18, 0);
  // Brushed metal top plate.
  box(g, 0.52, 0.02, 0.68, metal(0xc9ced2, { roughness: 0.3 }), 0, 0.36, 0);
  // Side panels (slightly recessed matte).
  box(g, 0.015, 0.3, 0.6, matte(C.matteBlackSoft, { roughness: 0.5 }), -0.26, 0.18, 0);
  box(g, 0.015, 0.3, 0.6, matte(C.matteBlackSoft, { roughness: 0.5 }), 0.26, 0.18, 0);

  // Touchscreen on the front fascia — dark glass with a glowing UI.
  const screen = box(g, 0.2, 0.12, 0.015, emissive(C.screen, 1.4), 0, 0.26, 0.34);
  screen.name = 'espresso-touchscreen';
  // Screen bezel.
  box(g, 0.22, 0.14, 0.01, matte(C.matteBlack, { roughness: 0.3 }), 0, 0.26, 0.335);

  // Pressure / flow readout rings (two small glowing gauges beside the screen).
  const ringMat = emissive(C.screen, 1.1);
  torus(g, 0.03, 0.008, ringMat, -0.1, 0.26, 0.34, 0, 0, 0, 16, 8);
  torus(g, 0.03, 0.008, ringMat, 0.1, 0.26, 0.34, 0, 0, 0, 16, 8);

  // Group heads — two chrome portafilters on the front.
  const headMat = metal(0xdfe3e6, { roughness: 0.2 });
  for (const hx of [-0.13, 0.13]) {
    cyl(g, 0.035, 0.035, 0.05, headMat, hx, 0.14, 0.3, 0, 0, 0, 12);
    // Portafilter handle (matte black), angled down.
    cyl(g, 0.02, 0.02, 0.16, matte(C.matteBlack, { roughness: 0.5 }), hx, 0.13, 0.22, 0.4, 0, 0, 8);
    // Chrome basket rim.
    cyl(g, 0.045, 0.045, 0.02, headMat, hx, 0.11, 0.31, 0, 0, 0, 12);
  }

  // Steam wands — chrome tubes angled toward the front.
  const wandMat = metal(0xe4e8ea, { roughness: 0.2 });
  cyl(g, 0.014, 0.014, 0.3, wandMat, 0.2, 0.24, 0.28, Math.PI / 2.3, 0, 0.5, 8);
  cyl(g, 0.014, 0.014, 0.3, wandMat, 0.2, 0.24, 0.28, Math.PI / 2.3, 0, 0.5, 8);
  // Wand tips.
  sph(g, 0.018, wandMat, 0.2, 0.1, 0.42, 0, 0, 0, 8);

  // Drip tray — matte black channel with stainless slat top.
  box(g, 0.46, 0.04, 0.4, matte(C.matteBlack, { roughness: 0.4 }), 0, 0.025, 0);
  box(g, 0.44, 0.015, 0.38, metal(0xb9bfc4, { roughness: 0.4 }), 0, 0.05, 0);

  // Two small espresso cups on the warm tray.
  cup(g, 0.12, 0.075, 0.12, C.stoneware);
  cup(g, 0.12, 0.075, 0.0, C.stonewareDark);

  return g;
}

/** Small double-wall-style glass or stoneware espresso cup. */
function cup(g, x, y, z, color = C.stoneware) {
  const c = new THREE.Group();
  cyl(c, 0.03, 0.022, 0.05, mat(color, { roughness: 0.4 }), 0, 0.025, 0);
  torus(c, 0.03, 0.006, mat(color, { roughness: 0.4 }), 0, 0.05, 0, Math.PI / 2, 0, 0, 12, 6);
  c.position.set(x, y, z);
  g.add(c);
}

/**
 * Pour-over station: gooseneck kettle, two V60 drippers on servers, and a
 * digital scale with a glowing readout.
 */
export function pourOverStation() {
  const g = new THREE.Group();

  // Gooseneck kettle — matte black body with a long thin spout.
  const kettle = new THREE.Group();
  cyl(kettle, 0.075, 0.06, 0.16, matte(C.matteBlack, { roughness: 0.45 }), 0, 0.08, 0, 0, 0, 0, 16);
  // Lid knob.
  sph(kettle, 0.025, matte(C.matteBlack, { roughness: 0.4 }), 0, 0.18, 0, 0, 0, 0, 10);
  // Gooseneck spout (thin angled cylinder).
  cyl(kettle, 0.012, 0.012, 0.2, matte(C.matteBlack, { roughness: 0.4 }), 0.04, 0.16, 0.04, 0.9, 0, 0.6, 8);
  // Handle arc.
  torus(kettle, 0.05, 0.012, matte(C.matteBlack, { roughness: 0.5 }), -0.04, 0.1, 0, 0, 0, 0, 12, 8, Math.PI * 1.1);
  kettle.position.set(0.0, 0, 0.08);
  g.add(kettle);

  // Digital scale with glowing readout.
  const scale = new THREE.Group();
  box(scale, 0.22, 0.025, 0.2, matte(C.matteBlack, { roughness: 0.4 }), 0, 0.012, 0);
  box(scale, 0.08, 0.015, 0.03, emissive(C.screen, 1.3), 0.05, 0.03, 0.06);
  scale.position.set(-0.16, 0, 0.12);
  g.add(scale);

  // V60 dripper on a ceramic pour-over server.
  const server = new THREE.Group();
  // Ceramic server (carafe).
  cyl(server, 0.05, 0.035, 0.12, mat(C.stoneware, { roughness: 0.45 }), 0, 0.06, 0, 0, 0, 0, 14);
  // Handle.
  torus(server, 0.03, 0.008, mat(C.stoneware, { roughness: 0.45 }), 0.055, 0.09, 0, 0, 0, 0, 10, 6, Math.PI * 0.9);
  // V60 cone (truncated cone).
  const cone = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.028, 0.07, 16, 1, false, 0, Math.PI * 2),
    mat(C.matteBlackSoft, { roughness: 0.5 })
  );
  cone.position.set(0, 0.15, 0);
  server.add(cone);
  // Paper filter hint (white rim).
  cyl(server, 0.052, 0.052, 0.012, mat(C.paper, { roughness: 0.9 }), 0, 0.185, 0, 0, 0, 0, 16);
  server.position.set(0.0, 0, -0.16);
  g.add(server);

  // A second V60 dripper.
  const server2 = new THREE.Group();
  cyl(server2, 0.045, 0.03, 0.11, mat(C.stonewareDark, { roughness: 0.45 }), 0, 0.055, 0, 0, 0, 0, 14);
  const cone2 = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.025, 0.065, 16, 1),
    mat(C.matteBlackSoft, { roughness: 0.5 })
  );
  cone2.position.set(0, 0.14, 0);
  server2.add(cone2);
  server2.position.set(0.18, 0, -0.16);
  g.add(server2);

  return g;
}

/**
 * Batch brewer into insulated carafes — a boxy brewer with a glass carafe
 * and a thermal (double-wall) carafe beside it.
 */
export function batchBrewer() {
  const g = new THREE.Group();

  // Brewer body.
  box(g, 0.3, 0.3, 0.32, matte(C.matteBlack, { roughness: 0.4 }), 0, 0.16, 0);
  box(g, 0.32, 0.02, 0.34, metal(0xc9ced2, { roughness: 0.3 }), 0, 0.32, 0);
  // Water tank (glass).
  cyl(g, 0.06, 0.06, 0.12, glassy(0xeaf3f2, { opacity: 0.4 }), 0.09, 0.26, 0, 0, 0, 0, 16);

  // Glass carafe on a warmer plate.
  const carafe = new THREE.Group();
  cyl(carafe, 0.05, 0.03, 0.16, glassy(0xeaf3f2, { opacity: 0.5 }), 0, 0.08, 0, 0, 0, 0, 16);
  cyl(carafe, 0.05, 0.05, 0.012, matte(C.matteBlack, { roughness: 0.4 }), 0, 0.006, 0, 0, 0, 0, 16);
  carafe.position.set(-0.12, 0, 0.1);
  g.add(carafe);

  // Insulated thermal carafe (double-wall steel).
  const thermal = new THREE.Group();
  cyl(thermal, 0.045, 0.04, 0.2, metal(0xdfe3e6, { roughness: 0.35, metalness: 0.85 }), 0, 0.1, 0, 0, 0, 0, 16);
  // Spout + lid.
  cyl(thermal, 0.02, 0.02, 0.04, matte(C.matteBlack, { roughness: 0.4 }), 0.01, 0.21, 0, 0, 0, 0, 10);
  thermal.position.set(0.14, 0, 0.1);
  g.add(thermal);

  return g;
}

/**
 * iPad-as-register POS on a stand with a tap-to-pay contactless reader.
 * The iPad screen shows an ordering UI.
 */
export function ipadPOS() {
  const g = new THREE.Group();

  // Stand base + neck.
  cyl(g, 0.07, 0.07, 0.02, matte(C.matteBlack, { roughness: 0.4 }), 0, 0.01, 0, 0, 0, 0, 16);
  cyl(g, 0.02, 0.025, 0.22, matte(C.matteBlack, { roughness: 0.4 }), 0, 0.13, 0, 0.15, 0, 0, 8);

  // iPad — a slim slab with a glowing screen.
  const ipad = new THREE.Group();
  box(ipad, 0.24, 0.016, 0.17, matte(C.matteBlack, { roughness: 0.3 }), 0, 0, 0);
  // Screen with ordering UI glow.
  const screen = box(ipad, 0.22, 0.012, 0.15, emissive(C.screen, 1.5), 0, 0.006, 0);
  screen.name = 'ipad-pos-screen';
  ipad.position.set(0, 0.26, 0);
  ipad.rotation.x = -0.25;
  g.add(ipad);

  // Contactless tap-to-pay reader on a short stand beside the iPad.
  const reader = new THREE.Group();
  cyl(reader, 0.035, 0.04, 0.1, matte(C.matteBlackSoft, { roughness: 0.4 }), 0, 0.05, 0, 0, 0, 0, 12);
  box(reader, 0.09, 0.015, 0.12, matte(C.matteBlack, { roughness: 0.3 }), 0, 0.12, 0);
  // Contactless glow symbol (emissive ring).
  torus(reader, 0.03, 0.006, emissive(C.screen, 1.6), 0, 0.135, 0.01, 0, 0, 0, 16, 8);
  reader.position.set(0.2, 0, 0.05);
  reader.rotation.y = 0.4;
  g.add(reader);

  return g;
}

/** Tablet order screen standing on a counter stand. */
export function tabletScreen() {
  const g = new THREE.Group();
  cyl(g, 0.05, 0.05, 0.02, matte(C.matteBlack, { roughness: 0.4 }), 0, 0.01, 0, 0, 0, 0, 14);
  cyl(g, 0.015, 0.02, 0.2, matte(C.matteBlack, { roughness: 0.4 }), 0, 0.11, 0, 0.12, 0, 0, 8);
  const tab = new THREE.Group();
  box(tab, 0.2, 0.014, 0.14, matte(C.matteBlack, { roughness: 0.3 }), 0, 0, 0);
  box(tab, 0.18, 0.01, 0.12, emissive(C.screen, 1.4), 0, 0.005, 0);
  tab.position.set(0, 0.22, 0);
  tab.rotation.x = -0.28;
  g.add(tab);
  return g;
}

/** Oat / almond milk carton with a minimal label. */
export function milkCarton(color = C.oatMilk, label = 'OAT') {
  const g = new THREE.Group();
  // Carton body (rounded box look via box + slight taper not needed).
  box(g, 0.07, 0.18, 0.07, mat(color, { roughness: 0.6 }), 0, 0.09, 0);
  // Tetra top.
  box(g, 0.07, 0.03, 0.07, mat(color, { roughness: 0.6 }), 0, 0.195, 0);
  // Minimally labeled band.
  const labelTex = canvasText(label, 0.07, 0.05, C.matteBlack);
  const labelPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.07, 0.05),
    new THREE.MeshStandardMaterial({ map: labelTex, transparent: true, roughness: 0.6 })
  );
  labelPlane.position.set(0, 0.1, 0.036);
  g.add(labelPlane);
  return g;
}

/** Minimal canvas text texture for milk carton labels. */
function canvasText(text, w, h, color) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 96);
  g.fillStyle = '#ffffff';
  g.font = 'bold 44px Helvetica, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 48);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Pastry case with modern minimal labels — a glass display case with a few
 * pastries and small label cards.
 */
export function pastryCase() {
  const g = new THREE.Group();
  // Base + back panel.
  box(g, 0.6, 0.08, 0.4, matte(C.matteBlack, { roughness: 0.4 }), 0, 0.04, 0);
  box(g, 0.02, 0.28, 0.4, matte(C.matteBlackSoft, { roughness: 0.5 }), -0.31, 0.2, 0);
  // Glass enclosure (transparent box).
  const glassMat = glassy(0xeaf3f2, { opacity: 0.25 });
  box(g, 0.6, 0.28, 0.02, glassMat, 0, 0.2, 0.21);
  box(g, 0.02, 0.28, 0.4, glassMat, 0.31, 0.2, 0);
  box(g, 0.6, 0.02, 0.4, glassMat, 0, 0.34, 0);

  // A few pastries on the base.
  for (const [px, pz, pc] of [[-0.15, 0, C.terracotta], [0, 0, 0xd9b878], [0.15, 0, 0x9bbf7a]]) {
    sph(g, 0.035, mat(pc, { roughness: 0.7 }), px, 0.1, pz, 0, 0, 0, 12);
  }

  // Minimal label cards along the front edge.
  const labelMat = mat(C.paper, { roughness: 0.9 });
  for (const [lx, label] of [[-0.15, 'CRUFFIN'], [0, 'PISTACHIO'], [0.15, 'MISO COOKIE']]) {
    const cardTex = canvasText(label, 0.14, 0.04, C.matteBlack);
    const card = new THREE.Mesh(
      new THREE.PlaneGeometry(0.14, 0.04),
      new THREE.MeshStandardMaterial({ map: cardTex, roughness: 0.8 })
    );
    card.position.set(lx, 0.085, 0.195);
    g.add(card);
  }
  return g;
}