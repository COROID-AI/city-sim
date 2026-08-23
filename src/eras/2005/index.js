/**
 * 2005 early-Wi-Fi café.  Low-poly procedural scenery, deliberately readable
 * silhouettes, and canvas signs carry the period story without external assets.
 */
import * as THREE from '../../../public/js/three/build/three.module.js';

const C = {
  wood: 0x3b281d, woodEdge: 0x684631, cream: 0xe8dfce, wall: 0xcbbda8,
  steel: 0xaeb7b8, dark: 0x202326, chalk: 0xf3ead6, teal: 0x4f8b89,
  orange: 0xd77a42, denim: 0x294463, skin: 0xc99572, hair: 0x34241e,
  track: 0x55575a, cork: 0xb87946, green: 0x65835c,
};
const M = {};
const mat = (name, color, opts = {}) => M[name] ||= new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...opts });
function box(g, size, pos, material, name = '') { const m = new THREE.Mesh(new THREE.BoxGeometry(...size), material); m.position.set(...pos); if (name) m.name = name; g.add(m); return m; }
function cyl(g, r, h, pos, material, name = '', seg = 12) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), material); m.position.set(...pos); if (name) m.name = name; g.add(m); return m; }
function sphere(g, r, pos, material, name = '') { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), material); m.position.set(...pos); if (name) m.name = name; g.add(m); return m; }

function sign(text, w, h, opts = {}) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const x = c.getContext('2d'); x.fillStyle = opts.bg || '#26312f'; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = opts.border || '#d4b989'; x.lineWidth = 18; x.strokeRect(18, 18, 988, 476);
  x.fillStyle = opts.color || '#f3ead6'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const lines = String(text).split('\n'); x.font = opts.font || 'bold 54px Arial';
  lines.forEach((line, i) => x.fillText(line, 512, 256 + (i - (lines.length - 1) / 2) * 72, 930));
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true })); s.scale.set(w, h, 1); return s;
}
function wallSign(g, text, pos, size, opts = {}) { const s = sign(text, size[0], size[1], opts); s.position.set(...pos); g.add(s); return s; }
function line(g, a, b, material, width = 0.012) { const d = new THREE.Vector3(...b).sub(new THREE.Vector3(...a)); const m = cyl(g, width, d.length(), new THREE.Vector3(...a).add(new THREE.Vector3(...b)).multiplyScalar(0.5), material, '', 8); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return m; }

