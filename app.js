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

// Year-layer containers already added to scene above

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