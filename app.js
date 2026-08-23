/**
 * Three.js Café Timelapse Scene
 *
 * Creates a 3D café interior scene with basic geometry, lighting, and
 * year-layer containers for period-specific asset swapping.
 * Integrates with the timeline slider for year selection.
 */

// Three.js scene setup
const scene = new THREE.Scene();

// Year-layer containers for asset swapping
// Each container will hold assets for a specific year period
const yearLayers = {
  1945: new THREE.Group(), // Post-War Era
  1965: new THREE.Group(), // Swinging Sixties
  1985: new THREE.Group(), // Retro Eighties
  2005: new THREE.Group(), // Digital Age
  2025: new THREE.Group() // Modern Times
};

// Add all year layers to the scene
Object.values(yearLayers).forEach(layer => {
  layer.visible = false;
  scene.add(layer);
});

// Camera - perspective camera
const camera = new THREE.PerspectiveCamera(
  60, // field of view
  window.innerWidth / window.innerHeight, // aspect ratio
  0.1, // near plane
  1000 // far plane
);

// Camera position - view the café interior
camera.position.set(0, 1.5, 3);
camera.lookAt(0, 0, 0);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.querySelector('.scene').appendChild(renderer.domElement);

// Ambient lighting - soft overall illumination
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

// Directional lighting - main light source simulating window light
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 5, 5);
directionalLight.castShadow = true;
scene.add(directionalLight);

// Floor
const floorGeometry = new THREE.PlaneGeometry(10, 10);
const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xf0f0f0 });
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Basic room - walls
const wallColor = 0xffffff;

// Back wall
const backWallGeometry = new THREE.PlaneGeometry(10, 8);
const backWallMaterial = new THREE.MeshStandardMaterial({ color: wallColor });
const backWall = new THREE.Mesh(backWallGeometry, backWallMaterial);
backWall.position.z = -4;
backWall.position.y = 4;
backWall.receiveShadow = true;
scene.add(backWall);

// Left wall
const leftWallGeometry = new THREE.PlaneGeometry(10, 8);
const leftWall = new THREE.Mesh(leftWallGeometry, backWallMaterial);
leftWall.rotation.y = Math.PI / 2;
leftWall.position.x = -5;
leftWall.position.y = 4;
leftWall.receiveShadow = true;
scene.add(leftWall);

// Right wall
const rightWallGeometry = new THREE.PlaneGeometry(10, 8);
const rightWall = new THREE.Mesh(rightWallGeometry, backWallMaterial);
rightWall.rotation.y = -Math.PI / 2;
rightWall.position.x = 5;
rightWall.position.y = 4;
rightWall.receiveShadow = true;
scene.add(rightWall);

// Ceiling
const ceilingGeometry = new THREE.PlaneGeometry(10, 10);
const ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0xf5f5f5 });
const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
ceiling.rotation.x = Math.PI / 2;
ceiling.position.y = 8;
ceiling.receiveShadow = true;
scene.add(ceiling);

// Table (static across all years)
function createTable(x, z) {
  const tableGroup = new THREE.Group();

  // Table top
  const tableTopGeometry = new THREE.BoxGeometry(0.8, 0.05, 0.8);
  const tableTopMaterial = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
  const tableTop = new THREE.Mesh(tableTopGeometry, tableTopMaterial);
  tableTop.position.y = 0.25;
  tableTop.castShadow = true;
  tableGroup.add(tableTop);

  // Table legs
  const legGeometry = new THREE.BoxGeometry(0.05, 0.4, 0.05);
  const legMaterial = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
  for (const pos of [
    { x: 0.35, z: 0.35 },
    { x: -0.35, z: 0.35 },
    { x: 0.35, z: -0.35 },
    { x: -0.35, z: -0.35 }
  ]) {
    const leg = new THREE.Mesh(legGeometry, legMaterial);
    leg.position.set(pos.x, 0.2, pos.z);
    leg.castShadow = true;
    tableGroup.add(leg);
  }

  tableGroup.position.set(x, 0, z);
  tableGroup.castShadow = true;
  return tableGroup;
}

// Create some tables
const table1 = createTable(-1, -1);
const table2 = createTable(1, -1);
const table3 = createTable(-1, 1);
scene.add(table1, table2, table3);

// ===============================
// 1945 Period Assets
// ===============================

// Coffee machine (vintage 1945 espresso machine)
const createCoffeeMachine1945 = () => {
  const group = new THREE.Group();

  const bodyGeometry = new THREE.BoxGeometry(0.6, 0.8, 0.4);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 0.4;
  body.castShadow = true;
  group.add(body);

  const panelGeometry = new THREE.BoxGeometry(0.6, 0.15, 0.3);
  const panelMaterial = new THREE.MeshStandardMaterial({ color: 0x5d4037 });
  const panel = new THREE.Mesh(panelGeometry, panelMaterial);
  panel.position.y = 0.75;
  panel.castShadow = true;
  group.add(panel);

  const pipeGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8);
  const pipeMaterial = new THREE.MeshStandardMaterial({ color: 0xbfbfbf });
  const pipe = new THREE.Mesh(pipeGeometry, pipeMaterial);
  pipe.position.set(0.2, 0.9, 0.15);
  pipe.rotation.x = Math.PI / 2;
  pipe.castShadow = true;
  group.add(pipe);

  const baseGeometry = new THREE.BoxGeometry(0.6, 0.05, 0.4);
  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = 0.05;
  base.castShadow = true;
  group.add(base);

  return group;
};

