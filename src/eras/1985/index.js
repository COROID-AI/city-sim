/**
 * 1985 — "Neon Café" era module.
 *
 * Black-and-chrome + pastel-neon interior: laminate tables with tubular chrome
 * legs, black vinyl cafe chairs, rubber plants, mirrored wall panel, track
 * lighting, pink/teal neon strips, a Memphis squiggle mural, an arcade corner,
 * a boxy chrome espresso machine with a digital keypad facade, a drip-brew
 * tower with glass decanters on warmers, an early electronic POS with a green
 * segment display + dot-matrix customer display, a glass cookie jar, a cassette
 * sales rack, a backlit lightbox menu (coffee ~50-75¢), a Coffee Talk community
 * board, band gig posters, an Employee of the Month photo, a silver twin-cassette
 * boombox with VU meters + antenna, a small CRT TV playing static, and five
 * patrons in 80s fashion (Members-Only jackets, perms/feathered hair, sneakers,
 * Walkman, pager, Polaroid).
 *
 * Everything is procedural (primitives + canvas textures), deliberately low-poly
 * so the era holds 60 fps on integrated graphics.
 */
import * as THREE from '../../../public/js/three/build/three.module.js';

const C = {
  chrome: 0xd9dee3,
  chromeDark: 0x9aa2ab,
  steel: 0xb9c0c7,
  black: 0x121418,
  blackSoft: 0x1d2128,
  vinyl: 0x16181d,
  laminate: 0x23262c,
  laminateEdge: 0x8f979f,
  pink: 0xff4fa3,
  teal: 0x2ee6d6,
  amber: 0xffb02e,
  orange: 0xff7a2f,
  greenSeg: 0x53ff6e,
  glass: 0xcfeae4,
  skin: 0xc98d6f,
  hairDark: 0x2c1d14,
  hairBlond: 0xd9a24a,
  coffee: 0x2a170d,
  leaf: 0x1f4a33,
  leafLight: 0x2f6b48,
  terracotta: 0x9a5b3f,
  cork: 0xb98a4e,
  cream: 0xf2e9d8,
};

const M = {};
function material(name, color, options = {}) {
  M[name] ||= new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...options });
  return M[name];
}
function box(parent, size, pos, mat, name) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
  mesh.position.set(...pos);
  if (name) mesh.name = name;
  parent.add(mesh);
  return mesh;
}
function cyl(parent, radius, height, pos, mat, segments = 12, name) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), mat);
  mesh.position.set(...pos);
  if (name) mesh.name = name;
  parent.add(mesh);
  return mesh;
}
function plane(parent, w, h, pos, mat, name, rotY = 0) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.position.set(...pos);
  mesh.rotation.y = rotY;
  if (name) mesh.name = name;
  parent.add(mesh);
  return mesh;
}
function makeCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}
function basicMat(name, tex, opts = {}) {
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, ...opts });
}
function wallText(text, width, height, opts = {}) {
  const tex = makeCanvas(1024, 512, (g, w, h) => {
    g.fillStyle = opts.bg || '#15121c';
    g.fillRect(0, 0, w, h);
    if (opts.border) {
      g.strokeStyle = opts.border;
      g.lineWidth = opts.borderWidth || 18;
      g.strokeRect(18, 18, w - 36, h - 36);
    }
    g.fillStyle = opts.color || '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = opts.font || 'bold 72px "Courier New", monospace';
    const lines = String(text).split('\n');
    lines.forEach((line, i) => {
      g.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * (opts.lineH || 96), w - 80);
    });
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), basicMat(`walltext-${opts.name || 't'}`, tex));
  return mesh;
}
function spriteText(text, width, height, opts = {}) {
  const tex = makeCanvas(512, 256, (g, w, h) => {
    g.fillStyle = opts.bg || '#ffffff';
    g.fillRect(0, 0, w, h);
    g.fillStyle = opts.color || '#000000';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = opts.font || 'bold 56px monospace';
    g.fillText(String(text), w / 2, h / 2, w - 40);
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(width, height, 1);
  return sprite;
}

// ---------------------------------------------------------------------------
// Floor — dark glossy slab with a faint pastel checker + neon grid
// ---------------------------------------------------------------------------
function makeFloor(group) {
  const tex = makeCanvas(512, 512, (g, w, h) => {
    g.fillStyle = '#14161c';
    g.fillRect(0, 0, w, h);
    const cell = 64;
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        if (((x / cell) + (y / cell)) % 2 === 0) {
          g.fillStyle = 'rgba(74,64,96,0.5)';
          g.fillRect(x, y, cell, cell);
        }
      }
    }
    g.strokeStyle = 'rgba(46,230,214,0.18)';
    g.lineWidth = 2;
    for (let x = 0; x <= w; x += cell) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += cell) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    for (let i = 0; i < 46; i++) {
      g.fillStyle = `rgba(255,79,163,${(0.06 + Math.random() * 0.14).toFixed(3)})`;
      g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(6.9, 0.02, 4.9),
    new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.55, metalness: 0.35 })
  );
  slab.position.set(0, 0.045, 0);
  group.add(slab);
}

