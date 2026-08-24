// Three.js Scene Foundation for Café Time Period Timelapse
// This module sets up the shared scene graph, renderer, camera, lighting,
// and animation loop that all era-specific tasks will build upon.

let renderer, scene, camera, ambientLight, directionalLight;
let yearButtons = [];
let currentYear = 1945;

// Initialize the Three.js scene
function initScene() {
  // Create scene
  scene = new THREE.Scene();

  // Create WebGL renderer that fills the viewport
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  document.body.appendChild(renderer.domElement);

  // Create perspective camera positioned for interior navigation
  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, 1.6, 5); // Eye level in café
  camera.lookAt(0, 0, 0);

  // Add ambient lighting
  ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  // Add directional lighting (simulates sunlight/ceiling lights)
  directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(5, 10, 7.5);
  directionalLight.castShadow = true;
  scene.add(directionalLight);

  // Add basic café interior geometry
  addCaféGeometry();

  // Add timeline slider container
  addTimelineSlider();

  // Handle resize
  window.addEventListener('resize', onWindowResize);

  // Start animation loop
  animate();
}

// Add 1965 era café interior geometry (walls, floor, ceiling)
function addCaféGeometry() {
  // Floor - teak wood mid-century modern pattern
  const floorGeometry = new THREE.PlaneGeometry(10, 10);
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xC1840C, roughness: 0.6 });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Walls - mod color palette
  const wallGeometry = new THREE.PlaneGeometry(10, 6);

  // Back wall - burnt orange accent wall
  const backWall = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({ color: 0xFF6B6B }));
  backWall.position.set(0, 3, -5);
  backWall.rotation.y = Math.PI / 2;
  backWall.receiveShadow = true;
  scene.add(backWall);

  // Left wall - olive green (mod color)
  const leftWall = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({ color: 0x5F9EA0 }));
  leftWall.position.set(-5, 3, 0);
  leftWall.receiveShadow = true;
  scene.add(leftWall);

  // Right wall - mustard yellow (mod color)
  const rightWall = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({ color: 0xFADA5E }));
  rightWall.position.set(5, 3, 0);
  rightWall.receiveShadow = true;
  scene.add(rightWall);

  // Ceiling - off-white with neon accent
  const ceilingGeometry = new THREE.PlaneGeometry(10, 6);
  const ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0xF0F0F0, roughness: 0.7 });
  const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
  ceiling.position.set(0, 6, 0);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.receiveShadow = true;
  scene.add(ceiling);

  // Teak dining table (mid-century modern)
  const tableGeometry = new THREE.BoxGeometry(2, 0.7, 1.2);
  const tableMaterial = new THREE.MeshStandardMaterial({ color: 0x8B5A2B, roughness: 0.5 });
  const table = new THREE.Mesh(tableGeometry, tableMaterial);
  table.position.set(0, 0.35, -2);
  table.castShadow = true;
  scene.add(table);

  // Eames-style chairs (mid-century modern)
  // Chair 1
  const chair1Geometry = new THREE.BoxGeometry(0.5, 0.8, 0.5);
  const chair1Material = new THREE.MeshStandardMaterial({ color: 0xF0C040, roughness: 0.7 });
  const chair1 = new THREE.Mesh(chair1Geometry, chair1Material);
  chair1.position.set(-1.8, 0.4, -2);
  scene.add(chair1);

  // Chair 2
  const chair2 = new THREE.Mesh(chair1Geometry, chair1Material);
  chair2.position.set(1.8, 0.4, -2);
  scene.add(chair2);

  // Chair 3
  const chair3 = new THREE.Mesh(chair1Geometry, chair1Material);
  chair3.position.set(-0.8, 0.4, -3);
  scene.add(chair3);

  // Chair 4
  const chair4 = new THREE.Mesh(chair1Geometry, chair1Material);
  chair4.position.set(0.8, 0.4, -3);
  scene.add(chair4);

  // 1960s vinyl jukebox on wall or floor
  const jukeboxGeometry = new THREE.BoxGeometry(1.5, 1.2, 0.8);
  const jukeboxMaterial = new THREE.MeshStandardMaterial({ color: 0x2C3E50, roughness: 0.4 });
  const jukebox = new THREE.Mesh(jukeboxGeometry, jukeboxMaterial);
  jukebox.position.set(3.5, 0.6, -1.5);
  jukebox.castShadow = true;
  scene.add(jukebox);

  // Neon sign with mod color palette
  const neonGeometry = new THREE.PlaneGeometry(2, 0.3);
  const neonMaterial = new THREE.MeshStandardMaterial({ 
    color: 0xFF00FF, 
    emissive: 0xFF00FF, 
    emissiveIntensity: 0.5, 
    roughness: 0.1 
  });
  const neonSign = new THREE.Mesh(neonGeometry, neonMaterial);
  neonSign.position.set(-2.5, 1.2, -4.8);
  scene.add(neonSign);

  // Formica/laminate tableware
  // Plate
  const plateGeometry = new THREE.BoxGeometry(0.3, 0.05, 0.3);
  const plateMaterial = new THREE.MeshStandardMaterial({ color: 0xF5DEB3, roughness: 0.8 });
  const plate1 = new THREE.Mesh(plateGeometry, plateMaterial);
  plate1.position.set(-1.2, 0.15, -1.5);
  scene.add(plate1);

  const plate2 = new THREE.Mesh(plateGeometry, plateMaterial);
  plate2.position.set(1.2, 0.15, -1.5);
  scene.add(plate2);

  // Laminate mugs
  const mugGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.8, 32);
  const mugMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.9 });
  const mug1 = new THREE.Mesh(mugGeometry, mugMaterial);
  mug1.position.set(-0.8, 0.6, -1.5);
  scene.add(mug1);

  const mug2 = new THREE.Mesh(mugGeometry, mugMaterial);
  mug2.position.set(0.8, 0.6, -1.5);
  scene.add(mug2);

  // Psychedelic/modernist posters on walls
  // Back wall poster area
  const posterGeometry = new THREE.PlaneGeometry(1.5, 2);
  const posterMaterial1 = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, transparent: true, opacity: 0.9 });
  const poster1 = new THREE.Mesh(posterGeometry, posterMaterial1);
  poster1.position.set(0, 1.5, -4.9);
  poster1.rotation.y = Math.PI / 2;
  scene.add(poster1);

  // Left wall poster
  const poster2 = new THREE.Mesh(posterGeometry, posterMaterial1.clone());
  poster2.position.set(-4.5, 1.5, 0);
  poster2.rotation.y = Math.PI;
  scene.add(poster2);

  // Right wall poster
  const poster3 = new THREE.Mesh(posterGeometry, posterMaterial1.clone());
  poster3.position.set(4.5, 1.5, 0);
  scene.add(poster3);

  // Menu board with 1965 pricing and typography
  const menuGeometry = new THREE.PlaneGeometry(2, 1.5);
  const menuMaterial = new THREE.MeshStandardMaterial({ color: 0xFFF5E1, roughness: 0.5 });
  const menuBoard = new THREE.Mesh(menuGeometry, menuMaterial);
  menuBoard.position.set(0, 2.5, -5);
  menuBoard.rotation.y = Math.PI / 2;
  scene.add(menuBoard);

  // Formica tableware patterns
  const formicaPlateGeometry = new THREE.BoxGeometry(0.25, 0.04, 0.25);
  const formicaPlateMaterial = new THREE.MeshStandardMaterial({ color: 0xFFF8DC, roughness: 0.7 });
  const formicaPlate = new THREE.Mesh(formicaPlateGeometry, formicaPlateMaterial);
  formicaPlate.position.set(0, 0.1, -1.8);
  scene.add(formicaPlate);

  // Add some decorative items with 1960s patterns
  const patternColors = [0xFADA5E, 0x5F9EA0, 0xFF6B6B, 0x4A90E2];
  for (let i = 0; i < 6; i++) {
    const boxGeometry = new THREE.BoxGeometry(0.35, 0.35, 0.35);
    const boxMaterial = new THREE.MeshStandardMaterial({ color: patternColors[i % patternColors.length], roughness: 0.6 });
    const box = new THREE.Mesh(boxGeometry, boxMaterial);
    box.position.set(
      (Math.random() - 0.5) * 3,
      0.25 + Math.random() * 0.5,
      (Math.random() - 0.5) * 3
    );
    box.castShadow = true;
    scene.add(box);
  }
}

