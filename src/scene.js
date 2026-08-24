// Three.js Scene Foundation for Café Time Period Timelapse
// This module sets up the shared scene graph, renderer, camera, lighting,
// and animation loop that all era-specific tasks will build upon.

let renderer, scene, camera, ambientLight, directionalLight;
let yearButtons = [];
let currentYear = 2005;

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

// Add 2005 era café interior geometry
function addCaféGeometry() {
  // Floor - distressed wood plank pattern (early 2000s café)
  const floorGeometry = new THREE.PlaneGeometry(10, 10);
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.4 });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Walls - neutral off-white with subtle texture
  const wallGeometry = new THREE.PlaneGeometry(10, 6);

  // Back wall - warm off-white
  const backWall = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({ color: 0xF5F5F0, roughness: 0.7 }));
  backWall.position.set(0, 3, -5);
  backWall.rotation.y = Math.PI / 2;
  backWall.receiveShadow = true;
  scene.add(backWall);

  // Left wall - light wood paneling
  const leftWall = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({ color: 0xDEB887, roughness: 0.8 }));
  leftWall.position.set(-5, 3, 0);
  leftWall.receiveShadow = true;
  scene.add(leftWall);

  // Right wall - light wood paneling
  const rightWall = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({ color: 0xDEB887, roughness: 0.8 }));
  rightWall.position.set(5, 3, 0);
  rightWall.receiveShadow = true;
  scene.add(rightWall);

  // Ceiling - soft fluorescent lighting with early LED accents
  const ceilingGeometry = new THREE.PlaneGeometry(10, 6);
  const ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0xF0F0F0, roughness: 0.8 });
  const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
  ceiling.position.set(0, 6, 0);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.receiveShadow = true;
  scene.add(ceiling);

  // Early 2000s café table - mixed wood/metal design
  const tableGeometry = new THREE.BoxGeometry(2, 0.7, 1.2);
  const tableMaterial = new THREE.MeshStandardMaterial({ color: 0xCD853F, roughness: 0.6 });
  const table = new THREE.Mesh(tableGeometry, tableMaterial);
  table.position.set(0, 0.35, -2);
  table.castShadow = true;
  scene.add(table);

  // Casual metal-and-wood chairs
  const chairGeometry = new THREE.BoxGeometry(0.5, 0.8, 0.5);
  const chairMaterial = new THREE.MeshStandardMaterial({ color: 0xA0522D, roughness: 0.7 });
  // Chair 1
  const chair1 = new THREE.Mesh(chairGeometry, chairMaterial);
  chair1.position.set(-1.8, 0.4, -2);
  scene.add(chair1);

  // Chair 2
  const chair2 = new THREE.Mesh(chairGeometry, chairMaterial);
  chair2.position.set(1.8, 0.4, -2);
  scene.add(chair2);

  // Chair 3
  const chair3 = new THREE.Mesh(chairGeometry, chairMaterial);
  chair3.position.set(-0.8, 0.4, -3);
  scene.add(chair3);

  // Chair 4
  const chair4 = new THREE.Mesh(chairGeometry, chairMaterial);
  chair4.position.set(0.8, 0.4, -3);
  scene.add(chair4);

  // Semi-automatic espresso machine with pressure gauge
  const espressoGeometry = new THREE.BoxGeometry(1, 1.5, 0.5);
  const espressoMaterial = new THREE.MeshStandardMaterial({ color: 0x2B1B0C, roughness: 0.5, metalness: 0.7 });
  const espressoMachine = new THREE.Mesh(espressoGeometry, espressoMaterial);
  espressoMachine.position.set(0, 0.75, -3.5);
  espressoMachine.castShadow = true;
  scene.add(espressoMachine);

  // Pressure gauge on espresso machine
  const gaugeGeometry = new THREE.CircleGeometry(0.1, 32);
  const gaugeMaterial = new THREE.MeshStandardMaterial({ color: 0xFF0000, roughness: 0.3, metalness: 0.9 });
  const gauge = new THREE.Mesh(gaugeGeometry, gaugeMaterial);
  gauge.position.set(0.3, 1.2, -3.5);
  gauge.rotation.x = Math.PI / 2;
  scene.add(gauge);

  // iPod docking station with visible iPod
  const dockingGeometry = new THREE.BoxGeometry(0.8, 0.3, 0.2);
  const dockingMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.6 });
  const dockingStation = new THREE.Mesh(dockingGeometry, dockingMaterial);
  dockingStation.position.set(2, 0.15, -2.5);
  dockingStation.castShadow = true;
  scene.add(dockingStation);

  // Visible iPod on docking station
  const ipodGeometry = new THREE.BoxGeometry(0.12, 0.06, 0.08);
  const ipodMaterial = new THREE.MeshStandardMaterial({ color: 0x1A1A1A, roughness: 0.9 });
  const ipod = new THREE.Mesh(ipodGeometry, ipodMaterial);
  ipod.position.set(2, 0.2, -2.5);
  ipod.rotation.z = 0.2;
  scene.add(ipod);

  // Flat-panel digital menu board with 2005 pricing
  const menuGeometry = new THREE.PlaneGeometry(2, 1.5);
  const menuMaterial = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, roughness: 0.3 });
  const menuBoard = new THREE.Mesh(menuGeometry, menuMaterial);
  menuBoard.position.set(0, 2.5, -5);
  menuBoard.rotation.y = Math.PI / 2;
  scene.add(menuBoard);

  // Menu screen displaying 2005 pricing
  const screenGeometry = new THREE.PlaneGeometry(1.8, 1.3);
  const screenMaterial = new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.9 });
  const menuScreen = new THREE.Mesh(screenGeometry, screenMaterial);
  menuScreen.position.set(0, 2.55, -4.9);
  menuScreen.rotation.y = Math.PI / 2;
  scene.add(menuScreen);

  // Wall posters referencing early 2000s technology or coffee culture
  const posterGeometry = new THREE.PlaneGeometry(1.5, 2);
  // Back wall poster - early 2000s coffee culture
  const poster1Material = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, transparent: true, opacity: 0.9 });
  const poster1 = new THREE.Mesh(posterGeometry, poster1Material);
  poster1.position.set(0, 1.5, -4.9);
  poster1.rotation.y = Math.PI / 2;
  scene.add(poster1);

  // Left wall poster - iPod/MP3 technology
  const poster2Material = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, transparent: true, opacity: 0.9 });
  const poster2 = new THREE.Mesh(posterGeometry, poster2Material.clone());
  poster2.position.set(-4.5, 1.5, 0);
  poster2.rotation.y = Math.PI;
  scene.add(poster2);

  // Right wall poster - early 2000s cell phone technology
  const poster3Material = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, transparent: true, opacity: 0.9 });
  const poster3 = new THREE.Mesh(posterGeometry, poster3Material.clone());
  poster3.position.set(4.5, 1.5, 0);
  poster3.rotation.y = Math.PI;
  scene.add(poster3);

  // Tableware with early 2000s ceramic/glass styling
  // Ceramic plate
  const plateGeometry = new THREE.BoxGeometry(0.3, 0.05, 0.3);
  const plateMaterial = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, roughness: 0.8 });
  const plate1 = new THREE.Mesh(plateGeometry, plateMaterial);
  plate1.position.set(0, 0.1, -1.8);
  scene.add(plate1);

  // Ceramic mugs
  const mugGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.8, 32);
  const mugMaterial = new THREE.MeshStandardMaterial({ color: 0xF0E68C, roughness: 0.7 });
  const mug1 = new THREE.Mesh(mugGeometry, mugMaterial);
  mug1.position.set(-1, 0.15, -1.5);
  scene.add(mug1);

  const mug2 = new THREE.Mesh(mugGeometry, mugMaterial);
  mug2.position.set(1, 0.15, -1.5);
  scene.add(mug2);

  // Glass water glasses
  const glassGeometry = new THREE.CylinderGeometry(0.1, 0.15, 0.6, 32);
  const glassMaterial = new THREE.MeshStandardMaterial({ color: 0xE0E0F8, transparent: true, opacity: 0.8, roughness: 0.3 });
  const glass1 = new THREE.Mesh(glassGeometry, glassMaterial);
  glass1.position.set(-0.5, 0.3, -1.8);
  scene.add(glass1);

  const glass2 = new THREE.Mesh(glassGeometry, glassMaterial);
  glass2.position.set(0.5, 0.3, -1.8);
  scene.add(glass2);

  // Early 2000s decorative items - MP3 players, coffee bean displays
  const decorativeColors = [0xFF6B6B, 0x4ECDC4, 0x444444, 0xFFD700];
  for (let i = 0; i < 8; i++) {
    const boxGeometry = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    const boxMaterial = new THREE.MeshStandardMaterial({ color: decorativeColors[i % decorativeColors.length], roughness: 0.6 });
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

  // Year options - 2005 era exclusively loaded
  const years = [2005];

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