// ---------------------------------------------------------------------------
// Counter equipment — espresso, drip tower, POS, cookie jar, cassette rack
// ---------------------------------------------------------------------------
function makeEspresso(group, x, z) {
  const chrome = material('espresso chrome', C.chrome, { metalness: 0.9, roughness: 0.22 });
  const chromeDark = material('espresso chrome dark', C.chromeDark, { metalness: 0.85, roughness: 0.3 });
  const black = material('espresso black', C.blackSoft, { roughness: 0.6 });
  box(group, [0.5, 0.05, 0.6], [x, 0.975, z], chromeDark, 'espresso base');
  box(group, [0.46, 0.26, 0.56], [x, 1.13, z], chrome, 'boxy chrome espresso machine');
  box(group, [0.4, 0.06, 0.5], [x, 1.29, z], chromeDark, 'cup warmer');
  // Digital-ish keypad facade on the customer (+x) side.
  const keyTex = makeCanvas(256, 128, (g, w, h) => {
    g.fillStyle = '#0c0f14';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3a414c';
    g.lineWidth = 4;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = '#53ff6e';
    g.shadowColor = '#53ff6e';
    g.shadowBlur = 8;
    g.font = 'bold 38px "Courier New", monospace';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillText('1.2', w - 20, 32);
    g.shadowBlur = 0;
    const keys = [[0, 0, 0, 1], [0, 0, 1, 0], [0, 1, 0, 0], [1, 0, 0, 0]];
    keys.forEach((row, r) => row.forEach((on, c) => {
      g.beginPath();
      g.fillStyle = on ? '#c0392b' : '#6b7280';
      g.arc(24 + c * 40, 62 + r * 17, 6, 0, Math.PI * 2);
      g.fill();
    }));
  });
  const keyPad = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.3), basicMat('espresso keypad', keyTex, { transparent: false }));
  keyPad.position.set(x + 0.235, 1.12, z);
  group.add(keyPad);
  // Group heads + portafilters low on the front.
  for (const dz of [-0.24, 0.24]) {
    cyl(group, 0.055, 0.09, [x + 0.18, 1.0, z + dz], chromeDark, 12, 'group head');
    cyl(group, 0.035, 0.1, [x + 0.24, 0.98, z + dz], black, 10, 'portafilter handle');
  }
  box(group, [0.3, 0.03, 0.5], [x + 0.08, 0.955, z], black, 'drip tray');
  const wand = cyl(group, 0.012, 0.2, [x - 0.16, 1.18, z + 0.26], chromeDark, 8, 'steam wand');
  wand.rotation.z = 0.5;
  cyl(group, 0.035, 0.02, [x - 0.14, 1.24, z - 0.22], material('gauge face', 0x10141a), 12, 'pressure gauge');
  cyl(group, 0.045, 0.05, [x - 0.1, 1.34, z + 0.12], material('cup brown', 0x4a2f1d), 10, 'warm cup');
  cyl(group, 0.045, 0.05, [x + 0.12, 1.34, z - 0.14], material('cup black', 0x1c1e22), 10, 'warm cup');
}

function makeDripTower(group, x, z) {
  const chrome = material('drip chrome', C.chrome, { metalness: 0.88, roughness: 0.25 });
  const glass = material('decanter glass', C.glass, { transparent: true, opacity: 0.5, roughness: 0.15 });
  const coffee = material('brewed coffee', C.coffee, { transparent: true, opacity: 0.85, roughness: 0.3 });
  box(group, [0.3, 0.1, 0.3], [x, 0.95, z], chrome, 'drip tower base');
  cyl(group, 0.045, 0.62, [x, 1.3, z], chrome, 10, 'drip tower column');
  const res = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.2, 12), glass);
  res.position.set(x, 1.62, z);
  group.add(res);
  cyl(group, 0.12, 0.16, [x, 1.62, z], coffee, 10, 'reservoir coffee');
  cyl(group, 0.05, 0.08, [x, 1.78, z], chrome, 10, 'reservoir lid');
  box(group, [0.03, 0.03, 0.5], [x, 1.42, z], chrome, 'brew arm');
  for (const dz of [-0.16, 0.16]) {
    cyl(group, 0.09, 0.03, [x, 0.975, z + dz], chrome, 12, 'warmer plate');
    cyl(group, 0.075, 0.015, [x, 0.99, z + dz], material('warmer glow', C.orange, { emissive: C.orange, emissiveIntensity: 1.6 }), 12, 'warmer element');
    cyl(group, 0.09, 0.24, [x, 1.11, z + dz], glass, 12, 'glass decanter');
    cyl(group, 0.075, 0.2, [x, 1.1, z + dz], coffee, 10, 'decanter coffee');
    cyl(group, 0.045, 0.03, [x, 1.24, z + dz], chrome, 10, 'decanter cap');
  }
}

function makePOS(group, x, z) {
  const body = material('pos body', 0x2a3038, { metalness: 0.4, roughness: 0.5 });
  const chrome = material('pos chrome', C.chrome, { metalness: 0.85, roughness: 0.25 });
  box(group, [0.34, 0.14, 0.42], [x, 1.04, z], body, 'early electronic POS');
  box(group, [0.36, 0.02, 0.44], [x, 1.12, z], chrome, 'POS chrome trim');
  // Green segment display on the rear top.
  const segTex = makeCanvas(256, 96, (g, w, h) => {
    g.fillStyle = '#06130a';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#0f3a1e';
    g.lineWidth = 3;
    g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = '#53ff6e';
    g.shadowColor = '#53ff6e';
    g.shadowBlur = 10;
    g.font = 'bold 54px "Courier New", monospace';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillText('12.50', w - 18, h / 2);
  });
  const segPanel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.02), basicMat('pos seg', segTex, { transparent: false }));
  segPanel.position.set(x, 1.19, z - 0.19);
  group.add(segPanel);
  // Chunky buttons on the top face.
  const btnCols = [0x53ff6e, 0xff4fa3, 0xffb02e, 0x9aa2ab, 0x9aa2ab, 0x9aa2ab, 0x9aa2ab, 0x9aa2ab, 0x9aa2ab, 0x9aa2ab, 0x9aa2ab, 0x9aa2ab];
  let bi = 0;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      box(group, [0.045, 0.03, 0.045], [x - 0.1 + c * 0.07, 1.135, z - 0.05 + r * 0.07], material(`pos btn ${bi}`, btnCols[bi++], { roughness: 0.5 }), 'POS chunky button');
    }
  }
  cyl(group, 0.045, 0.06, [x, 1.16, z + 0.16], material('receipt paper', 0xe8e2d2, { roughness: 0.9 }), 10, 'receipt roll');
  // Customer-facing dot-matrix display on a pole (+x toward customers).
  cyl(group, 0.012, 0.22, [x + 0.12, 1.1, z + 0.1], chrome, 8, 'display pole');
  const dmatTex = makeCanvas(256, 160, (g, w, h) => {
    g.fillStyle = '#041a06';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#53ff6e';
    g.shadowColor = '#53ff6e';
    g.shadowBlur = 10;
    g.font = 'bold 58px "Courier New", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('THANK', w / 2, 52);
    g.fillText('YOU', w / 2, 120);
    g.shadowBlur = 0;
    g.globalCompositeOperation = 'destination-out';
    for (let y = 0; y < h; y += 7) {
      for (let px = 0; px < w; px += 7) g.fillRect(px, y, 3, 3);
    }
    g.globalCompositeOperation = 'source-over';
  });
  const dmat = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.04), basicMat('pos dotmatrix', dmatTex, { transparent: false }));
  dmat.position.set(x + 0.2, 1.24, z + 0.1);
  dmat.rotation.y = Math.PI / 2;
  group.add(dmat);
}

