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
  2025: new THREE.Group()  // Modern Times
};

// Add all year layers to the scene
Object.values(yearLayers).forEach(layer => {
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

// Table
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
scene.add(table1, table2);

// === 1945 Period Assets ===

// Coffee machine (vintage 1945 espresso machine)
const createCoffeeMachine1945 = () => {
  const group = new THREE.Group();

  // Main body
  const bodyGeometry = new THREE.BoxGeometry(0.6, 0.8, 0.4);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 0.4;
  body.castShadow = true;
  group.add(body);

  // Control panel
  const panelGeometry = new THREE.BoxGeometry(0.6, 0.15, 0.3);
  const panelMaterial = new THREE.MeshStandardMaterial({ color: 0x5d4037 });
  const panel = new THREE.Mesh(panelGeometry, panelMaterial);
  panel.position.y = 0.75;
  panel.castShadow = true;
  group.add(panel);

  // Steam pipe
  const pipeGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8);
  const pipeMaterial = new THREE.MeshStandardMaterial({ color: 0xbfbfbf });
  const pipe = new THREE.Mesh(pipeGeometry, pipeMaterial);
  pipe.position.set(0.2, 0.9, 0.15);
  pipe.rotation.x = Math.PI / 2;
  pipe.castShadow = true;
  group.add(pipe);

  // Group base
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

  // Till top
  const tillTopGeometry = new THREE.BoxGeometry(0.5, 0.1, 0.3);
  const tillTopMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
  const tillTop = new THREE.Mesh(tillTopGeometry, tillTopMaterial);
  tillTop.position.y = 0.05;
  tillTop.castShadow = true;
  group.add(tillTop);

  // Till front panel
  const panelGeometry = new THREE.BoxGeometry(0.5, 0.3, 0.02);
  const panelMaterial = new THREE.MeshStandardMaterial({ color: 0x5d4037 });
  const panel = new THREE.Mesh(panelGeometry, panelMaterial);
  panel.position.y = 0.2;
  panel.castShadow = true;
  group.add(panel);

  // Cash drawer
  const drawerGeometry = new THREE.BoxGeometry(0.45, 0.15, 0.25);
  const drawerMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4226 });
  const drawer = new THREE.Mesh(drawerGeometry, drawerMaterial);
  drawer.position.y = 0.2;
  drawer.castShadow = true;
  group.add(drawer);

  // Coin slot
  const coinSlotGeometry = new THREE.BoxGeometry(0.1, 0.05, 0.02);
  const coinSlotMaterial = new THREE.MeshStandardMaterial({ color: 0xcd7f32 });
  const coinSlot = new THREE.Mesh(coinSlotGeometry, coinSlotMaterial);
  coinSlot.position.set(0.15, 0.12, 0.13);
  coinSlot.castShadow = true;
  group.add(coinSlot);

  // Group base
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

  // Plate
  const plateGeometry = new THREE.BoxGeometry(0.2, 0.02, 0.2);
  const plateMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const plate = new THREE.Mesh(plateGeometry, plateMaterial);
  plate.position.y = 0.1;
  plate.castShadow = true;
  group.add(plate);

  // Cup
  const cupGeometry = new THREE.CylinderGeometry(0.08, 0.08, 0.12, 16);
  const cupMaterial = new THREE.MeshStandardMaterial({ color: 0xffa500 });
  const cup = new THREE.Mesh(cupGeometry, cupMaterial);
  cup.position.set(-0.15, 0.18, 0.1);
  cup.castShadow = true;
  group.add(cup);

  // Saucer
  const saucerGeometry = new THREE.BoxGeometry(0.15, 0.02, 0.15);
  const saucer = new THREE.Mesh(saucerGeometry, plateMaterial);
  saucer.position.set(-0.15, 0.08, 0.1);
  saucer.castShadow = true;
  group.add(saucer);

  // Group base
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

  // Radio body
  const bodyGeometry = new THREE.BoxGeometry(0.5, 0.25, 0.3);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x2f4f4f });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 0.15;
  body.castShadow = true;
  group.add(body);

  // Speaker grille
  const grilleGeometry = new THREE.BoxGeometry(0.45, 0.05, 0.25);
  const grilleMaterial = new THREE.MeshStandardMaterial({ color: 0x2f4f4f });
  const grille = new THREE.Mesh(grilleGeometry, grilleMaterial);
  grille.position.y = 0.28;
  grille.castShadow = true;
  group.add(grille);

  // Tuning dial
  const dialGeometry = new THREE.SphereGeometry(0.08, 16, 16);
  const dialMaterial = new THREE.MeshStandardMaterial({ color: 0xffd700 });
  const dial = new THREE.Mesh(dialGeometry, dialMaterial);
  dial.position.set(-0.2, 0.18, 0.12);
  dial.castShadow = true;
  group.add(dial);

  // Antenna
  const antennaGeometry = new THREE.CylinderGeometry(0.01, 0.02, 0.5, 8);
  const antennaMaterial = new THREE.MeshStandardMaterial({ color: 0xffd700 });
  const antenna = new THREE.Mesh(antennaGeometry, antennaMaterial);
  antenna.position.set(0.22, 0.35, 0);
  antenna.rotation.x = Math.PI / 2;
  antenna.castShadow = true;
  group.add(antenna);

  // Group base
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

  // Poster 1 - War bonds
  const poster1Geometry = new THREE.BoxGeometry(0.3, 0.4, 0.02);
  const poster1Material = new THREE.MeshStandardMaterial({ color: 0x8b0000 });
  const poster1 = new THREE.Mesh(poster1Geometry, poster1Material);
  poster1.position.set(-2, 3.5, -4.01);
  poster1.castShadow = true;
  group.add(poster1);

  // Poster 2 - Coffee advertisement
  const poster2Geometry = new THREE.BoxGeometry(0.3, 0.4, 0.02);
  const poster2Material = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
  const poster2 = new THREE.Mesh(poster2Geometry, poster2Material);
  poster2.position.set(2, 3.5, -4.01);
  poster2.castShadow = true;
  group.add(poster2);

  // Group base
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

  // Sign board
  const signGeometry = new THREE.BoxGeometry(0.4, 0.6, 0.05);
  const signMaterial = new THREE.MeshStandardMaterial({ color: 0xffd700 });
  const sign = new THREE.Mesh(signGeometry, signMaterial);
  sign.position.set(0, 2.5, -4.025);
  sign.castShadow = true;
  group.add(sign);

  // "CAFE" letters
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

  // Group base
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

  // Patron 1
  const patron1Geometry = new THREE.BoxGeometry(0.3, 1.6, 0.2);
  const patron1Material = new THREE.MeshStandardMaterial({ color: 0xcd853f });
  const patron1 = new THREE.Mesh(patron1Geometry, patron1Material);
  patron1.position.set(-1.2, 0.8, -0.5);
  patron1.castShadow = true;
  group.add(patron1);

  // Patron 2
  const patron2Geometry = new THREE.BoxGeometry(0.3, 1.6, 0.2);
  const patron2 = new THREE.Mesh(patron2Geometry, patron2Material);
  patron2.position.set(1.2, 0.8, -0.5);
  patron2.castShadow = true;
  group.add(patron2);

  // Patron 3
  const patron3Geometry = new THREE.BoxGeometry(0.3, 1.6, 0.2);
  const patron3 = new THREE.Mesh(patron3Geometry, patron1Material);
  patron3.position.set(0, 0.8, 0.5);
  patron3.castShadow = true;
  group.add(patron3);

  // Group base
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

  // Menu board background
  const boardGeometry = new THREE.BoxGeometry(0.5, 0.8, 0.02);
  const boardMaterial = new THREE.MeshStandardMaterial({ color: 0xffd700 });
  const board = new THREE.Mesh(boardGeometry, boardMaterial);
  board.position.set(0, 1.5, -4.025);
  board.castShadow = true;
  group.add(board);

  // Menu items (simple text representations as rectangles)
  const menuItems = [
    { text: "COFFEE", x: -0.1, y: 1.65 },
    { text: "CAKE", x: -0.1, y: 1.85 },
    { text: "SANDWICH", x: -0.1, y: 2.05 }
  ];

  // In a real implementation, these would be text sprites
  // For now, use colored rectangles as placeholders
  menuItems.forEach((item, i) => {
    const itemGeometry = new THREE.BoxGeometry(0.3, 0.05, 0.01);
    const itemMaterial = new THREE.MeshStandardMaterial({ color: i === 0 ? 0x8b4513 : i === 1 ? 0xffa500 : 0x2f4f4f });
    const itemRect = new THREE.Mesh(itemGeometry, itemMaterial);
    itemRect.position.set(item.x, item.y, -4.03);
    itemRect.castShadow = true;
    group.add(itemRect);
  });

  // Group base
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

  // Chair
  const chairGeometry = new THREE.BoxGeometry(0.4, 0.9, 0.4);
  const chairMaterial = new THREE.MeshStandardMaterial({ color: 0x8b7355 });
  const chair = new THREE.Mesh(chairGeometry, chairMaterial);
  chair.position.set(-2.5, 0.45, -0.2);
  chair.castShadow = true;
  group.add(chair);

  // Second chair
  const chair2 = new THREE.Mesh(chairGeometry, chairMaterial);
  chair2.position.set(2.5, 0.45, -0.2);
  chair2.castShadow = true;
  group.add(chair2);

  // Small table
  const smallTableGeometry = new THREE.BoxGeometry(0.5, 0.05, 0.5);
  const smallTableMaterial = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
  const smallTable = new THREE.Mesh(smallTableGeometry, smallTableMaterial);
  smallTable.position.set(0, 0.25, 0.6);
  smallTable.castShadow = true;
  group.add(smallTable);

  // Group base
  const baseGeometry = new THREE.BoxGeometry(3, 0.5, 1.2);
  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = 0.05;
  base.castShadow = true;
  group.add(base);

  return group;
};

// Add 1945 period assets to the year layer
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

// Add 1965 period assets to the year layer
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

// Add 1965 period assets to the year layer
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

// Light switch indicator (simple)
const lightGroup = new THREE.Group();
const lightBulbGeometry = new THREE.SphereGeometry(0.1, 16, 16);
const lightBulbMaterial = new THREE.MeshStandardMaterial({ color: 0xffd700 });
const lightBulb = new THREE.Mesh(lightBulbGeometry, lightBulbMaterial);
lightBulb.position.set(2, 1.5, 2);
lightBulb.castShadow = true;
lightGroup.add(lightBulb);

// Light filament
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

// Start animation
animate();

// Initialize application state integration
appState.scene = renderer.domElement;
appState.sceneContext = {
  scene,
  camera,
  renderer,
  yearLayers
};

// Export for integration
export { scene, camera, renderer, yearLayers };