// Manual till
const createManualTill1945 = () => {
  const group = new THREE.Group();

  const tillTopGeometry = new THREE.BoxGeometry(0.5, 0.1, 0.3);
  const tillTopMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
  const tillTop = new THREE.Mesh(tillTopGeometry, tillTopMaterial);
  tillTop.position.y = 0.05;
  tillTop.castShadow = true;
  group.add(tillTop);

  const panelGeometry = new THREE.BoxGeometry(0.5, 0.3, 0.02);
  const panelMaterial = new THREE.MeshStandardMaterial({ color: 0x5d4037 });
  const panel = new THREE.Mesh(panelGeometry, panelMaterial);
  panel.position.y = 0.2;
  panel.castShadow = true;
  group.add(panel);

  const drawerGeometry = new THREE.BoxGeometry(0.45, 0.15, 0.25);
  const drawerMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4226 });
  const drawer = new THREE.Mesh(drawerGeometry, drawerMaterial);
  drawer.position.y = 0.2;
  drawer.castShadow = true;
  group.add(drawer);

  const coinSlotGeometry = new THREE.BoxGeometry(0.1, 0.05, 0.02);
  const coinSlotMaterial = new THREE.MeshStandardMaterial({ color: 0xcd7f32 });
  const coinSlot = new THREE.Mesh(coinSlotGeometry, coinSlotMaterial);
  coinSlot.position.set(0.15, 0.12, 0.13);
  coinSlot.castShadow = true;
  group.add(coinSlot);

  const baseGeometry = new THREE.BoxGeometry(0.5, 0.05, 0.3);
  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = 0.025;
  base.castShadow = true;
  group.add(base);

  return group;
};

// Tableware (plates, cups)
const createTableware1945 = () => {
  const group = new THREE.Group();

  const plateGeometry = new THREE.BoxGeometry(0.2, 0.02, 0.2);
  const plateMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const plate = new THREE.Mesh(plateGeometry, plateMaterial);
  plate.position.y = 0.1;
  plate.castShadow = true;
  group.add(plate);

  const cupGeometry = new THREE.CylinderGeometry(0.08, 0.08, 0.12, 16);
  const cupMaterial = new THREE.MeshStandardMaterial({ color: 0xffa500 });
  const cup = new THREE.Mesh(cupGeometry, cupMaterial);
  cup.position.set(-0.15, 0.18, 0.1);
  cup.castShadow = true;
  group.add(cup);

  const saucerGeometry = new THREE.BoxGeometry(0.15, 0.02, 0.15);
  const saucer = new THREE.Mesh(saucerGeometry, plateMaterial);
  saucer.position.set(-0.15, 0.08, 0.1);
  saucer.castShadow = true;
  group.add(saucer);

  const baseGeometry = new THREE.BoxGeometry(0.25, 0.05, 0.25);
  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = 0.025;
  base.castShadow = true;
  group.add(base);

  return group;
};

// Wireless set (1940s radio)
const createWirelessSet1945 = () => {
  const group = new THREE.Group();

  const bodyGeometry = new THREE.BoxGeometry(0.5, 0.25, 0.3);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x2f4f4f });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 0.15;
  body.castShadow = true;
  group.add(body);

  const grilleGeometry = new THREE.BoxGeometry(0.45, 0.05, 0.25);
  const grilleMaterial = new THREE.MeshStandardMaterial({ color: 0x2f4f4f });
  const grille = new THREE.Mesh(grilleGeometry, grilleMaterial);
  grille.position.y = 0.28;
  grille.castShadow = true;
  group.add(grille);

  const dialGeometry = new THREE.SphereGeometry(0.08, 16, 16);
  const dialMaterial = new THREE.MeshStandardMaterial({ color: 0xffd700 });
  const dial = new THREE.Mesh(dialGeometry, dialMaterial);
  dial.position.set(-0.2, 0.18, 0.12);
  dial.castShadow = true;
  group.add(dial);

  const antennaGeometry = new THREE.CylinderGeometry(0.01, 0.02, 0.5, 8);
  const antennaMaterial = new THREE.MeshStandardMaterial({ color: 0xffd700 });
  const antenna = new THREE.Mesh(antennaGeometry, antennaMaterial);
  antenna.position.set(0.22, 0.35, 0);
  antenna.rotation.x = Math.PI / 2;
  antenna.castShadow = true;
  group.add(antenna);

  const baseGeometry = new THREE.BoxGeometry(0.5, 0.05, 0.3);
  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x2f4f4f });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = 0.025;
  base.castShadow = true;
  group.add(base);

  return group;
};

// Posters on walls
const createPosters1945 = () => {
  const group = new THREE.Group();

  const poster1Geometry = new THREE.BoxGeometry(0.3, 0.4, 0.02);
  const poster1Material = new THREE.MeshStandardMaterial({ color: 0x8b0000 });
  const poster1 = new THREE.Mesh(poster1Geometry, poster1Material);
  poster1.position.set(-2, 3.5, -4.01);
  poster1.castShadow = true;
  group.add(poster1);

  const poster2Geometry = new THREE.BoxGeometry(0.3, 0.4, 0.02);
  const poster2Material = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
  const poster2 = new THREE.Mesh(poster2Geometry, poster2Material);
  poster2.position.set(2, 3.5, -4.01);
  poster2.castShadow = true;
  group.add(poster2);

  const baseGeometry = new THREE.BoxGeometry(0.35, 0.5, 0.04);
  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x8b0000 });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = 0.25;
  base.castShadow = true;
  group.add(base);

  return group;
};

// Signage
const createSignage1945 = () => {
  const group = new THREE.Group();

  const signGeometry = new THREE.BoxGeometry(0.4, 0.6, 0.05);
  const signMaterial = new THREE.MeshStandardMaterial({ color: 0xffd700 });
  const sign = new THREE.Mesh(signGeometry, signMaterial);
  sign.position.set(0, 2.5, -4.025);
  sign.castShadow = true;
  group.add(sign);

  const letterGeometry = new THREE.BoxGeometry(0.08, 0.15, 0.02);
  const letterMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });
  for (const pos of [
    { x: -0.15, y: 2.65, z: -4.03 },
    { x: 0.05, y: 2.65, z: -4.03 },
    { x: 0.25, y: 2.65, z: -4.03 }
  ]) {
    const letter = new THREE.Mesh(letterGeometry, letterMaterial);
    letter.position.set(pos.x, pos.y, pos.z);
    letter.castShadow = true;
    group.add(letter);
  }

  const baseGeometry = new THREE.BoxGeometry(0.45, 0.7, 0.1);
  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x2f4f4f });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = 0.35;
  base.castShadow = true;
  group.add(base);

  return group;
};