function makeCookieJar(group, x, z) {
  const glass = material('jar glass', C.glass, { transparent: true, opacity: 0.42, roughness: 0.12 });
  cyl(group, 0.14, 0.2, [x, 1.06, z], glass, 14, 'glass cookie jar');
  for (let i = 0; i < 4; i++) {
    cyl(group, 0.045, 0.028, [x - 0.05 + (i % 2) * 0.1, 1.02, z - 0.04 + Math.floor(i / 2) * 0.08], material('cookie', 0xb07a3e), 10);
  }
  cyl(group, 0.145, 0.035, [x, 1.18, z], material('jar lid', C.chrome, { metalness: 0.85, roughness: 0.25 }), 14, 'chrome jar lid');
}

function makeCassetteRack(group, x, z) {
  const chrome = material('rack chrome', C.chrome, { metalness: 0.8, roughness: 0.3 });
  box(group, [0.22, 0.12, 0.14], [x, 1.0, z], chrome, 'cassette sales rack');
  const colors = [0xff4fa3, 0x2ee6d6, 0xffb02e, 0x9aa2ab];
  const names = ['MIX 85', 'HOT 100', 'NEW WAVE', 'LO-FI'];
  colors.forEach((col, i) => {
    const labelTex = makeCanvas(64, 96, (g, w, h) => {
      g.fillStyle = `#${col.toString(16).padStart(6, '0')}`;
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      g.font = 'bold 13px monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(names[i], w / 2, h / 2);
    });
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.1, 0.07), basicMat(`tape ${i}`, labelTex, { transparent: false }));
    tape.position.set(x - 0.06 + i * 0.045, 1.07, z);
    group.add(tape);
  });
}

function makeCounterItems(group) {
  makeEspresso(group, -3.05, -1.35);
  makeDripTower(group, -3.2, -0.45);
  makePOS(group, -2.74, 0.55);
  makeCookieJar(group, -2.95, 1.15);
  makeCassetteRack(group, -3.25, 1.6);
}

// ---------------------------------------------------------------------------
// Boombox on a back-wall shelf — the era's music centerpiece
// ---------------------------------------------------------------------------
function makeBoombox(group, x, y, z) {
  const silver = material('boombox silver', C.chrome, { metalness: 0.85, roughness: 0.28 });
  const dark = material('boombox dark', 0x2a2e34, { roughness: 0.6 });
  const g = new THREE.Group();
  g.position.set(x, y, z);
  group.add(g);
  box(g, [0.62, 0.26, 0.18], [0, 0.13, 0], silver, 'silver twin-cassette boombox');
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 6, 14, Math.PI), dark);
  handle.position.set(0, 0.29, 0);
  handle.rotation.z = Math.PI;
  g.add(handle);
  const frontTex = makeCanvas(512, 256, (g2, w, h) => {
    g2.fillStyle = '#2a2e34';
    g2.fillRect(0, 0, w, h);
    g2.fillStyle = '#0d0f13';
    g2.fillRect(24, 40, 96, 64);
    g2.fillRect(392, 40, 96, 64);
    g2.fillStyle = '#3a3f47';
    g2.fillRect(36, 52, 72, 40);
    g2.fillRect(404, 52, 72, 40);
    for (let i = 0; i < 2; i++) {
      const vx = 150 + i * 110;
      g2.fillStyle = '#0d0f13';
      g2.fillRect(vx, 40, 90, 60);
      for (let s = 0; s < 8; s++) {
        g2.fillStyle = s < 6 ? '#53ff6e' : '#ff4fa3';
        g2.fillRect(vx + 6 + s * 10, 46 + (s % 2) * 8, 6, 18);
      }
      g2.fillStyle = '#e8e2d2';
      g2.fillRect(vx + 6, 70, 78, 4);
    }
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? 24 : 312;
      g2.fillStyle = '#0d0f13';
      g2.beginPath();
      g2.arc(sx + 60, 170, 52, 0, Math.PI * 2);
      g2.fill();
      g2.strokeStyle = '#4a5058';
      g2.lineWidth = 2;
      for (let r = 8; r < 52; r += 8) {
        g2.beginPath();
        g2.arc(sx + 60, 170, r, 0, Math.PI * 2);
        g2.stroke();
      }
    }
    g2.fillStyle = '#e8e2d2';
    g2.font = 'bold 22px monospace';
    g2.textAlign = 'center';
    g2.fillText('DOLBY', 256, 26);
  });
  const front = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.24, 0.02), basicMat('boombox front', frontTex, { transparent: false }));
  front.position.set(0, 0.13, 0.095);
  g.add(front);
  const antenna = cyl(g, 0.006, 0.55, [-0.24, 0.42, 0.02], silver, 6, 'boombox antenna');
  antenna.rotation.z = -0.35;
  // Cassette tape lying on top.
  box(g, [0.09, 0.012, 0.06], [0.18, 0.275, 0.04], material('tape shell', 0x14161a), 'cassette tape');
}

function makeBoomboxShelf(group) {
  const shelf = box(group, [0.5, 0.04, 0.22], [1.8, 1.24, -2.4], material('shelf chrome', C.chrome, { metalness: 0.8, roughness: 0.3 }), 'boombox shelf');
  box(group, [0.05, 0.6, 0.05], [1.6, 0.94, -2.42], material('shelf bracket', C.chromeDark, { metalness: 0.7 }), 'shelf bracket');
  box(group, [0.05, 0.6, 0.05], [2.0, 0.94, -2.42], material('shelf bracket', C.chromeDark, { metalness: 0.7 }), 'shelf bracket');
  makeBoombox(group, 1.8, 1.3, -2.38);
}

// ---------------------------------------------------------------------------
// Tables, chairs, tableware
// ---------------------------------------------------------------------------
function makeTable(group, x, z, opts = {}) {
  const topMat = material('laminate top', C.laminate, { roughness: 0.35, metalness: 0.25 });
  const edgeMat = material('chrome edge', C.laminateEdge, { metalness: 0.85, roughness: 0.25 });
  const legMat = material('chrome leg', C.chrome, { metalness: 0.9, roughness: 0.2 });
  box(group, [1.15, 0.05, 0.7], [x, 0.88, z], topMat, 'black laminate table');
  box(group, [1.19, 0.03, 0.74], [x, 0.855, z], edgeMat, 'chrome table edge');
  const legs = [[-0.5, -0.28], [0.5, -0.28], [-0.5, 0.28], [0.5, 0.28]];
  for (const [dx, dz] of legs) {
    cyl(group, 0.028, 0.84, [x + dx, 0.43, z + dz], legMat, 8, 'tubular chrome leg');
  }
  // Tableware.
  mug(group, x - 0.28, 0.94, z - 0.12, '#3a2416');
  mug(group, x + 0.28, 0.94, z + 0.14, '#17181c');
  sugarDispenser(group, x - 0.05, 0.945, z - 0.2);
  teabagCaddy(group, x + 0.05, 0.945, z + 0.24);
  numberStand(group, x + 0.32, 0.955, z - 0.22, opts.number || 7);
  if (opts.rubiks) rubiksCube(group, x - 0.3, 0.93, z + 0.22);
}

