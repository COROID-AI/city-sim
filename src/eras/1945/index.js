/** Post-war café, 1945.  All scenery is deliberately low-poly and procedural. */
import * as THREE from '../../../public/js/three/build/three.module.js';

const C = {
  oak: 0x24150f, oakEdge: 0x4a2d1c, brass: 0xb1843d, brassDark: 0x62451e,
  tileA: 0xb9aa91, tileB: 0x55483d, cream: 0xf0e5cb, red: 0x7b241c,
  green: 0x263f35, ink: 0x2b211b, chrome: 0xc4c6bc, glass: 0x9fb3ad,
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
function label(text, width, height, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 768; canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = opts.bg || '#202018'; g.fillRect(0, 0, 768, 256);
  g.strokeStyle = opts.border || '#b1843d'; g.lineWidth = 10; g.strokeRect(12, 12, 744, 232);
  g.fillStyle = opts.color || '#f0e5cb'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = opts.font || 'bold 42px Georgia';
  const lines = String(text).split('\n');
  lines.forEach((line, i) => g.fillText(line, 384, 128 + (i - (lines.length - 1) / 2) * 52, 700));
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
  sprite.scale.set(width, height, 1);
  return sprite;
}
function wood(parent, size, pos) { return box(parent, size, pos, material('oak', C.oak, { roughness: 0.95 })); }

function makeFloor(group) {
  const floor = material('tileFloor', C.tileA, { roughness: 0.92 });
  box(group, [6.9, 0.035, 4.9], [0, 0.015, 0], floor, 'worn checkerboard linoleum');
  const dark = material('tileDark', C.tileB, { roughness: 0.95 });
  for (let x = -3.15; x <= 3.15; x += 0.7) for (let z = -2.1; z <= 2.1; z += 0.7) {
    if ((Math.round((x + 3.15) / 0.7) + Math.round((z + 2.1) / 0.7)) % 2) box(group, [0.66, 0.012, 0.66], [x, 0.04, z], dark);
  }
}

function makeTable(group, x, z, round = false) {
  const topMat = material('scratched oak', C.oakEdge, { roughness: 0.98 });
  if (round) cyl(group, 0.62, 0.12, [x, 0.94, z], topMat, 16, 'heavy oak café table');
  else box(group, [1.2, 0.12, 0.72], [x, 0.94, z], topMat, 'heavy dark oak table');
  cyl(group, 0.13, 0.88, [x, 0.48, z], material('table leg', C.oak), 10);
  for (const [dx, dz] of [[-0.4, -0.23], [0.4, -0.23], [-0.4, 0.23], [0.4, 0.23]]) {
    cyl(group, 0.045, 0.88, [x + dx, 0.48, z + dz], material('leg edge', C.oak), 8);
  }
  cup(group, x - 0.22, 1.04, z - 0.08);
  carafe(group, x + 0.28, 1.12, z + 0.12);
}
function cup(group, x, y, z) {
  const porcelain = material('thick white porcelain gold rim', C.cream, { roughness: 0.4 });
  cyl(group, 0.13, 0.1, [x, y, z], porcelain, 16, 'saucer');
  cyl(group, 0.09, 0.1, [x, y + 0.075, z], material('coffee', 0x27150d), 12, 'coffee cup');
  cyl(group, 0.095, 0.012, [x, y + 0.13, z], material('gold rim', C.brass, { metalness: 0.7, roughness: 0.3 }), 16);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 6, 10, Math.PI), material('porcelain', C.cream));
  handle.position.set(x + 0.1, y + 0.12, z); handle.rotation.x = Math.PI / 2; group.add(handle);
}
function carafe(group, x, y, z) {
  const glass = material('water glass', C.glass, { transparent: true, opacity: 0.48, roughness: 0.12 });
  cyl(group, 0.13, 0.3, [x, y, z], glass, 12, 'glass water carafe');
  cyl(group, 0.09, 0.04, [x, y + 0.17, z], glass, 12);
  cyl(group, 0.13, 0.02, [x, y - 0.16, z], material('carafe base', C.brass), 12);
}