// 1940s patrons
const createPatrons1945 = () => {
  const group = new THREE.Group();

  const patronGeometry = new THREE.BoxGeometry(0.3, 1.6, 0.2);
  const patron1Material = new THREE.MeshStandardMaterial({ color: 0xcd853f });

  const patron1 = new THREE.Mesh(patronGeometry, patron1Material);
  patron1.position.set(-1.2, 0.8, -0.5);
  patron1.castShadow = true;
  group.add(patron1);

  const patron2 = new THREE.Mesh(patronGeometry, patron1Material);
  patron2.position.set(1.2, 0.8, -0.5);
  patron2.castShadow = true;
  group.add(patron2);

  const patron3 = new THREE.Mesh(patronGeometry, patron1Material);
  patron3.position.set(0, 0.8, 0.5);
  patron3.castShadow = true;
  group.add(patron3);

  const baseGeometry = new THREE.BoxGeometry(0.5, 0.1, 0.5);
  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = 0.05;
  base.castShadow = true;
  group.add(base);

  return group;
};

// Menu board
const createMenuBoard1945 = () => {
  const group = new THREE.Group();

  const boardGeometry = new THREE.BoxGeometry(0.5, 0.8, 0.02);
  const boardMaterial = new THREE.MeshStandardMaterial({ color: 0xffd700 });
  const board = new THREE.Mesh(boardGeometry, boardMaterial);
  board.position.set(0, 1.5, -4.025);
  board.castShadow = true;
  group.add(board);

  const menuItems = [
    { text: 'COFFEE', x: -0.1, y: 1.65 },
    { text: 'CAKE', x: -0.1, y: 1.85 },
    { text: 'SANDWICH', x: -0.1, y: 2.05 }
  ];

  menuItems.forEach((item, i) => {
    const itemGeometry = new THREE.BoxGeometry(0.3, 0.05, 0.01);
    const itemMaterial = new THREE.MeshStandardMaterial({
      color: i === 0 ? 0x8b4513 : i === 1 ? 0xffa500 : 0x2f4f4f
    });
    const itemRect = new THREE.Mesh(itemGeometry, itemMaterial);
    itemRect.position.set(item.x, item.y, -4.03);
    itemRect.castShadow = true;
    group.add(itemRect);
  });

  const baseGeometry = new THREE.BoxGeometry(0.55, 0.9, 0.1);
  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x2f4f4f });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = 0.45;
  base.castShadow = true;
  group.add(base);

  return group;
};

// Furniture (1940s chairs and small tables)
const createFurniture1945 = () => {
  const group = new THREE.Group();

  const chairGeometry = new THREE.BoxGeometry(0.4, 0.9, 0.4);
  const chairMaterial = new THREE.MeshStandardMaterial({ color: 0x8b7355 });

  const chair = new THREE.Mesh(chairGeometry, chairMaterial);
  chair.position.set(-2.5, 0.45, -0.2);
  chair.castShadow = true;
  group.add(chair);

  const chair2 = new THREE.Mesh(chairGeometry, chairMaterial);
  chair2.position.set(2.5, 0.45, -0.2);
  chair2.castShadow = true;
  group.add(chair2);

  const smallTableGeometry = new THREE.BoxGeometry(0.5, 0.05, 0.5);
  const smallTableMaterial = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
  const smallTable = new THREE.Mesh(smallTableGeometry, smallTableMaterial);
  smallTable.position.set(0, 0.25, 0.6);
  smallTable.castShadow = true;
  group.add(smallTable);

  const baseGeometry = new THREE.BoxGeometry(3, 0.5, 1.2);
  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = 0.05;
  base.castShadow = true;
  group.add(base);

  return group;
};

// ===============================
// 1965 Period Assets
// ===============================

const createCoffeeMachine1965 = () => {
  const group = new THREE.Group();

  const bodyGeometry = new THREE.BoxGeometry(0.65, 0.85, 0.42);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xc0c0c0 });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 0.42;
  body.castShadow = true;
  group.add(body);

  const panelGeometry = new THREE.BoxGeometry(0.65, 0.18, 0.32);
  const panelMaterial = new THREE.MeshStandardMaterial({ color: 0x37474f });
  const panel = new THREE.Mesh(panelGeometry, panelMaterial);
  panel.position.y = 0.8;
  panel.castShadow = true;
  group.add(panel);

  const baseGeometry = new THREE.BoxGeometry(0.65, 0.05, 0.42);
  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x8d6e63 });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = 0.05;
  base.castShadow = true;
  group.add(base);

  // steam knob
  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xffd700 })
  );
  knob.position.set(-0.15, 0.92, 0.18);
  knob.castShadow = true;
  group.add(knob);

  return group;
};

const createManualTill1965 = () => {
  const group = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.08, 0.38),
    new THREE.MeshStandardMaterial({ color: 0x8d6e63 })
  );
  base.position.y = 0.04;
  base.castShadow = true;
  group.add(base);

  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.28, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x37474f })
  );
  panel.position.y = 0.2;
  panel.castShadow = true;
  group.add(panel);

  const drawer = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.15, 0.27),
    new THREE.MeshStandardMaterial({ color: 0x5d4037 })
  );
  drawer.position.y = 0.16;
  drawer.castShadow = true;
  group.add(drawer);

  const slot = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.06, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xffa000 })
  );
  slot.position.set(0.15, 0.12, 0.13);
  slot.castShadow = true;
  group.add(slot);

  return group;
};

const createTableware1965 = () => {
  const group = new THREE.Group();

  const plateMaterial = new THREE.MeshStandardMaterial({ color: 0xe0f7fa });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.2), plateMaterial);
  plate.position.y = 0.1;
  plate.castShadow = true;
  group.add(plate);

  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 0.12, 16),
    new THREE.MeshStandardMaterial({ color: 0x00acc1 })
  );
  cup.position.set(-0.15, 0.18, 0.1);
  cup.castShadow = true;
  group.add(cup);

  const saucer = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, 0.15), plateMaterial);
  saucer.position.set(-0.15, 0.08, 0.1);
  saucer.castShadow = true;
  group.add(saucer);

  const base = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.05, 0.25), plateMaterial);
  base.position.y = 0.025;
  base.castShadow = true;
  group.add(base);

  return group;
};