function mug(group, x, y, z, colorHex) {
  const ceramic = material(`mug ${colorHex}`, Number.parseInt(colorHex.slice(1), 16), { roughness: 0.55 });
  cyl(group, 0.05, 0.085, [x, y + 0.05, z], ceramic, 12, 'ceramic mug');
  cyl(group, 0.055, 0.012, [x, y + 0.006, z], material('saucer', 0x2b2e33, { roughness: 0.5 }), 12, 'saucer');
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.01, 6, 10, Math.PI), ceramic);
  handle.position.set(x + 0.05, y + 0.06, z);
  handle.rotation.x = Math.PI / 2;
  group.add(handle);
  cyl(group, 0.038, 0.02, [x, y + 0.095, z], material('coffee surface', C.coffee), 10);
}

function sugarDispenser(group, x, y, z) {
  const body = material('dispenser body', 0x2c3038, { transparent: true, opacity: 0.7, roughness: 0.3 });
  box(group, [0.14, 0.16, 0.09], [x, y + 0.08, z], body, 'sugar packet dispenser');
  box(group, [0.05, 0.02, 0.1], [x, y + 0.17, z], material('dispenser cap', C.chromeDark, { metalness: 0.7 }), 'dispenser cap');
  for (let i = 0; i < 3; i++) {
    box(group, [0.05, 0.06, 0.005], [x - 0.026 + i * 0.026, y + 0.08, z + 0.048], material(`sugar packet ${i}`, 0xe8e2d2), 'sugar packet');
  }
}

function teabagCaddy(group, x, y, z) {
  box(group, [0.16, 0.09, 0.12], [x, y + 0.045, z], material('tea caddy', 0x3a2a1c, { roughness: 0.85 }), 'teabag caddy');
  const tagTex = makeCanvas(64, 64, (g, w, h) => {
    g.fillStyle = '#a5713d';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2e9d8';
    g.font = 'bold 26px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('TEA', w / 2, h / 2);
  });
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.05), basicMat('tea tag', tagTex, { transparent: false }));
  tag.position.set(x + 0.04, y + 0.1, z + 0.07);
  group.add(tag);
}

function numberStand(group, x, y, z, number) {
  const base = cyl(group, 0.04, 0.012, [x, y, z], material('stand base', C.chromeDark, { metalness: 0.8 }), 10, 'number stand base');
  cyl(group, 0.008, 0.09, [x, y + 0.05, z], material('stand stem', C.chrome, { metalness: 0.8 }), 8, 'number stand stem');
  const numTex = makeCanvas(128, 128, (g, w, h) => {
    g.fillStyle = '#101318';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#53ff6e';
    g.font = 'bold 76px "Courier New", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(number), w / 2, h / 2);
  });
  const card = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.07), basicMat(`number card ${number}`, numTex, { transparent: false }));
  card.position.set(x, y + 0.11, z);
  card.rotation.y = Math.PI / 2;
  group.add(card);
}

function rubiksCube(group, x, y, z) {
  const colors = [0xff4fa3, 0x2ee6d6, 0xffb02e, 0x53ff6e, 0xffffff, 0xff7a2f];
  const g = new THREE.Group();
  g.position.set(x, y, z);
  group.add(g);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) {
        const col = colors[(i + j + k) % colors.length];
        const c = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), material(`rubik ${col}`, col, { roughness: 0.4 }));
        c.position.set((i - 1) * 0.033, (j - 1) * 0.033, (k - 1) * 0.033);
        g.add(c);
      }
    }
  }
}

function makeChair(group, x, z, rotation = 0) {
  const chair = new THREE.Group();
  chair.position.set(x, 0, z);
  chair.rotation.y = rotation;
  group.add(chair);
  const vinyl = material('black vinyl', C.vinyl, { roughness: 0.75 });
  const chrome = material('chair chrome', C.chrome, { metalness: 0.9, roughness: 0.2 });
  box(chair, [0.44, 0.08, 0.44], [0, 0.52, 0], vinyl, 'black vinyl cafe chair seat');
  for (const dx of [-0.17, 0.17]) {
    for (const dz of [-0.17, 0.17]) {
      cyl(chair, 0.02, 0.52, [dx, 0.27, dz], chrome, 8, 'chrome chair leg');
    }
  }
  box(chair, [0.44, 0.62, 0.06], [0, 0.87, -0.2], vinyl, 'chair back');
  for (let i = -1; i <= 1; i++) {
    box(chair, [0.36, 0.02, 0.02], [0, 0.72 + i * 0.13, -0.225], chrome, 'chair back slat');
  }
}