function makeChair(group, x, z, rotation = 0) {
  const chair = new THREE.Group(); chair.position.set(x, 0, z); chair.rotation.y = rotation; group.add(chair);
  const dark = material('bentwood', 0x3a2115, { roughness: 0.9 });
  box(chair, [0.48, 0.1, 0.48], [0, 0.53, 0], dark, 'woven seat');
  for (const dx of [-0.18, 0.18]) for (const dz of [-0.17, 0.17]) cyl(chair, 0.035, 0.55, [dx, 0.27, dz], dark, 8);
  box(chair, [0.48, 0.72, 0.07], [0, 0.93, -0.2], dark, 'Thonet bentwood chair back');
  for (let i = -1; i <= 1; i++) box(chair, [0.34, 0.018, 0.012], [0, 0.78 + i * 0.12, -0.245], material('woven cane', 0x9b774c));
}

function makeCounter(group) {
  const oak = material('counter oak', 0x301b12, { roughness: 0.94 });
  box(group, [0.9, 0.9, 3.9], [-2.95, 0.45, 0], oak, 'dark oak counter');
  box(group, [1.02, 0.1, 4.05], [-2.95, 0.95, 0], material('counter stone', 0x6d5540, { roughness: 0.6 }), 'brass-edged counter');
  box(group, [0.06, 0.07, 4], [-2.45, 0.98, 0], material('counter brass rail', C.brass, { metalness: 0.8, roughness: 0.3 }));
  makeEspresso(group, -2.9, -0.75); makeGrinder(group, -3.25, -1.52); makeTill(group, -2.72, 0.65);
  makePastry(group, -2.9, 0.2); makeRadio(group, -3.25, 1.55);
}
function makeEspresso(group, x, z) {
  const chrome = material('aged chrome', C.chrome, { metalness: 0.85, roughness: 0.28 });
  box(group, [0.48, 0.28, 0.62], [x, 1.18, z], chrome, 'tall manual lever espresso machine');
  box(group, [0.54, 0.05, 0.7], [x, 1.03, z], material('espresso drip tray', 0x282522, { metalness: 0.7 }));
  for (const dz of [-0.2, 0.2]) { cyl(group, 0.06, 0.15, [x, 1.37, z + dz], chrome, 12); cyl(group, 0.018, 0.34, [x, 1.57, z + dz], material('lever', C.brass, { metalness: 0.7 }), 8); }
  box(group, [0.07, 0.07, 0.5], [x + 0.16, 1.73, z], material('pull handle', 0x27170e), 8, 'hand pulled lever');
  cyl(group, 0.06, 0.12, [x - 0.2, 1.33, z], material('group head', C.brass), 10);
}
function makeGrinder(group, x, z) {
  const metal = material('grinder metal', 0x6f7068, { metalness: 0.8, roughness: 0.32 });
  box(group, [0.25, 0.55, 0.25], [x, 1.42, z], metal, 'large wall-mounted coffee grinder');
  cyl(group, 0.15, 0.28, [x, 1.77, z], material('grinder hopper', 0x79664b, { transparent: true, opacity: 0.72 }), 12);
  cyl(group, 0.07, 0.25, [x, 1.08, z], material('grind chute', C.brass), 10);
  box(group, [0.06, 0.3, 0.06], [x + 0.18, 1.2, z], material('grinder crank', C.brass), 'mechanical grinder crank');
}
function makeTill(group, x, z) {
  const brass = material('till brass', C.brass, { metalness: 0.75, roughness: 0.35 });
  box(group, [0.42, 0.3, 0.45], [x, 1.16, z], material('mechanical till', 0x6a5a43, { metalness: 0.2 }), 'hand-crank cash register');
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) cyl(group, 0.035, 0.018, [x + i * 0.1, 1.34, z + j * 0.1], brass, 8, 'brass till button');
  box(group, [0.34, 0.09, 0.14], [x, 1.0, z + 0.27], brass, 'pop-out drawer');
  cyl(group, 0.025, 0.3, [x - 0.28, 1.25, z], brass, 8, 'cash till hand crank');
}
function makePastry(group, x, z) {
  const glass = material('display glass', 0xd8e5dc, { transparent: true, opacity: 0.28, roughness: 0.1 });
  cyl(group, 0.3, 0.04, [x, 1.05, z], material('display plate', C.cream), 16);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.31, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  dome.position.set(x, 1.07, z); group.add(dome);
  for (let i = 0; i < 3; i++) cyl(group, 0.08, 0.035, [x - 0.12 + i * 0.12, 1.09, z], material('pie', 0xb46c3e), 10, 'pastry beneath glass dome');
}
function makeRadio(group, x, z) {
  box(group, [0.52, 0.4, 0.35], [x, 1.55, z], material('walnut radio cabinet', 0x41281a, { roughness: 0.93 }), 'wooden valve wireless set');
  box(group, [0.34, 0.13, 0.02], [x, 1.61, z - 0.18], material('radio grille', 0x17130f), 'cloth speaker grille');
  const dial = material('warm glowing radio dial', 0xffb84c, { emissive: 0xff9d25, emissiveIntensity: 2 });
  cyl(group, 0.08, 0.012, [x, 1.5, z - 0.19], dial, 16, 'glowing tuning dial');
}