// Jukebox (1965)
const createJukebox1965 = () => {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.95, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x1c1c1c })
  );
  body.position.y = 0.46;
  body.castShadow = true;
  group.add(body);

  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.32, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x1565c0 })
  );
  screen.position.set(0, 0.55, 0.12);
  screen.castShadow = true;
  group.add(screen);

  const knobs = [
    { x: -0.15, y: 0.32 },
    { x: 0, y: 0.32 },
    { x: 0.15, y: 0.32 }
  ];
  knobs.forEach(k => {
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xffd700 })
    );
    knob.position.set(k.x, k.y, 0.11);
    knob.castShadow = true;
    group.add(knob);
  });

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.08, 0.25),
    new THREE.MeshStandardMaterial({ color: 0xff6f00 })
  );
  base.position.y = 0.04;
  base.castShadow = true;
  group.add(base);

  return group;
};

const createPosters1965 = () => {
  const group = new THREE.Group();

  const poster1 = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.4, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xff1744 })
  );
  poster1.position.set(-2, 3.5, -4.01);
  poster1.castShadow = true;
  group.add(poster1);

  const poster2 = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.4, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x00e5ff })
  );
  poster2.position.set(2, 3.5, -4.01);
  poster2.castShadow = true;
  group.add(poster2);

  return group;
};

const createSignage1965 = () => {
  const group = new THREE.Group();

  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.6, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x00e5ff })
  );
  sign.position.set(0, 2.5, -4.025);
  sign.castShadow = true;
  group.add(sign);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.7, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x1c1c1c })
  );
  base.position.y = 0.35;
  base.castShadow = true;
  group.add(base);

  const letterMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const letter = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.02), letterMaterial);
  for (const pos of [
    { x: -0.15, y: 2.65, z: -4.03 },
    { x: 0.05, y: 2.65, z: -4.03 },
    { x: 0.25, y: 2.65, z: -4.03 }
  ]) {
    const l = letter.clone();
    l.position.set(pos.x, pos.y, pos.z);
    l.castShadow = true;
    group.add(l);
  }

  return group;
};

const createPatrons1965 = () => {
  const group = new THREE.Group();
  const patronGeometry = new THREE.BoxGeometry(0.3, 1.6, 0.2);
  const materials = [
    new THREE.MeshStandardMaterial({ color: 0x90caf9 }),
    new THREE.MeshStandardMaterial({ color: 0xa5d6a7 }),
    new THREE.MeshStandardMaterial({ color: 0xffcc80 })
  ];

  const p1 = new THREE.Mesh(patronGeometry, materials[0]);
  p1.position.set(-1.2, 0.8, -0.5);
  p1.castShadow = true;
  group.add(p1);

  const p2 = new THREE.Mesh(patronGeometry, materials[1]);
  p2.position.set(1.2, 0.8, -0.5);
  p2.castShadow = true;
  group.add(p2);

  const p3 = new THREE.Mesh(patronGeometry, materials[2]);
  p3.position.set(0, 0.8, 0.5);
  p3.castShadow = true;
  group.add(p3);

  return group;
};

const createMenuBoard1965 = () => {
  const group = new THREE.Group();

  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.8, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xffa000 })
  );
  board.position.set(0, 1.5, -4.025);
  board.castShadow = true;
  group.add(board);

  const items = [
    { x: -0.1, y: 1.65, c: 0x00e5ff },
    { x: -0.1, y: 1.85, c: 0xff1744 },
    { x: -0.1, y: 2.05, c: 0x1c1c1c }
  ];

  items.forEach((it) => {
    const rect = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.05, 0.01),
      new THREE.MeshStandardMaterial({ color: it.c })
    );
    rect.position.set(it.x, it.y, -4.03);
    rect.castShadow = true;
    group.add(rect);
  });

  return group;
};

const createFurniture1965 = () => {
  const group = new THREE.Group();

  const chairGeometry = new THREE.BoxGeometry(0.4, 0.9, 0.4);
  const chairMaterial = new THREE.MeshStandardMaterial({ color: 0x00acc1 });

  const chair = new THREE.Mesh(chairGeometry, chairMaterial);
  chair.position.set(-2.5, 0.45, -0.2);
  chair.castShadow = true;
  group.add(chair);

  const chair2 = new THREE.Mesh(chairGeometry, chairMaterial);
  chair2.position.set(2.5, 0.45, -0.2);
  chair2.castShadow = true;
  group.add(chair2);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(3, 0.5, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x26a69a })
  );
  base.position.y = 0.05;
  base.castShadow = true;
  group.add(base);

  return group;
};

// ===============================
// 1985 Period Assets
// ===============================

const createCoffeeMachine1985 = () => {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.85, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x26a69a })
  );
  body.position.y = 0.42;
  body.castShadow = true;
  group.add(body);

  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.18, 0.32),
    new THREE.MeshStandardMaterial({ color: 0x212121 })
  );
  panel.position.y = 0.8;
  panel.castShadow = true;
  group.add(panel);

  const display = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.18, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xbf360c })
  );
  display.position.set(0, 0.62, 0.22);
  display.castShadow = true;
  group.add(display);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.05, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x616161 })
  );
  base.position.y = 0.05;
  base.castShadow = true;
  group.add(base);

  return group;
};

const createManualTill1985 = () => {
  const group = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.65, 0.08, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x212121 })
  );
  base.position.y = 0.04;
  base.castShadow = true;
  group.add(base);

  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.65, 0.28, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x455a64 })
  );
  panel.position.y = 0.2;
  panel.castShadow = true;
  group.add(panel);

  const drawer = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.15, 0.28),
    new THREE.MeshStandardMaterial({ color: 0x0d47a1 })
  );
  drawer.position.y = 0.16;
  drawer.castShadow = true;
  group.add(drawer);

  const slot = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.06, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xffd700 })
  );
  slot.position.set(0.17, 0.12, 0.13);
  slot.castShadow = true;
  group.add(slot);

  return group;
};