// ---------------------------------------------------------------------------
// Patrons — five 80s figures
// ---------------------------------------------------------------------------
function patron(group, x, z, opts = {}) {
  const p = new THREE.Group();
  p.position.set(x, 0, z);
  group.add(p);
  const jacket = material(`jacket ${opts.jacket}`, opts.jacket || 0x2b3a67, { roughness: 0.85 });
  const shirt = material(`shirt ${opts.shirt}`, opts.shirt || 0xe8e2d2, { roughness: 0.9 });
  const pants = material(`pants ${opts.pants}`, opts.pants || 0x2a2e34, { roughness: 0.9 });
  const skin = material('skin', C.skin, { roughness: 0.8 });
  const sneaker = material('sneaker', 0xe8e2d2, { roughness: 0.6 });
  const sneakerStripe = material('sneaker stripe', opts.sneakerStripe || 0xff4fa3, { roughness: 0.5 });

  // Legs.
  cyl(p, 0.07, 0.42, [-0.09, 0.21, 0], pants, 8, 'leg');
  cyl(p, 0.07, 0.42, [0.09, 0.21, 0], pants, 8, 'leg');
  if (opts.legwarmers) {
    const warm = material('legwarmers', opts.legwarmers, { roughness: 0.95 });
    cyl(p, 0.082, 0.2, [-0.09, 0.12, 0], warm, 8, 'legwarmer');
    cyl(p, 0.082, 0.2, [0.09, 0.12, 0], warm, 8, 'legwarmer');
  }
  // High-top sneakers.
  if (opts.sneakers !== false) {
    box(p, [0.12, 0.09, 0.24], [-0.09, 0.045, 0.05], sneaker, 'high-top sneaker');
    box(p, [0.12, 0.09, 0.24], [0.09, 0.045, 0.05], sneaker, 'high-top sneaker');
    box(p, [0.125, 0.02, 0.26], [-0.09, 0.1, 0.05], sneakerStripe, 'sneaker stripe');
    box(p, [0.125, 0.02, 0.26], [0.09, 0.1, 0.05], sneakerStripe, 'sneaker stripe');
  } else {
    box(p, [0.11, 0.05, 0.22], [-0.09, 0.03, 0.04], material('shoe', 0x1c1e22), 'shoe');
    box(p, [0.11, 0.05, 0.22], [0.09, 0.03, 0.04], material('shoe', 0x1c1e22), 'shoe');
  }
  // Torso — Members-Only jacket with optional shoulder pads.
  const torsoW = opts.shoulderPads ? 0.5 : 0.42;
  box(p, [torsoW, 0.5, 0.28], [0, 0.68, 0], jacket, 'Members-Only jacket');
  box(p, [torsoW - 0.08, 0.16, 0.2], [0, 0.78, 0.09], shirt, 'shirt collar');
  // Rolled sleeves: lighter cuff blocks on the upper arms.
  if (opts.rolledSleeves) {
    box(p, [0.1, 0.18, 0.14], [-torsoW / 2 - 0.02, 0.62, 0], material('rolled cuff', opts.rolledSleeves, { roughness: 0.85 }), 'rolled sleeve');
    box(p, [0.1, 0.18, 0.14], [torsoW / 2 + 0.02, 0.62, 0], material('rolled cuff', opts.rolledSleeves, { roughness: 0.85 }), 'rolled sleeve');
  }
  // Head + 80s hair.
  cyl(p, 0.11, 0.16, [0, 1.0, 0], skin, 10, 'head');
  const hairCol = opts.hairColor || C.hairDark;
  if (opts.hair === 'feather') {
    cyl(p, 0.16, 0.2, [0, 1.09, 0], material('feathered hair', hairCol, { roughness: 0.95 }), 12, 'feathered hair');
    cyl(p, 0.13, 0.1, [0, 1.2, 0], material('feathered hair top', hairCol, { roughness: 0.95 }), 12);
  } else {
    cyl(p, 0.15, 0.22, [0, 1.1, 0], material('perm hair', hairCol, { roughness: 0.95 }), 12, 'big permed hair');
  }
  // Accessories.
  if (opts.walkman) {
    box(p, [0.06, 0.09, 0.03], [-0.14, 0.58, 0.1], material('walkman', 0x3a3f47, { metalness: 0.5 }), 'Walkman on belt');
    const phones = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.014, 6, 16), material('headphones', 0x1c1e22));
    phones.position.set(0, 1.06, 0.05);
    phones.rotation.x = Math.PI / 2;
    p.add(phones);
    box(p, [0.05, 0.03, 0.05], [-0.12, 1.12, 0.1], material('headphone pad', 0x14161a), 'headphone pad');
    box(p, [0.05, 0.03, 0.05], [0.12, 1.12, 0.1], material('headphone pad', 0x14161a), 'headphone pad');
  }
  if (opts.pager) {
    box(p, [0.05, 0.08, 0.02], [0.16, 0.6, 0.12], material('pager', 0x14161a), 'pager on belt');
    const pagerTex = makeCanvas(64, 96, (g, w, h) => {
      g.fillStyle = '#14161a';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#53ff6e';
      g.font = 'bold 20px monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('85', w / 2, h / 2);
    });
    const pagerScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.06), basicMat('pager screen', pagerTex, { transparent: false }));
    pagerScreen.position.set(0.16, 0.6, 0.135);
    pagerScreen.rotation.y = Math.PI / 2;
    p.add(pagerScreen);
  }
  if (opts.polaroid) {
    box(p, [0.07, 0.09, 0.1], [0.22, 0.52, 0.12], material('polaroid body', 0x1c1e22, { roughness: 0.6 }), 'Polaroid camera');
    cyl(p, 0.025, 0.03, [0.22, 0.56, 0.18], material('polaroid lens', 0x0d0f13), 10, 'Polaroid lens');
    box(p, [0.02, 0.03, 0.05], [0.26, 0.58, 0.12], material('flash', 0xe8e2d2), 'flash');
  }
  if (opts.newspaper) {
    const paper = spriteText('THE DAILY TRIBUNE\nCOFFEE PRICES RISE', 0.4, 0.3, { bg: '#e5dcc4', color: '#30271e', font: 'bold 24px serif' });
    paper.position.set(0.05, 0.92, 0.24);
    paper.rotation.x = -0.2;
    p.add(paper);
  }
  return p;
}

function makePatrons(group) {
  // Patron 1 — table A, Walkman + headphones, perm, navy Members-Only.
  patron(group, -1.0, -0.05, {
    jacket: 0x2b3a67, shirt: 0xe8e2d2, pants: 0x2a2e34, rolledSleeves: 0x4a5d9e,
    hair: 'perm', walkman: true, sneakerStripe: 0xff4fa3,
  });
  // Patron 2 — table B, shoulder pads + legwarmers, feathered hair.
  patron(group, 1.4, 0.15, {
    jacket: 0x8e2f5a, shirt: 0xf2e9d8, pants: 0x1c1e22, shoulderPads: true,
    legwarmers: 0xff4fa3, hair: 'feather', hairColor: C.hairBlond, sneakerStripe: 0x2ee6d6,
  });
  // Patron 3 — standing by the counter, reading a folded newspaper.
  patron(group, -2.15, 0.7, {
    jacket: 0x8e2f3c, shirt: 0xd8cfc0, pants: 0x3a3f47, rolledSleeves: 0xb04a52,
    hair: 'perm', newspaper: true, sneakerStripe: 0xffb02e,
  });
  // Patron 4 — table A east seat, pager on belt, teal polo.
  patron(group, -0.35, -0.7, {
    jacket: 0x1d5f5c, shirt: 0xe8e2d2, pants: 0x2a2e34, pager: true,
    hair: 'perm', hairColor: 0x4a2f1d, sneakerStripe: 0x53ff6e,
  });
  // Patron 5 — near the arcade, Polaroid in hand.
  patron(group, 2.35, -1.35, {
    jacket: 0x14161a, shirt: 0x53ff6e, pants: 0x2a2e34, rolledSleeves: 0x2a2e34,
    hair: 'feather', hairColor: C.hairDark, polaroid: true, sneakerStripe: 0x2ee6d6,
  });
}