function makeWallDress(group) {
  const poster = label('BUY WAR BONDS\nSAVE & SERVE', 1.45, 0.72, { bg: '#8d3024', border: '#e4c987', font: 'bold 35px Georgia' });
  poster.position.set(-0.9, 2.25, -2.46); poster.rotation.y = Math.PI; group.add(poster);
  const notice = label('RATION NOTICE\nSUGAR: LIMITED', 1.2, 0.58, { bg: '#d8c79f', border: '#493827', color: '#3b2a1c', font: 'bold 28px Georgia' });
  notice.position.set(0.75, 2.25, -2.46); notice.rotation.y = Math.PI; group.add(notice);
  const sign = label('ICE COLD\nCOCA-COLA', 1.35, 0.58, { bg: '#a5231e', border: '#f0d59a', font: 'italic 32px Georgia' });
  sign.position.set(2.1, 1.65, -2.46); sign.rotation.y = Math.PI; group.add(sign);
  const menu = label('COFFEE ........ 7¢\nPIE ........... 15¢\nMILK .......... 5¢', 1.45, 0.82, { bg: '#20251d', border: '#b1843d', color: '#e8d7ad', font: 'italic 29px Georgia' });
  menu.position.set(1.0, 1.24, -2.46); menu.rotation.y = Math.PI; group.add(menu);
  const photo = label('C. 1945\nOUR CAFÉ', 0.74, 0.62, { bg: '#766b59', border: '#32261b', color: '#ead9b5', font: 'bold 23px Georgia' });
  photo.position.set(2.72, 2.32, -2.46); photo.rotation.y = Math.PI; group.add(photo);
  const newspaper = label('THE DAILY HERALD\nVICTORY IN EUROPE', 1.5, 0.5, { bg: '#e5dcc4', border: '#4a3926', color: '#30271e', font: 'bold 24px Georgia' });
  newspaper.position.set(-1.9, 2.5, 2.46); newspaper.rotation.y = 0; group.add(newspaper);
  // Lace/damask window dressing: translucent vertical panels and valance.
  const curtain = material('lace curtains', 0xd6c7ad, { transparent: true, opacity: 0.58, roughness: 0.95 });
  for (const x of [-3.12, 1.62]) box(group, [0.42, 1.48, 0.025], [x, 1.72, 2.42], curtain, 'lace curtain');
  box(group, [4.9, 0.35, 0.03], [-0.75, 2.48, 2.42], curtain, 'damask curtain valance');
  const decal = label('CAFÉ\nENTRANCE', 0.65, 0.44, { bg: '#b9ced0', border: '#fff6dc', color: '#554334', font: 'bold 24px Georgia' });
  decal.position.set(2.62, 1.32, 2.42); group.add(decal);
}

function patron(group, x, z, outfit, hat = false, reading = false) {
  const p = new THREE.Group(); p.position.set(x, 0, z); group.add(p);
  const clothes = material(`clothes-${outfit}`, outfit);
  cyl(p, 0.2, 0.6, [0, 0.92, 0], clothes, 8, '1940s patron suit or dress');
  cyl(p, 0.09, 0.38, [-0.1, 0.32, 0], material('stocking', 0x362a2b), 8);
  cyl(p, 0.09, 0.38, [0.1, 0.32, 0], material('stocking', 0x362a2b), 8);
  cyl(p, 0.15, 0.22, [0, 1.43, 0], material('skin', 0xc58e6f), 10, 'waved hair and face');
  if (hat) { cyl(p, 0.19, 0.09, [0, 1.59, 0], material('fedora', 0x241f1e), 10); box(p, [0.31, 0.025, 0.22], [0, 1.64, 0], material('fedora brim', 0x241f1e)); }
  else { cyl(p, 0.19, 0.08, [0, 1.58, 0], material('victory roll hair', 0x4b251b), 10); }
  if (reading) { const paper = label('HERALD', 0.3, 0.22, { bg: '#e7ddc5', border: '#4a3926', color: '#33271e', font: 'bold 19px serif' }); paper.position.set(0, 1.0, -0.23); paper.rotation.x = -0.35; p.add(paper); }
}