function espressoMachine(g) {
  const chrome = mat('brushed steel', C.steel, { metalness: 0.9, roughness: 0.25 });
  const black = mat('machine black', C.dark, { metalness: 0.25, roughness: 0.4 });
  const e = new THREE.Group(); e.name = 'semi-automatic stainless E61 espresso machine'; e.position.set(-2.88, 0.9, -1.0); e.rotation.y = Math.PI / 2;
  box(e, [0.58, 0.38, 0.8], [0, 0.2, 0], chrome, 'stainless boiler body'); box(e, [0.64, 0.06, 0.88], [0, 0.04, 0], black, 'drip tray');
  box(e, [0.6, 0.12, 0.86], [0, 0.42, 0], chrome, 'top deck');
  for (const z of [-0.24, 0.24]) { cyl(e, 0.1, 0.06, [0, 0.44, z], chrome, 'E61-style group head', 16).rotation.x = Math.PI / 2; line(e, [0, 0.39, z], [0, 0.18, z + 0.12], black, 0.025); }
  box(e, [0.28, 0.14, 0.025], [0.25, 0.29, 0], black, 'PID temperature panel'); wallSign(e, 'PID\n92°C', [0.255, 0.3, 0], [0.22, 0.12], { bg: '#182124', color: '#ef9b58', border: '#687477', font: 'bold 40px monospace' });
  e.children.forEach((o) => { if (o.position) o.castShadow = true; }); g.add(e);
}
function posTerminal(g) {
  const p = new THREE.Group(); p.name = 'touchscreen POS with card swipe reader'; p.position.set(-2.86, 0.91, 0.03); p.rotation.y = Math.PI / 2;
  box(p, [0.34, 0.14, 0.3], [0, 0.08, 0], mat('pos base', C.dark, { metalness: 0.35 }), 'POS base');
  box(p, [0.26, 0.28, 0.045], [0, 0.28, 0], mat('pos bezel', 0x333b3e, { metalness: 0.4 }), 'touchscreen');
  wallSign(p, 'SALE\n$4.25', [0, 0.29, 0.027], [0.22, 0.16], { bg: '#d6e2d6', color: '#183e42', border: '#65726c', font: 'bold 38px monospace' });
  box(p, [0.07, 0.18, 0.08], [0.16, 0.21, 0], mat('card reader', C.dark, { metalness: 0.7 }), 'side card-swipe reader');
  box(p, [0.04, 0.012, 0.05], [0.16, 0.25, 0.045], mat('reader slot', 0xe2d5b6));
  wallSign(p, 'THANK YOU', [-0.03, 0.12, 0.18], [0.25, 0.07], { bg: '#202326', color: '#d9e7dd', font: 'bold 26px monospace' });
  g.add(p);
}
function crtOrderStation(g) {
  const q = new THREE.Group(); q.name = 'beige CRT iMac-style order station'; q.position.set(-3.18, 0.96, 0.62); q.rotation.y = Math.PI / 2;
  box(q, [0.42, 0.12, 0.35], [0, 0.06, 0], mat('beige computer base', 0xd6cbb8, { roughness: 0.5 }), 'iMac dome base');
  box(q, [0.34, 0.34, 0.1], [0, 0.29, 0], mat('beige CRT housing', 0xcfc4b2, { roughness: 0.55 }), 'beige CRT monitor');
  wallSign(q, 'ORDER\nREADY', [0, 0.31, 0.056], [0.26, 0.19], { bg: '#28332e', color: '#9fe0ae', border: '#b9ae9b', font: 'bold 30px monospace' });
  box(q, [0.3, 0.025, 0.18], [0, 0.12, 0.25], mat('beige keyboard', 0xcfc4b2), 'order station keyboard'); g.add(q);
}
function pastryCase(g) {
  const glass = mat('pastry glass', 0xd9eee9, { transparent: true, opacity: 0.3, roughness: 0.1 });
  const q = new THREE.Group(); q.name = 'pastry case with labeled trays'; q.position.set(-2.9, 0.92, 1.28); q.rotation.y = Math.PI / 2;
  box(q, [0.62, 0.08, 0.8], [0, 0, 0], mat('case base', C.steel, { metalness: 0.75 }), 'pastry case base'); box(q, [0.58, 0.46, 0.76], [0, 0.27, 0], glass, 'curved pastry glass');
  for (let i = 0; i < 2; i++) { box(q, [0.5, 0.025, 0.62], [0, 0.13 + i * 0.2, 0], mat('tray', 0xd7c4a4), `labeled tray ${i + 1}`); wallSign(q, i ? 'MUFFIN  $2.00' : 'BAGEL  $1.50', [0.01, 0.16 + i * 0.2, 0.39], [0.42, 0.07], { bg: '#f7eedb', color: '#4a3425', border: '#a06d46', font: 'bold 22px Arial' }); }
  for (const z of [-0.34, 0.34]) line(q, [0, 0.02, z], [0, 0.52, z], mat('case trim', C.steel, { metalness: 0.8 }), 0.018); g.add(q);
}
function coffeeCounter(g) { box(g, [0.9, 0.9, 3.9], [-2.95, 0.45, 0], mat('brushed counter front', 0x596164, { metalness: 0.7, roughness: 0.35 }), 'brushed-steel counter front'); box(g, [1.02, 0.06, 4], [-2.95, 0.93, 0], mat('counter top', C.woodEdge, { roughness: 0.5 })); espressoMachine(g); posTerminal(g); crtOrderStation(g); pastryCase(g); }

function iPodDock(g) {
  const d = new THREE.Group(); d.name = 'white click-wheel iPod in speaker dock with CDs for sale'; d.position.set(-3.22, 0.99, 1.72);
  box(d, [0.46, 0.18, 0.25], [0, 0.09, 0], mat('speaker dock', C.dark, { roughness: 0.35 }), 'white iPod speaker dock');
  for (const z of [-0.09, 0.09]) cyl(d, 0.06, 0.02, [-0.22, 0.1, z], mat('speaker cone', 0x777d78), 'speaker grille', 16).rotation.z = Math.PI / 2;
  box(d, [0.12, 0.22, 0.035], [0, 0.28, 0], mat('iPod white', 0xf7f7ef, { roughness: 0.3 }), 'white iPod click wheel');
  cyl(d, 0.045, 0.008, [0, 0.28, 0.022], mat('click wheel', 0xb7b8b4), 'click wheel', 16).rotation.x = Math.PI / 2;
  for (let i = 0; i < 4; i++) cyl(d, 0.006, 0.01, [i === 0 ? -0.02 : i === 1 ? 0.02 : 0, 0.28 + (i > 1 ? (i === 2 ? 0.02 : -0.02) : 0), 0.03], mat('wheel icons', 0x6b6b68), '', 6).rotation.x = Math.PI / 2;
  for (let i = 0; i < 4; i++) { const cd = cyl(d, 0.18, 0.012, [0.22, 0.09 + i * 0.014, 0.13], mat(`CD ${i}`, [0x9db9c7, 0xd9a56a, 0xb8a6c7, 0x8ca98d][i], { metalness: 0.35 }), 'CD for sale', 24); cd.rotation.x = Math.PI / 2; }
  wallSign(d, 'CDs\nFOR SALE', [0.22, 0.24, 0.2], [0.3, 0.16], { bg: '#6a3c42', color: '#fff1df', border: '#e6c27f', font: 'bold 30px Arial' }); g.add(d);
}