// ---------------------------------------------------------------------------
// Wall dress — mirror, mural, neon, menu, boards, posters, plants
// ---------------------------------------------------------------------------
function makeMirroredPanel(group) {
  const mirror = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 2.1, 1.5),
    material('mirrored wall panel', 0xb9c4cc, { metalness: 1.0, roughness: 0.08 })
  );
  mirror.position.set(3.47, 1.35, 0.2);
  group.add(mirror);
  box(group, [0.05, 2.2, 1.6], [3.44, 1.35, 0.2], material('mirror chrome frame', C.chrome, { metalness: 0.85, roughness: 0.3 }), 'mirror frame');
  // Teal neon strip along the mirror top.
  box(group, [0.02, 0.04, 1.7], [3.46, 2.45, 0.2], material('teal neon strip', 0x0a1a18, { emissive: C.teal, emissiveIntensity: 2.6 }), 'teal neon strip');
}

function makeMemphisMural(group) {
  const tex = makeCanvas(1024, 512, (g, w, h) => {
    g.fillStyle = '#15121c';
    g.fillRect(0, 0, w, h);
    const squiggle = (color, x0, y0, amp, len, lw) => {
      g.strokeStyle = color;
      g.lineWidth = lw;
      g.beginPath();
      for (let x = 0; x <= len; x += 8) {
        const y = y0 + Math.sin((x / len) * Math.PI * 4) * amp;
        if (x === 0) g.moveTo(x0 + x, y);
        else g.lineTo(x0 + x, y);
      }
      g.stroke();
    };
    squiggle('#ff4fa3', 60, 120, 26, 380, 14);
    squiggle('#2ee6d6', 60, 260, 30, 420, 12);
    squiggle('#ffb02e', 60, 400, 22, 330, 12);
    g.fillStyle = '#ff4fa3';
    g.beginPath(); g.arc(560, 140, 46, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2ee6d6';
    g.beginPath(); g.arc(700, 320, 30, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffb02e';
    g.beginPath(); g.arc(820, 120, 22, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(640, 260, 12, 0, Math.PI * 2); g.fill();
    // Memphis triangles + zigzag.
    g.fillStyle = '#ff4fa3';
    g.beginPath(); g.moveTo(880, 380); g.lineTo(960, 380); g.lineTo(920, 300); g.closePath(); g.fill();
    g.strokeStyle = '#2ee6d6';
    g.lineWidth = 10;
    g.beginPath();
    for (let i = 0; i <= 6; i++) {
      const x = 500 + i * 70;
      const y = i % 2 === 0 ? 420 : 360;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    // Dotted grid.
    g.fillStyle = 'rgba(255,255,255,0.5)';
    for (let y = 60; y < 460; y += 60) {
      for (let x = 60; x < 980; x += 60) {
        if ((x + y) % 120 === 0) g.fillRect(x, y, 4, 4);
      }
    }
  });
  const mural = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.85), basicMat('memphis mural', tex, { transparent: false }));
  mural.position.set(0.5, 2.15, -2.44);
  group.add(mural);
}

function makeMenuLightbox(group) {
  const tex = makeCanvas(1024, 512, (g, w, h) => {
    g.fillStyle = '#1b1430';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffb02e';
    g.lineWidth = 14;
    g.strokeRect(20, 20, w - 40, h - 40);
    g.fillStyle = '#ffb02e';
    g.font = 'bold 76px "Courier New", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('CAFE 85', w / 2, 76);
    const items = [
      ['FRESH COFFEE', '55¢'],
      ['ESPRESSO ★ NEW', '75¢'],
      ['CAPPUCCINO ★ NEW', '85¢'],
      ['CROISSANT', '65¢'],
      ['BAGEL', '50¢'],
    ];
    items.forEach(([name, price], i) => {
      const y = 168 + i * 62;
      g.fillStyle = '#ffb02e';
      g.font = 'bold 46px "Courier New", monospace';
      g.textAlign = 'left';
      g.fillText(name, 70, y);
      g.textAlign = 'right';
      g.fillText(price, w - 70, y);
      g.strokeStyle = 'rgba(255,176,46,0.4)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(430, y + 16);
      g.lineTo(w - 170, y + 16);
      g.stroke();
    });
  });
  // Backlit box.
  box(group, [1.5, 0.78, 0.1], [-1.5, 2.05, -2.42], material('lightbox housing', 0x0c0f14, { roughness: 0.6 }), 'lightbox menu housing');
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.7), basicMat('lightbox menu', tex, { transparent: false }));
  face.position.set(-1.5, 2.05, -2.36);
  group.add(face);
  box(group, [1.5, 0.78, 0.04], [-1.5, 2.05, -2.44], material('lightbox back', 0x0c0f14), 'lightbox back');
}

function makeCoffeeTalkBoard(group) {
  const tex = makeCanvas(512, 384, (g, w, h) => {
    g.fillStyle = '#a5763f';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#6b4a26';
    g.lineWidth = 8;
    g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#f2e9d8';
    g.font = 'bold 40px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('COFFEE TALK', w / 2, 48);
    const cards = [
      ['#ff4fa3', 60, 100], ['#2ee6d6', 220, 120], ['#ffb02e', 90, 240],
      ['#53ff6e', 300, 250], ['#9aa2ab', 340, 90], ['#ff7a2f', 180, 300],
    ];
    cards.forEach(([col, cx, cy]) => {
      g.fillStyle = col;
      g.fillRect(cx, cy, 110, 74);
      g.fillStyle = '#101318';
      g.beginPath();
      g.arc(cx + 55, cy + 37, 5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(16,19,24,0.8)';
      g.font = 'bold 18px monospace';
      g.fillText('PIN', cx + 55, cy + 40);
    });
  });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.68), basicMat('coffee talk board', tex, { transparent: false }));
  board.position.set(3.45, 1.6, -0.4);
  board.rotation.y = -Math.PI / 2;
  group.add(board);
}