// Add timeline slider at top of viewport
function addTimelineSlider() {
  // Create slider container
  const sliderContainer = document.createElement('div');
  sliderContainer.style.position = 'absolute';
  sliderContainer.style.top = '20px';
  sliderContainer.style.left = '50%';
  sliderContainer.style.transform = 'translateX(-50%)';
  sliderContainer.style.display = 'flex';
  sliderContainer.style.gap = '10px';
  sliderContainer.style.zIndex = '100';

  // Year options
  const years = [1945, 1965, 1985, 2005, 2025];

  years.forEach(year => {
    const button = document.createElement('button');
    button.className = 'year-btn';
    button.innerText = year;
    button.dataset.year = year;
    button.style.padding = '8px 16px';
    button.style.border = '2px solid #8B4513';
    button.style.background = 'transparent';
    button.style.borderRadius = '4px';
    button.style.cursor = 'pointer';
    button.style.fontFamily = 'sans-serif';
    button.style.fontSize = '14px';

    // Highlight current year
    if (year === currentYear) {
      button.style.background = '#8B4513';
      button.style.color = 'white';
    }

    button.addEventListener('click', () => {
      selectYear(parseInt(button.dataset.year));
    });

    sliderContainer.appendChild(button);
    yearButtons.push(button);
  });

  document.body.appendChild(sliderContainer);
}

// Select a specific year - era-specific tasks will extend this
function selectYear(year) {
  currentYear = year;
  // Update button visuals
  yearButtons.forEach(button => {
    if (parseInt(button.dataset.year) === year) {
      button.style.background = '#8B4513';
      button.style.color = 'white';
    } else {
      button.style.background = 'transparent';
      button.style.color = '#8B4513';
    }
  });
  // Era-specific tasks will react to year changes
  console.log(`Year selected: ${year}`);
}

// Handle window resize
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Animation loop
function animate() {
  requestAnimationFrame(animate);

  // Rotate geometry slowly for visual interest
  scene.traverse(object => {
    if (object.isMesh) {
      object.rotation.y += 0.005;
    }
  });

  renderer.render(scene, camera);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initScene);
} else {
  initScene();
}