const createTableware1985 = () => {
  const group = new THREE.Group();

  const plateMaterial = new THREE.MeshStandardMaterial({ color: 0xffe0b2 });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.2), plateMaterial);
  plate.position.y = 0.1;
  plate.castShadow = true;
  group.add(plate);

  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 0.12, 16),
    new THREE.MeshStandardMaterial({ color: 0xff6f00 })
  );
  cup.position.set(-0.15, 0.18, 0.1);
  cup.castShadow = true;
  group.add(cup);

  const saucer = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, 0.15), plateMaterial);
  saucer.position.set(-0.15, 0.08, 0.1);
  saucer.castShadow = true;
  group.add(saucer);

  const base = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.05, 0.25), plateMaterial);
  base.position.y = 0.025;
  base.castShadow = true;
  group.add(base);

  return group;
};

// Boombox / portable cassette player (1985)
const createBoombox1985 = () => {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.75, 0.18, 0.32),
    new THREE.MeshStandardMaterial({ color: 0x0d47a1 })
  );
  body.position.y = 0.12;
  body.castShadow = true;
  group.add(body);

  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.35, 10),
    new THREE.MeshStandardMaterial({ color: 0xc62828 })
  );
  handle.position.set(0, 0.23, 0);
  handle.rotation.z = Math.PI / 2;
  handle.castShadow = true;
  group.add(handle);

  const leftSpeaker = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.12, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x212121 })
  );
  leftSpeaker.position.set(-0.22, 0.1, 0.16);
  leftSpeaker.castShadow = true;
  group.add(leftSpeaker);

  const rightSpeaker = leftSpeaker.clone();
  rightSpeaker.position.set(0.22, 0.1, 0.16);
  group.add(rightSpeaker);

  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.08, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x26a69a })
  );
  screen.position.set(0, 0.12, 0.21);
  screen.castShadow = true;
  group.add(screen);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.05, 0.35),
    new THREE.MeshStandardMaterial({ color: 0x455a64 })
  );
  base.position.y = 0.04;
  base.castShadow = true;
  group.add(base);

  return group;
};

const createPosters1985 = () => {
  const group = new THREE.Group();

  const p1 = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.4, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x00e5ff })
  );
  p1.position.set(-2, 3.5, -4.01);
  p1.castShadow = true;
  group.add(p1);

  const p2 = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.4, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xff00ff })
  );
  p2.position.set(2, 3.5, -4.01);
  p2.castShadow = true;
  group.add(p2);

  return group;
};

const createSignage1985 = () => {
  const group = new THREE.Group();

  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.6, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xff00ff })
  );
  sign.position.set(0, 2.5, -4.025);
  sign.castShadow = true;
  group.add(sign);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.7, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x212121 })
  );
  base.position.y = 0.35;
  base.castShadow = true;
  group.add(base);

  const letterMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff });
  const letter = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.02), letterMat);

  for (const pos of [
    { x: -0.15, y: 2.65, z: -4.03 },
    { x: 0.05, y: 2.65, z: -4.03 },
    { x: 0.25, y: 2.65, z: -4.03 }
  ]) {
    const l = letter.clone();
    l.position.set(pos.x, pos.y, pos.z);
    l.castShadow = true;
    group.add(l);
  }

  return group;
};

const createPatrons1985 = () => {
  const group = new THREE.Group();
  const patronGeometry = new THREE.BoxGeometry(0.3, 1.6, 0.2);
  const materials = [
    new THREE.MeshStandardMaterial({ color: 0xffcc80 }),
    new THREE.MeshStandardMaterial({ color: 0xff80ab }),
    new THREE.MeshStandardMaterial({ color: 0x81d4fa })
  ];

  const p1 = new THREE.Mesh(patronGeometry, materials[0]);
  p1.position.set(-1.2, 0.8, -0.5);
  p1.castShadow = true;
  group.add(p1);

  const p2 = new THREE.Mesh(patronGeometry, materials[1]);
  p2.position.set(1.2, 0.8, -0.5);
  p2.castShadow = true;
  group.add(p2);

  const p3 = new THREE.Mesh(patronGeometry, materials[2]);
  p3.position.set(0, 0.8, 0.5);
  p3.castShadow = true;
  group.add(p3);

  return group;
};

const createMenuBoard1985 = () => {
  const group = new THREE.Group();

  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.8, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x00e5ff })
  );
  board.position.set(0, 1.5, -4.025);
  board.castShadow = true;
  group.add(board);

  const items = [
    { x: -0.1, y: 1.65, c: 0xff00ff },
    { x: -0.1, y: 1.85, c: 0xff6f00 },
    { x: -0.1, y: 2.05, c: 0x212121 }
  ];

  items.forEach((it) => {
    const rect = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.05, 0.01),
      new THREE.MeshStandardMaterial({ color: it.c })
    );
    rect.position.set(it.x, it.y, -4.03);
    rect.castShadow = true;
    group.add(rect);
  });

  return group;
};

const createFurniture1985 = () => {
  const group = new THREE.Group();

  const chairMaterial = new THREE.MeshStandardMaterial({ color: 0x00e5ff });
  const chairGeometry = new THREE.BoxGeometry(0.4, 0.9, 0.4);

  const chair = new THREE.Mesh(chairGeometry, chairMaterial);
  chair.position.set(-2.5, 0.45, -0.2);
  chair.castShadow = true;
  group.add(chair);

  const chair2 = new THREE.Mesh(chairGeometry, chairMaterial);
  chair2.position.set(2.5, 0.45, -0.2);
  chair2.castShadow = true;
  group.add(chair2);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(3, 0.5, 1.2),
    new THREE.MeshStandardMaterial({ color: 0xff00ff })
  );
  base.position.y = 0.05;
  base.castShadow = true;
  group.add(base);

  return group;
};