function makePosters(group) {
  const flyer1 = wallText('LIVE TONIGHT\nTHE NEON KIDS', 0.62, 0.42, {
    bg: '#ff4fa3', border: '#ffd23f', color: '#1b1430', font: 'bold 34px "Courier New", monospace', lineH: 60, name: 'poster1',
  });
  flyer1.position.set(-3.44, 2.2, -0.7);
  flyer1.rotation.y = Math.PI / 2;
  group.add(flyer1);

  const flyer2 = wallText('ROCK 85\nGIG TONIGHT', 0.58, 0.4, {
    bg: '#2ee6d6', border: '#ff4fa3', color: '#0c1a18', font: 'bold 34px "Courier New", monospace', lineH: 60, name: 'poster2',
  });
  flyer2.position.set(-3.44, 1.7, 0.45);
  flyer2.rotation.y = Math.PI / 2;
  group.add(flyer2);

  const flyer3 = wallText('GRAND\nOPENING', 0.5, 0.36, {
    bg: '#ffb02e', border: '#1b1430', color: '#1b1430', font: 'bold 36px "Courier New", monospace', lineH: 58, name: 'poster3',
  });
  flyer3.position.set(3.45, 2.35, 1.4);
  flyer3.rotation.y = -Math.PI / 2;
  group.add(flyer3);
}

function makeEotmPhoto(group) {
  const tex = makeCanvas(256, 320, (g, w, h) => {
    g.fillStyle = '#d8cfc0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#b9c4cc';
    g.fillRect(24, 24, w - 48, h - 120);
    g.fillStyle = '#2b3a67';
    g.fillRect(96, 90, 64, 90);
    g.fillStyle = '#c98d6f';
    g.beginPath(); g.arc(128, 70, 22, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#4a2f1d';
    g.beginPath(); g.arc(128, 60, 26, Math.PI, 0); g.fill();
    g.fillStyle = '#1b1430';
    g.font = 'bold 26px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('EMPLOYEE', w / 2, h - 70);
    g.fillText('OF THE', w / 2, h - 40);
    g.fillText('MONTH', w / 2, h - 10);
  });
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.5), basicMat('eotm photo', tex, { transparent: false }));
  photo.position.set(-1.45, 2.25, -2.44);
  group.add(photo);
  box(group, [0.44, 0.54, 0.03], [-1.45, 2.25, -2.45], material('photo frame', C.chromeDark, { metalness: 0.7 }), 'eotm frame');
}

function makeRubberPlant(group, x, z, scale = 1) {
  const pot = cyl(group, 0.16 * scale, 0.22 * scale, [x, 0.11 * scale, z], material('plant pot', C.terracotta, { roughness: 0.8 }), 10, 'rubber plant pot');
  cyl(group, 0.02 * scale, 0.4 * scale, [x, 0.32 * scale, z], material('plant trunk', 0x2c1d14, { roughness: 0.95 }), 6, 'plant trunk');
  const leafMat = material('rubber leaf', C.leaf, { roughness: 0.85 });
  const leafMat2 = material('rubber leaf light', C.leafLight, { roughness: 0.85 });
  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.16 * scale, 8, 6), i % 2 ? leafMat : leafMat2);
    leaf.scale.set(1, 0.32, 0.6);
    const ang = (i / 7) * Math.PI * 2;
    leaf.position.set(x + Math.cos(ang) * 0.14 * scale, 0.55 * scale + Math.sin(i * 1.3) * 0.1 * scale, z + Math.sin(ang) * 0.14 * scale);
    leaf.rotation.z = Math.cos(ang) * 0.5;
    leaf.rotation.x = Math.sin(ang) * 0.5;
    group.add(leaf);
  }
  for (let i = 0; i < 4; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.12 * scale, 8, 6), i % 2 ? leafMat : leafMat2);
    leaf.scale.set(1, 0.3, 0.55);
    const ang = (i / 4) * Math.PI * 2 + 0.4;
    leaf.position.set(x + Math.cos(ang) * 0.1 * scale, 0.85 * scale, z + Math.sin(ang) * 0.1 * scale);
    leaf.rotation.z = Math.cos(ang) * 0.7;
    group.add(leaf);
  }
}

function makeArcadeCorner(group) {
  // Arcade cabinet against the back-right corner.
  const cab = new THREE.Group();
  cab.position.set(2.85, 0, -2.2);
  group.add(cab);
  box(cab, [0.55, 1.15, 0.6], [0, 0.62, 0], material('arcade cabinet', 0x14161a, { roughness: 0.6 }), 'arcade cabinet');
  box(cab, [0.59, 0.06, 0.64], [0, 1.2, 0], material('arcade marquee', 0x0c0f14, { roughness: 0.5 }), 'arcade marquee');
  const marqueeTex = makeCanvas(256, 64, (g, w, h) => {
    g.fillStyle = '#1b1430';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff4fa3';
    g.font = 'bold 30px "Courier New", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('NEON BLASTER', w / 2, h / 2);
  });
  const marquee = new THREE.Mesh(new THREE.PlaneGeometry(0.53, 0.13), basicMat('arcade marquee face', marqueeTex, { transparent: false }));
  marquee.position.set(0, 1.2, 0.305);
  group.add(marquee);
  const screenTex = makeCanvas(256, 256, (g, w, h) => {
    g.fillStyle = '#05070c';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.fillStyle = '#ff4fa3';
    g.beginPath(); g.moveTo(128, 40); g.lineTo(112, 80); g.lineTo(144, 80); g.closePath(); g.fill();
    g.fillStyle = '#2ee6d6';
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 6; c++) {
        g.fillRect(40 + c * 34, 90 + r * 34, 18, 14);
      }
    }
    g.fillStyle = '#ffb02e';
    g.font = 'bold 22px "Courier New", monospace';
    g.textAlign = 'center';
    g.fillText('READY', w / 2, 210);
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), basicMat('arcade screen', screenTex, { transparent: false }));
  screen.position.set(0, 0.78, 0.305);
  group.add(screen);
  box(cab, [0.5, 0.08, 0.16], [0, 0.42, 0.24], material('control panel', 0x1d2128, { roughness: 0.5 }), 'control panel');
  for (let i = 0; i < 2; i++) {
    cyl(cab, 0.022, 0.03, [-0.1 + i * 0.2, 0.45, 0.3], material('joystick', 0xff4fa3, { roughness: 0.4 }), 8, 'joystick');
  }
  // CRT TV on a chrome stand, playing static.
  const tv = new THREE.Group();
  tv.position.set(1.0, 0, -2.2);
  group.add(tv);
  cyl(tv, 0.02, 0.7, [-0.2, 0.4, 0], material('tv leg', C.chrome, { metalness: 0.8 }), 8, 'TV stand leg');
  cyl(tv, 0.02, 0.7, [0.2, 0.4, 0], material('tv leg', C.chrome, { metalness: 0.8 }), 8, 'TV stand leg');
  box(tv, [0.5, 0.4, 0.42], [0, 0.95, 0], material('CRT TV body', 0x2a2e34, { roughness: 0.6 }), 'CRT TV');
  box(tv, [0.46, 0.34, 0.04], [0, 0.98, 0.22], material('tv bezel', 0x14161a), 'TV bezel');
  const staticTex = makeCanvas(128, 96, (g, w, h) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = Math.random();
        g.fillStyle = v > 0.72 ? '#c8d2d8' : v > 0.45 ? '#5a6a72' : '#1c242a';
        g.fillRect(x, y, 1, 1);
      }
    }
  });
  const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), basicMat('tv static', staticTex, { transparent: false }));
  tvScreen.position.set(0, 0.98, 0.24);
  group.add(tvScreen);
}