function makeLights(group) {
  const warm = 0xffbf75;
  group.add(new THREE.HemisphereLight(0xffe4bc, 0x1a100c, 0.28));
  for (const [x, z] of [[-1.2, -1.2], [0.9, 0.6], [2.3, -1.5]]) {
    const light = new THREE.PointLight(warm, 2.1, 4.8, 2); light.position.set(x, 2.55, z); group.add(light);
    cyl(group, 0.04, 0.42, [x, 2.78, z], material('pendant cord', 0x17120e), 8);
    cyl(group, 0.14, 0.06, [x, 2.55, z], material('brass pendant cap', C.brass, { metalness: 0.65 }), 12);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), material('tungsten bulb', warm, { emissive: warm, emissiveIntensity: 3 }));
    bulb.position.set(x, 2.49, z); group.add(bulb);
  }
  for (const [x, z] of [[-3.43, -0.4], [-3.43, 1.8]]) {
    const s = new THREE.PointLight(0xffc982, 1.2, 2.5, 2); s.position.set(x, 1.95, z); group.add(s);
    box(group, [0.06, 0.22, 0.18], [x + 0.04, 1.95, z], material('sconce brass', C.brass, { metalness: 0.7 }), 'wall sconce');
  }
}

export const era1945 = {
  id: 'postwar-1945', label: '1945 · Post-war Café', year: 1945,
  hudText: 'POST-WAR CAFÉ · WARM TUNGSTEN', assets: [],
  metadata: {
    tint: '#e8a64c',
    caption: { name: 'Post-war Café', vibe: 'Warm tungsten, rationed coffee, big-band radio' },
    inspectables: [
      { id: 'cash-register', name: 'Hand-crank Cash Register', object: 'hand-crank cash register', story: 'Hand-crank cash register — 1945: no electricity, prices rung by hand' },
      { id: 'espresso', name: 'Lever Espresso Machine', object: 'tall manual lever espresso machine', story: 'Lever espresso machine — 1945: steam pressure and a handle pulled by muscle' },
      { id: 'grinder', name: 'Wall Coffee Grinder', object: 'large wall-mounted coffee grinder', story: 'Wall grinder — 1945: beans cranked fresh by hand each morning' },
      { id: 'radio', name: 'Valve Wireless Radio', object: 'wooden valve wireless set', story: 'Valve radio — 1945: the café tunes the news and big-band on AM' },
      { id: 'table', name: 'Heavy Oak Table', object: 'heavy dark oak table', story: 'Oak table — 1945: heavy and sturdy, built to outlast the war' },
    ],
    presets: [
      { id: 'counter', name: 'Counter & Machine', position: [-3.1, 1.5, 2.2], target: [-2.9, 1.1, 0.4] },
      { id: 'menu', name: 'Menu & Posters', position: [0.4, 1.6, 2.2], target: [0.0, 1.3, -2.0] },
      { id: 'music', name: 'Valve Radio', position: [-3.0, 1.4, 2.1], target: [-3.2, 1.5, 1.5] },
      { id: 'seating', name: 'Seating Area', position: [0.0, 1.6, 2.2], target: [0.0, 0.9, 0.2] },
      { id: 'posters', name: 'Wall Posters', position: [1.4, 1.6, 2.2], target: [0.8, 1.2, -2.0] },
    ],
    overview: { position: [3.1, 1.9, 2.3], target: [0, 1.05, -0.3] },
  },
  build(ctx) {
    const group = new THREE.Group(); group.name = 'postwar-cafe-interior';
    makeFloor(group); makeCounter(group); makeWallDress(group);
    makeTable(group, -0.9, -0.65); makeTable(group, 1.0, 0.6, true);
    makeChair(group, -0.9, -1.25, 0); makeChair(group, -0.9, -0.05, Math.PI);
    makeChair(group, 1.0, -0.05, 0); makeChair(group, 1.65, 0.6, -Math.PI / 2);
    patron(group, -0.9, -0.48, 0x202a38, true, true);
    patron(group, 1.1, 0.5, 0x6b2930, false, false);
    patron(group, -2.1, 1.1, 0x263f35, true, false);
    makeLights(group);
    return group;
  },
  enter(ctx) { ctx.scene.fog = new THREE.Fog(0x241c18, 4.5, 11); },
  exit(ctx) { if (ctx.scene.fog) ctx.scene.fog = null; },
};

export default era1945;