// ===============================
// 2005 Period Assets (Digital Age)
// ===============================

// iPod (2005 music device)
const createIPod2005 = () => {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.07, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
  );
  body.position.y = 0.08;
  body.castShadow = true;
  group.add(body);

  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.04, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x000000 })
  );
  screen.position.set(0, 0.02, 0.18);
  screen.castShadow = true;
  group.add(screen);

  const wheel = new THREE.Mesh(
    new THREE.CircleGeometry(0.04, 16),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  wheel.position.set(0, 0.02, 0.22);
  wheel.rotation.x = Math.PI / 2;
  wheel.castShadow = true;
  group.add(wheel);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.05, 0.45),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
  );
  base.position.y = 0.01;
  base.castShadow = true;
  group.add(base);

  return group;
};

// 2005 coffee machine (digital espresso unit)
const createCoffeeMachine2005 = () => {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.8, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x4a4a4a })
  );
  body.position.y = 0.4;
  body.castShadow = true;
  group.add(body);

  const display = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.2, 0.15),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
  );
  display.position.y = 0.7;
  display.castShadow = true;
  group.add(display);

  const buttonGeometry = new THREE.BoxGeometry(0.1, 0.05, 0.1);
  const buttonMaterial = new THREE.MeshStandardMaterial({ color: 0x666666 });
  for (const pos of [{ x: -0.2, y: 0.5 }, { x: 0, y: 0.5 }, { x: 0.2, y: 0.5 }]) {
    const button = new THREE.Mesh(buttonGeometry, buttonMaterial);
    button.position.set(pos.x, pos.y, 0.25);
    button.castShadow = true;
    group.add(button);
  }

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.05, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x4a4a4a })
  );
  base.position.y = 0.05;
  base.castShadow = true;
  group.add(base);

  return group;
};

// 2005 digital POS / till
const createDigitalTill2005 = () => {
  const group = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.65, 0.06, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x2f2f2f })
  );
  base.position.y = 0.03;
  base.castShadow = true;
  group.add(base);

  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.65, 0.28, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x333333 })
  );
  panel.position.y = 0.22;
  panel.castShadow = true;
  group.add(panel);

  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.18, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x0f172a })
  );
  screen.position.set(0, 0.3, 0.06);
  screen.castShadow = true;
  group.add(screen);

  const slot = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.04, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xffd700 })
  );
  slot.position.set(0.2, 0.1, 0.16);
  slot.castShadow = true;
  group.add(slot);

  return group;
};

const createTableware2005 = () => {
  const group = new THREE.Group();

  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.02, 0.2),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  plate.position.y = 0.1;
  plate.castShadow = true;
  group.add(plate);

  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.12, 16),
    new THREE.MeshStandardMaterial({ color: 0x4a90e2 })
  );
  cup.position.set(-0.15, 0.18, 0.1);
  cup.castShadow = true;
  group.add(cup);

  const saucer = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.02, 0.15),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  saucer.position.set(-0.15, 0.08, 0.1);
  saucer.castShadow = true;
  group.add(saucer);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.05, 0.25),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  base.position.y = 0.025;
  base.castShadow = true;
  group.add(base);

  return group;
};

// Digital menu board (2005)
const createDigitalMenuBoard2005 = () => {
  const group = new THREE.Group();

  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.8, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x000000 })
  );
  housing.position.set(0, 1.5, -4.025);
  housing.castShadow = true;
  group.add(housing);

  const display = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.7, 0.01),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
  );
  display.position.set(0, 1.5, -4.026);
  display.castShadow = true;
  group.add(display);

  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.04, 0.01),
    new THREE.MeshStandardMaterial({ color: 0x22c55e })
  );
  glow.position.set(0, 1.65, -4.026);
  glow.castShadow = true;
  group.add(glow);

  const items = [0x22c55e, 0x60a5fa, 0xf472b6];
  items.forEach((c, i) => {
    const rect = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.05, 0.01),
      new THREE.MeshStandardMaterial({ color: c })
    );
    rect.position.set(-0.1, 1.85 + i * 0.2, -4.028);
    rect.castShadow = true;
    group.add(rect);
  });

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.9, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x333333 })
  );
  base.position.y = 0.45;
  base.castShadow = true;
  group.add(base);

  return group;
};

const createPosters2005 = () => {
  const group = new THREE.Group();

  const p1 = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.4, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x8b0000 })
  );
  p1.position.set(-2, 3.5, -4.01);
  p1.castShadow = true;
  group.add(p1);

  const p2 = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.4, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x4a90e2 })
  );
  p2.position.set(2, 3.5, -4.01);
  p2.castShadow = true;
  group.add(p2);

  return group;
};

const createSignage2005 = () => {
  const group = new THREE.Group();

  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.6, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xffd700 })
  );
  sign.position.set(0, 2.5, -4.025);
  sign.castShadow = true;
  group.add(sign);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.7, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x2f4f4f })
  );
  base.position.y = 0.35;
  base.castShadow = true;
  group.add(base);

  const letterMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const letter = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.02), letterMat);
  for (const pos of [
    { x: -0.15, y: 2.65, z: -4.03 },
    { x: 0.05, y: 2.65, z: -4.03 },
    { x: 0.25, y: 2.65, z: -4.03 }
  ]) {
    const l = letter.clone();
    l.position.set(pos.x, pos.y, pos.z);
    l.castShadow = true;
    group.add(l);
  }

  return group;
};

const createPatrons2005 = () => {
  const group = new THREE.Group();
  const patronGeometry = new THREE.BoxGeometry(0.3, 1.6, 0.2);
  const materials = [
    new THREE.MeshStandardMaterial({ color: 0xcd853f }),
    new THREE.MeshStandardMaterial({ color: 0x7e57c2 }),
    new THREE.MeshStandardMaterial({ color: 0x42a5f5 })
  ];

  const p1 = new THREE.Mesh(patronGeometry, materials[0]);
  p1.position.set(-1.2, 0.8, -0.5);
  p1.castShadow = true;
  group.add(p1);

  const p2 = new THREE.Mesh(patronGeometry, materials[1]);
  p2.position.set(1.2, 0.8, -0.5);
  p2.castShadow = true;
  group.add(p2);

  const p3 = new THREE.Mesh(patronGeometry, materials[2]);
  p3.position.set(0, 0.8, 0.5);
  p3.castShadow = true;
  group.add(p3);

  return group;
};