function makeWallDress(group) {
  makeMirroredPanel(group);
  makeMemphisMural(group);
  makeMenuLightbox(group);
  makeCoffeeTalkBoard(group);
  makePosters(group);
  makeEotmPhoto(group);
  // Pink neon strip along the counter front edge.
  box(group, [0.02, 0.03, 3.8], [-2.5, 0.94, 0], material('counter neon', 0x1a0a12, { emissive: C.pink, emissiveIntensity: 2.4 }), 'pink counter neon strip');
  // Teal neon strip along the back wall header.
  box(group, [3.2, 0.03, 0.03], [0.6, 2.72, -2.45], material('back wall neon', 0x0a1a18, { emissive: C.teal, emissiveIntensity: 2.4 }), 'teal back wall neon strip');
  // Rubber plants.
  makeRubberPlant(group, 1.6, 2.0, 1.1);
  makeRubberPlant(group, 3.15, -0.6, 0.9);
  makeRubberPlant(group, -0.7, 2.2, 1.0);
}

// ---------------------------------------------------------------------------
// Track lighting + neon point lights
// ---------------------------------------------------------------------------
function makeLights(group) {
  // Track lighting: two ceiling tracks with spot heads.
  const track = material('track rail', C.chromeDark, { metalness: 0.8, roughness: 0.3 });
  box(group, [2.6, 0.05, 0.08], [0.4, 2.94, 0], track, 'track light rail');
  const spots = [[-0.7, 0.6], [0.2, -0.4], [1.1, 0.8], [1.6, -1.2]];
  spots.forEach(([sx, sz], i) => {
    const head = box(group, [0.1, 0.07, 0.12], [sx, 2.88, sz], material(`spot head ${i}`, 0x1d2128, { roughness: 0.5 }), 'track spot head');
    const light = new THREE.PointLight(0xffe6c4, 1.1, 4.2, 2);
    light.position.set(sx, 2.8, sz);
    group.add(light);
  });
  // Second track over the counter.
  box(group, [0.08, 0.05, 2.6], [-2.3, 2.94, 0.2], track, 'counter track rail');
  for (const sz of [-1.0, 0.2, 1.3]) {
    box(group, [0.12, 0.07, 0.1], [-2.3, 2.88, sz], material('counter spot', 0x1d2128, { roughness: 0.5 }), 'counter spot head');
    const light = new THREE.PointLight(0xffe6c4, 1.0, 3.6, 2);
    light.position.set(-2.3, 2.8, sz);
    group.add(light);
  }
  // Neon glow accents.
  const pinkGlow = new THREE.PointLight(C.pink, 1.4, 3.2, 2);
  pinkGlow.position.set(-2.4, 1.1, 0);
  group.add(pinkGlow);
  const tealGlow = new THREE.PointLight(C.teal, 1.2, 3.4, 2);
  tealGlow.position.set(3.4, 2.3, 0.2);
  group.add(tealGlow);
  const amberGlow = new THREE.PointLight(C.amber, 1.6, 2.6, 2);
  amberGlow.position.set(-1.5, 2.1, -2.1);
  group.add(amberGlow);
  const arcadeGlow = new THREE.PointLight(0x9a5bff, 1.0, 3.0, 2);
  arcadeGlow.position.set(2.8, 1.4, -1.6);
  group.add(arcadeGlow);
}

// ---------------------------------------------------------------------------
// Era module
// ---------------------------------------------------------------------------
function buildTablesAndChairs(group) {
  makeTable(group, -1.0, -0.7, { number: 7 });
  makeTable(group, 1.4, 0.8, { number: 12, rubiks: true });
  makeTable(group, 1.2, 1.85, { number: 4 });
  makeChair(group, -1.0, -0.1, 0);
  makeChair(group, -1.0, -1.3, Math.PI);
  makeChair(group, -0.35, -0.7, -Math.PI / 2);
  makeChair(group, -1.65, -0.7, Math.PI / 2);
  makeChair(group, 1.4, 0.2, 0);
  makeChair(group, 1.4, 1.4, Math.PI);
  makeChair(group, 0.75, 0.8, -Math.PI / 2);
  makeChair(group, 2.05, 0.8, Math.PI / 2);
  makeChair(group, 1.2, 1.35, 0);
  makeChair(group, 1.2, 2.35, Math.PI);
}

export const era1985 = {
  id: 'neon-1985',
  label: '1985 · Neon Café',
  year: 1985,
  hudText: '1985 · NEON CAFÉ',
  assets: [],
  build(ctx) {
    const group = new THREE.Group();
    group.name = 'neon-cafe-interior';
    makeFloor(group);
    makeCounterItems(group);
    makeBoomboxShelf(group);
    buildTablesAndChairs(group);
    makePatrons(group);
    makeWallDress(group);
    makeArcadeCorner(group);
    makeLights(group);
    return group;
  },
  enter(ctx) {
    ctx.scene.fog = new THREE.Fog(0x0e0a14, 5, 12);
  },
  exit(ctx) {
    if (ctx.scene.fog) ctx.scene.fog = null;
  },
};

export default era1985;