function table(g, x, z) { const t = new THREE.Group(); t.name = 'dark wood table with iron legs'; t.position.set(x, 0, z); box(t, [1.35, 0.11, 0.8], [0, 0.74, 0], mat('dark wood table', C.wood, { roughness: 0.92 })); for (const [dx, dz] of [[-.52, -.28], [.52, -.28], [-.52, .28], [.52, .28]]) line(t, [0, 0.69, 0], [dx, 0.05, dz], mat('wrought iron legs', 0x202326, { metalness: 0.5 }), 0.035); tableware(t, -0.2, -0.08); tableware(t, 0.25, 0.14); g.add(t); }
function tableware(t, x, z) { cyl(t, 0.12, 0.07, [x, 0.84, z], mat('white ceramic cup', C.cream, { roughness: 0.35 }), 'white ceramic cup', 16); cyl(t, 0.085, 0.01, [x, 0.91, z], mat('coffee', 0x332219), 'coffee', 12); box(t, [0.13, 0.18, 0.13], [x + 0.16, 0.09, z], mat('paper to-go cup', C.cream), 'paper to-go cup with cardboard sleeve'); box(t, [0.135, 0.05, 0.135], [x + 0.16, 0.13, z], mat('cardboard sleeve', 0xa7784e), 'cardboard sleeve'); cyl(t, 0.055, 0.22, [x - 0.23, 0.11, z + 0.12], mat('travel mug', C.teal, { metalness: 0.25 }), 'travel mug', 12); box(t, [0.16, 0.01, 0.1], [x + 0.1, 0.94, z - 0.12], mat('raw sugar packets', 0xd8bd77), 'raw sugar packets'); cyl(t, 0.075, 0.22, [x - 0.05, 0.12, z + 0.2], mat('glass water bottle', 0xb9d8d4, { transparent: true, opacity: 0.5, roughness: 0.08 }), 'glass water bottle', 14); cyl(t, 0.045, 0.03, [x - 0.05, 0.245, z + 0.2], mat('bottle cap', C.steel, { metalness: 0.7 }), 'glass bottle cap', 12); }

function banquette(g) { box(g, [2.8, 0.62, 0.52], [1.25, 0.34, -1.95], mat('plush banquette vinyl', 0x72534a, { roughness: 0.95 }), 'plush banquette'); box(g, [2.8, 1.05, 0.16], [1.25, 0.9, -2.16], mat('banquette back', 0x694943, { roughness: 0.95 }), 'banquette back'); for (let x = 0.15; x < 2.5; x += 0.55) box(g, [0.015, 0.55, 0.54], [0.0 + x, 0.35, -1.95], mat('seat seam', 0x4b3733), 'banquette seam'); }

function person(g, x, z, outfit, hair, prop = '') { const p = new THREE.Group(); p.name = `2005 patron ${prop || outfit}`; p.position.set(x, 0, z); box(p, [0.28, 0.42, 0.18], [0, 1.0, 0], mat(outfit, outfit === C.denim ? C.denim : outfit), 'layered tee / track jacket'); box(p, [0.1, 0.62, 0.1], [-0.07, 0.3, 0], mat('bootcut jeans', C.denim), 'bootcut jeans'); box(p, [0.1, 0.62, 0.1], [0.07, 0.3, 0], mat('bootcut jeans', C.denim), 'bootcut jeans'); box(p, [0.13, 0.06, 0.22], [-0.07, 0.03, 0], mat('white sneakers', 0xf1eee5), 'chunky white shoes'); box(p, [0.13, 0.06, 0.22], [0.07, 0.03, 0], mat('white sneakers', 0xf1eee5)); sphere(p, 0.1, [0, 1.4, 0], mat('patron skin', C.skin), 'face'); sphere(p, 0.105, [0, 1.49, 0], mat('gelled spiky hair', hair), 'gelled/spiky hair'); if (prop === 'flip phone') { box(p, [0.05, 0.12, 0.02], [0.18, 0.88, 0.08], mat('flip phone', 0x343a40, { metalness: 0.5 }), 'flip phone'); } if (prop === 'camera') { box(p, [0.13, 0.08, 0.06], [0.18, 0.82, 0.08], mat('digital camera', 0x30383b, { metalness: 0.5 }), 'digital camera'); cyl(p, 0.025, 0.01, [0.18, 0.82, 0.115], mat('camera lens', 0x86a0aa, { metalness: 0.8 }), 'digital camera lens', 10).rotation.x = Math.PI / 2; } if (prop === 'laptop') { box(p, [0.38, 0.02, 0.27], [0, 0.83, 0.18], mat('iBook laptop', 0xd4d5d0, { metalness: 0.35 }), 'chunky early laptop'); box(p, [0.32, 0.24, 0.025], [0, 0.97, 0.16], mat('laptop screen', 0x202b35, { emissive: 0x375d68, emissiveIntensity: 0.8 }), 'glowing laptop logo'); } if (prop === 'earbuds') { line(p, [-0.14, 1.34, 0.05], [-0.14, 1.03, 0.06], mat('chunky white earbuds', 0xfafafa), 0.012); line(p, [0.14, 1.34, 0.05], [0.14, 1.03, 0.06], mat('chunky white earbuds', 0xfafafa), 0.012); } g.add(p); }