const createFurniture2005 = () => {
  const group = new THREE.Group();

  const chairGeometry = new THREE.BoxGeometry(0.4, 0.9, 0.4);
  const chairMaterial = new THREE.MeshStandardMaterial({ color: 0x4a4a4a });

  const chair = new THREE.Mesh(chairGeometry, chairMaterial);
  chair.position.set(-2.5, 0.45, -0.2);
  chair.castShadow = true;
  group.add(chair);

  const chair2 = new THREE.Mesh(chairGeometry, chairMaterial);
  chair2.position.set(2.5, 0.45, -0.2);
  chair2.castShadow = true;
  group.add(chair2);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(3, 0.5, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x6b6b6b })
  );
  base.position.y = 0.05;
  base.castShadow = true;
  group.add(base);

  return group;
};

// ===============================
// 2025 Period Assets (Modern)
// ===============================

const createCoffeeMachine2025 = () => {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.85, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x111827 })
  );
  body.position.y = 0.42;
  body.castShadow = true;
  group.add(body);

  const display = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.22, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x0ea5e9 })
  );
  display.position.y = 0.68;
  display.castShadow = true;
  group.add(display);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.05, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x1f2937 })
  );
  base.position.y = 0.05;
  base.castShadow = true;
  group.add(base);

  return group;
};

const createDigitalTill2025 = () => {
  const group = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.06, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x0f172a })
  );
  base.position.y = 0.03;
  base.castShadow = true;
  group.add(base);

  const stand = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.25, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x111827 })
  );
  stand.position.set(0, 0.2, 0.02);
  stand.castShadow = true;
  group.add(stand);

  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.25, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x22c55e })
  );
  screen.position.set(0, 0.32, 0.08);
  screen.castShadow = true;
  group.add(screen);

  const chip = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.03, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xfbbf24 })
  );
  chip.position.set(0.2, 0.12, 0.15);
  chip.castShadow = true;
  group.add(chip);

  return group;
};

const createTableware2025 = () => {
  const group = new THREE.Group();

  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.02, 0.2),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc })
  );
  plate.position.y = 0.1;
  plate.castShadow = true;
  group.add(plate);

  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.12, 16),
    new THREE.MeshStandardMaterial({ color: 0x22c55e })
  );
  cup.position.set(-0.15, 0.18, 0.1);
  cup.castShadow = true;
  group.add(cup);

  const saucer = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.02, 0.15),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc })
  );
  saucer.position.set(-0.15, 0.08, 0.1);
  saucer.castShadow = true;
  group.add(saucer);

  return group;
};

// Music device (2025): phone/smart speaker stand in
const createPhone2025 = () => {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.2, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x111827 })
  );
  body.position.set(0, 0.1, 0.15);
  body.castShadow = true;
  group.add(body);

  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.11, 0.19, 0.01),
    new THREE.MeshStandardMaterial({ color: 0x0ea5e9 })
  );
  screen.position.set(0, 0.1, 0.16);
  screen.castShadow = true;
  group.add(screen);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.04, 0.15),
    new THREE.MeshStandardMaterial({ color: 0x334155 })
  );
  base.position.set(0, 0.03, 0.1);
  base.castShadow = true;
  group.add(base);

  return group;
};

const createDigitalMenuBoard2025 = () => {
  const group = new THREE.Group();

  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.8, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x0b1220 })
  );
  housing.position.set(0, 1.5, -4.025);
  housing.castShadow = true;
  group.add(housing);

  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.47, 0.7, 0.01),
    new THREE.MeshStandardMaterial({ color: 0x0ea5e9 })
  );
  screen.position.set(0, 1.5, -4.026);
  screen.castShadow = true;
  group.add(screen);

  const items = [0x22c55e, 0x60a5fa, 0xfbbf24];
  items.forEach((c, i) => {
    const rect = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.05, 0.01),
      new THREE.MeshStandardMaterial({ color: c })
    );
    rect.position.set(-0.1, 1.85 + i * 0.2, -4.028);
    rect.castShadow = true;
    group.add(rect);
  });

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.9, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x111827 })
  );
  base.position.y = 0.45;
  base.castShadow = true;
  group.add(base);

  return group;
};

const createPosters2025 = () => {
  const group = new THREE.Group();

  const p1 = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.4, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x22c55e })
  );
  p1.position.set(-2, 3.5, -4.01);
  p1.castShadow = true;
  group.add(p1);

  const p2 = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.4, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x60a5fa })
  );
  p2.position.set(2, 3.5, -4.01);
  p2.castShadow = true;
  group.add(p2);

  return group;
};

const createSignage2025 = () => {
  const group = new THREE.Group();

  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.6, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x0ea5e9 })
  );
  sign.position.set(0, 2.5, -4.025);
  sign.castShadow = true;
  group.add(sign);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.7, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x111827 })
  );
  base.position.y = 0.35;
  base.castShadow = true;
  group.add(base);

  const letterMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc });
  const letter = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.02), letterMat);
  for (const pos of [
    { x: -0.15, y: 2.65, z: -4.03 },
    { x: 0.05, y: 2.65, z: -4.03 },
    { x: 0.25, y: 2.65, z: -4.03 }
  ]) {
    const l = letter.clone();
    l.position.set(pos.x, pos.y, pos.z);
    l.castShadow = true;
    group.add(l);
  }

  return group;
};

const createPatrons2025 = () => {
  const group = new THREE.Group();
  const patronGeometry = new THREE.BoxGeometry(0.3, 1.6, 0.2);
  const materials = [
    new THREE.MeshStandardMaterial({ color: 0x93c5fd }),
    new THREE.MeshStandardMaterial({ color: 0x6ee7b7 }),
    new THREE.MeshStandardMaterial({ color: 0xfca5a5 })
  ];

  const p1 = new THREE.Mesh(patronGeometry, materials[0]);
  p1.position.set(-1.2, 0.8, -0.5);
  p1.castShadow = true;
  group.add(p1);

  const p2 = new THREE.Mesh(patronGeometry, materials[1]);
  p2.position.set(1.2, 0.8, -0.5);
  p2.castShadow = true;
  group.add(p2);

  const p3 = new THREE.Mesh(patronGeometry, materials[2]);
  p3.position.set(0, 0.8, 0.5);
  p3.castShadow = true;
  group.add(p3);

  return group;
};

const createFurniture2025 = () => {
  const group = new THREE.Group();

  const chairMaterial = new THREE.MeshStandardMaterial({ color: 0x111827 });
  const chairGeometry = new THREE.BoxGeometry(0.4, 0.9, 0.4);

  const chair = new THREE.Mesh(chairGeometry, chairMaterial);
  chair.position.set(-2.5, 0.45, -0.2);
  chair.castShadow = true;
  group.add(chair);

  const chair2 = new THREE.Mesh(chairGeometry, chairMaterial);
  chair2.position.set(2.5, 0.45, -0.2);
  chair2.castShadow = true;
  group.add(chair2);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(3, 0.5, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x334155 })
  );
  base.position.y = 0.05;
  base.castShadow = true;
  group.add(base);

  return group;
};

// ===============================
// Add assets to year layers
// ===============================

yearLayers[1945].add(
  createCoffeeMachine1945(),
  createManualTill1945(),
  createTableware1945(),
  createWirelessSet1945(),
  createPosters1945(),
  createSignage1945(),
  createPatrons1945(),
  createMenuBoard1945(),
  createFurniture1945()
);

yearLayers[1965].add(
  createCoffeeMachine1965(),
  createManualTill1965(),
  createTableware1965(),
  createJukebox1965(),
  createPosters1965(),
  createSignage1965(),
  createPatrons1965(),
  createMenuBoard1965(),
  createFurniture1965()
);

yearLayers[1985].add(
  createCoffeeMachine1985(),
  createManualTill1985(),
  createTableware1985(),
  createBoombox1985(),
  createPosters1985(),
  createSignage1985(),
  createPatrons1985(),
  createMenuBoard1985(),
  createFurniture1985()
);

yearLayers[2005].add(
  createCoffeeMachine2005(),
  createDigitalTill2005(),
  createTableware2005(),
  createIPod2005(),
  createPosters2005(),
  createSignage2005(),
  createPatrons2005(),
  createDigitalMenuBoard2005(),
  createFurniture2005()
);

yearLayers[2025].add(
  createCoffeeMachine2025(),
  createDigitalTill2025(),
  createTableware2025(),
  createPhone2025(),
  createPosters2025(),
  createSignage2025(),
  createPatrons2025(),
  createDigitalMenuBoard2025(),
  createFurniture2025()
);

// Light switch indicator (simple)
const lightGroup = new THREE.Group();
const lightBulbGeometry = new THREE.SphereGeometry(0.1, 16, 16);
const lightBulbMaterial = new THREE.MeshStandardMaterial({ color: 0xffd700 });
const lightBulb = new THREE.Mesh(lightBulbGeometry, lightBulbMaterial);
lightBulb.position.set(2, 1.5, 2);
lightBulb.castShadow = true;
lightGroup.add(lightBulb);

const filamentGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8);
const filamentMaterial = new THREE.MeshStandardMaterial({ color: 0xffd700 });
const filament = new THREE.Mesh(filamentGeometry, filamentMaterial);
filament.position.set(0, 0.15, 0);
lightBulb.add(filament);
scene.add(lightGroup);

// Year selection handler
function handleYearSelect(year) {
  // Hide all year layers
  Object.values(yearLayers).forEach(layer => {
    layer.visible = false;
  });

  // Show the selected year layer
  if (yearLayers[year]) {
    yearLayers[year].visible = true;
  }

  // Update the text overlay
  const yearLabels = {
    1945: 'Post-War Era',
    1965: 'Swinging Sixties',
    1985: 'Retro Eighties',
    2005: 'Digital Age',
    2025: 'Modern Times'
  };

  const sceneElement = document.querySelector('.scene');
  if (sceneElement) {
    sceneElement.querySelector('h2').textContent = `Café ${yearLabels[year] || year}`;
    sceneElement.querySelector('p').textContent = `Year: ${year} - Café timelapse transformation active`;
  }

  // Update ARIA pressed states
  document.querySelectorAll('.year-btn').forEach(btn => {
    btn.setAttribute('aria-pressed', String(parseInt(btn.dataset.year, 10) === year));
  });
}

// Add year button event listeners when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const yearButtons = document.querySelectorAll('.year-btn');

    yearButtons.forEach(button => {
      button.addEventListener('click', () => {
        const year = parseInt(button.dataset.year, 10);
        handleYearSelect(year);
      });
    });

    // Initialize with default year (1945)
    handleYearSelect(1945);
  });
} else {
  const yearButtons = document.querySelectorAll('.year-btn');

  yearButtons.forEach(button => {
    button.addEventListener('click', () => {
      const year = parseInt(button.dataset.year, 10);
      handleYearSelect(year);
    });
  });

  // Initialize with default year (1945)
  handleYearSelect(1945);
}

// Animation loop
function animate() {
  requestAnimationFrame(animate);

  // Rotate year layers slowly to show they're separate containers
  Object.values(yearLayers).forEach((layer, i) => {
    layer.rotation.y = i * 0.2 + Date.now() / 1000 / (5 + i);
  });

  renderer.render(scene, camera);
}

// Resize handling
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 1985 Period Assets

// Coffee machine (1985 retro espresso machine/coffee maker)
// Export for integration
export { scene, camera, renderer, yearLayers };