function menu(g) { box(g, [2.65, 1.16, 0.06], [-1.0, 2.1, -2.48], mat('painted menu wall', 0xb96e4f, { roughness: 0.9 }), 'painted menu wall'); wallSign(g, 'THE DAILY GRIND\nCOFFEE  $1.50   $2.00   $2.50\nTALL   GRANDE   VENTI\nLATTE  $2.25   FRAPPUCCINO  $2.50\nFAIR TRADE  •  ORGANIC', [-1.0, 2.12, -2.54], [1.65, 1.0], { bg: '#222321', color: '#f4e9cf', border: '#8b765e', font: 'bold 29px Arial' }); wallSign(g, '☕  ESPRESSO\n☕  ICED LATTE\nORGANIC', [0.08, 2.12, -2.55], [0.48, 0.82], { bg: '#292b27', color: '#e7d8b9', border: '#93826b', font: 'bold 27px Arial' }); }
function decor(g) { wallSign(g, 'FREE\nWi-Fi', [2.75, 2.02, -2.51], [0.58, 0.56], { bg: '#c8e2df', color: '#224d55', border: '#386b70', font: 'bold 54px Arial' }); wallSign(g, '@', [2.15, 2.25, -2.51], [0.3, 0.3], { bg: '#ddc5a4', color: '#563d2d', border: '#8c6042', font: 'bold 82px Arial' }); wallSign(g, 'COMMUNITY\nBOARD\nGIGS • EVENTS • ADS', [-2.0, 1.92, 2.48], [1.0, 1.0], { bg: '#b87946', color: '#27211c', border: '#3f2c20', font: 'bold 30px Arial' }); wallSign(g, 'INDIE NIGHT\nLOCAL GIGS\nALL AGES', [1.8, 1.46, 2.48], [0.7, 0.8], { bg: '#d85e46', color: '#fff2dd', border: '#242326', font: 'bold 31px Arial' }); }

function lights(g) { for (const [x, z] of [[-1.4, -0.3], [0.2, 1.2], [2.2, 0]]) { cyl(g, 0.015, 0.55, [x, 2.7, z], mat('pendant cord', 0x292929), 'pendant cord', 8); sphere(g, 0.09, [x, 2.4, z], mat('exposed warm bulb', 0xffc777, { emissive: 0xff9d4d, emissiveIntensity: 2 }), 'exposed bulb pendant'); const l = new THREE.PointLight(0xffbd7d, 3, 6); l.position.set(x, 2.38, z); g.add(l); } box(g, [3.6, 0.04, 0.05], [0.6, 2.72, -0.2], mat('halogen track', C.track, { metalness: 0.7 }), 'halogen track light'); for (let x = -0.8; x < 2.3; x += 0.75) cyl(g, 0.04, 0.12, [x, 2.65, -0.2], mat('halogen lamp', 0xffd9a0, { emissive: 0xffba6a, emissiveIntensity: 1.4 }), 'halogen spot', 10).rotation.z = Math.PI / 2; }

export const era2005 = { id: 'year-2005', label: '2005', year: 2005, hudText: 'Early Wi-Fi Café', assets: [], build() { const g = new THREE.Group(); g.name = 'era-2005-early-wifi-cafe'; box(g, [6.8, 0.02, 4.7], [0, 0.03, 0], mat('warm neutral floor', 0x80664d), 'warm neutral floor'); coffeeCounter(g); iPodDock(g); menu(g); decor(g); lights(g); banquette(g); table(g, -0.8, -0.65); table(g, 1.0, 0.65); person(g, -0.25, -0.15, C.orange, C.hair, 'flip phone'); person(g, 0.75, 0.72, 0x6f8b91, 0x191919, 'laptop'); person(g, 1.75, 0.5, C.teal, 0x7c4f31, 'camera'); person(g, 1.55, -1.2, 0x8e5f77, 0x242424, 'earbuds'); person(g, -0.2, 1.65, 0x5c6d9b, 0x352014, 'earbuds'); g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); return g; }, enter() {}, exit() {} };

export default era2005;
