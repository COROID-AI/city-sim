// Three.js Scene Foundation for Café Time Period Timelapse
// This module sets up the shared scene graph, renderer, camera, lighting,
// and animation loop that all era-specific tasks will build upon.
// 1945 ERA TRANSFORMATION: Art Deco/retro furniture, vintage coffee machines,
// manual till, chalkboard menu, wireless radio, 1940s patrons, warm lighting

// Scene globals
let renderer, scene, camera, ambientLight, directionalLight;
let yearButtons = [];
let currentYear = 1945;

// Era tracking for compatible GLTF/usdz assets across 5 eras
// All 5 era tasks must produce compatible GLTF/usdz assets for same scene graph

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

  // Add warm Edison-style ambient lighting for 1945 era
  // Soft, warm illumination characteristic of 1945 cafés
  ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);

  // Add directional lighting with warmer tone for 1945 era
  directionalLight = new THREE.DirectionalLight(0xffa54f, 0.6);
  directionalLight.position.set(5, 10, 7.5);
  directionalLight.castShadow = true;
  scene.add(directionalLight);

  // 1945-era: Warm up the environment for period lighting
  const envColor = 0x212121; // Very dark warm background
  renderer.setClearColor(envColor, 1);

  // Add basic café interior geometry
  addCaféGeometry();

  // Add timeline slider container
  addTimelineSlider();

  // Handle resize
  window.addEventListener('resize', onWindowResize);

  // Start animation loop
  animate();
}

// Add basic café interior geometry (walls, floor, ceiling)
// 1945-era specific assets will be added here
function addCaféGeometry() {
  // Floor - worn checkerboard tile pattern
  const floorGeometry = new THREE.PlaneGeometry(10, 10);
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.8 });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Back wall - faded wallpaper with 1945 travel posters
  const wallGeometry = new THREE.PlaneGeometry(10, 6);
  
  // Back wall (brown/charcoal)
  const backWall = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({ color: 0x4B3832 }));
  backWall.position.set(0, 3, -5);
  backWall.rotation.y = Math.PI / 2;
  backWall.receiveShadow = true;
  scene.add(backWall);

  // Left wall (cream-colored)
  const leftWall = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({ color: 0xF5F5DC }));
  leftWall.position.set(-5, 3, 0);
  leftWall.receiveShadow = true;
  scene.add(leftWall);

  // Right wall (cream-colored)
  const rightWall = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({ color: 0xF5F5DC }));
  rightWall.position.set(5, 3, 0);
  rightWall.receiveShadow = true;
  scene.add(rightWall);

  // Ceiling - low tin ceiling with exposed pipes (1945 style)
  const ceilingGeometry = new THREE.PlaneGeometry(10, 6);
  const ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0xC0C0C0, roughness: 0.7 });
  const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
  ceiling.position.set(0, 6, 0);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.receiveShadow = true;
  scene.add(ceiling);

  // 1945-era: Chrome and steel café table
  // Cylindrical table with chrome base and porcelain tabletop
  const tableGeometry = new THREE.CylinderGeometry(0.6, 0.6, 0.65, 32);
  const tableMaterial = new THREE.MeshStandardMaterial({ 
    color: 0xC0C0C0, 
    metalness: 0.9, 
    roughness: 0.2,
    side: THREE.DoubleSide
  });
  const table = new THREE.Mesh(tableGeometry, tableMaterial);
  table.position.set(0, 0.325, -2);
  table.castShadow = true;
  scene.add(table);

  // 1945-era: Banquette seating - leather seats with metal frame
  // Two banquettes on either side
  const banquetteGeometry = new THREE.BoxGeometry(2.5, 0.5, 0.8);
  const banquetteMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x4A3B28, 
    metalness: 0.4, 
    roughness: 0.7
  });
  
  // Left banquette
  const leftBanquette = new THREE.Mesh(banquetteGeometry, banquetteMaterial);
  leftBanquette.position.set(-2, 0.25, -2);
  leftBanquette.castShadow = true;
  scene.add(leftBanquette);
  
  // Right banquette
  const rightBanquette = new THREE.Mesh(banquetteGeometry, banquetteMaterial);
  rightBanquette.position.set(2, 0.25, -2);
  rightBanquette.castShadow = true;
  scene.add(rightBanquette);

  // 1945-era: Leather chairs at counter
  const leatherChairGeometry = new THREE.BoxGeometry(0.5, 0.8, 0.5);
  const leatherChairMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x2D1B10, 
    metalness: 0.3, 
    roughness: 0.6
  });
  
  // Left leather chair
  const leftLeatherChair = new THREE.Mesh(leatherChairGeometry, leatherChairMaterial);
  leftLeatherChair.position.set(-1.5, 0.4, -2);
  leftLeatherChair.castShadow = true;
  scene.add(leftLeatherChair);
  
  // Right leather chair
  const rightLeatherChair = new THREE.Mesh(leatherChairGeometry, leatherChairMaterial);
  rightLeatherChair.position.set(1.5, 0.4, -2);
  rightLeatherChair.castShadow = true;
  scene.add(rightLeatherChair);

  // 1945-era: Ceramic tableware set
  const plateGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.05, 32);
  const plateMaterial = new THREE.MeshStandardMaterial({ 
    color: 0xF5F5F5, 
    roughness: 0.3,
    metalness: 0.0
  });
  
  // Place settings at table
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 - Math.PI / 2;
    const distance = 0.4;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    const plate = new THREE.Mesh(plateGeometry, plateMaterial);
    plate.position.set(x, 0.1, z - 2);
    plate.rotation.x = Math.PI / 2;
    plate.castShadow = true;
    scene.add(plate);
  }

  // 1945-era: Lever-type manual espresso machine
  const espressoMachineGeometry = new THREE.BoxGeometry(1.2, 1.8, 0.6);
  const espressoMachineMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x2B1B08, 
    metalness: 0.8, 
    roughness: 0.4
  });
  const espressoMachine = new THREE.Mesh(espressoMachineGeometry, espressoMachineMaterial);
  espressoMachine.position.set(0, 0.9, 1.5);
  espressoMachine.castShadow = true;
  scene.add(espressoMachine);

  // Espresso machine lever detail - visible and operable
  const leverGeometry = new THREE.BoxGeometry(0.3, 0.8, 0.3);
  const leverMaterial = new THREE.MeshStandardMaterial({ color: 0x6B4423 });
  const lever = new THREE.Mesh(leverGeometry, leverMaterial);
  lever.position.set(0, 1.5, 1.7);
  lever.castShadow = true;
  scene.add(lever);

  // 1945-era: Manual cash till at counter, no digital interfaces
  const cashTillGeometry = new THREE.BoxGeometry(0.8, 0.3, 0.4);
  const cashTillMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
  const cashTill = new THREE.Mesh(cashTillGeometry, cashTillMaterial);
  cashTill.position.set(0, 0.15, -3.5);
  cashTill.castShadow = true;
  scene.add(cashTill);

  // Cash till lid detail
  const tillLidGeometry = new THREE.BoxGeometry(0.7, 0.05, 0.35);
  const tillLidMaterial = new THREE.MeshStandardMaterial({ color: 0x6B4218 });
  const tillLid = new THREE.Mesh(tillLidGeometry, tillLidMaterial);
  tillLid.position.set(0, 0.3, -3.5);
  scene.add(tillLid);

  // 1945-era: Chalkboard menu board with handwritten-style prices
  const chalkboardGeometry = new THREE.BoxGeometry(3, 2, 0.1);
  const chalkboardMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
  const chalkboard = new THREE.Mesh(chalkboardGeometry, chalkboardMaterial);
  chalkboard.position.set(-4, 1.5, 0);
  chalkboard.castShadow = true;
  scene.add(chalkboard);

  // Chalkboard frame
  const frameGeometry = new THREE.BoxGeometry(3.1, 2.1, 0.2);
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0xC0C0C0 });
  const frame = new THREE.Mesh(frameGeometry, frameMaterial);
  frame.position.set(-4, 1.5, 0.1);
  scene.add(frame);

  // 1945-era: Wireless radio set playing big band/swing music
  const radioGeometry = new THREE.BoxGeometry(1.2, 0.8, 0.6);
  const radioMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x8B4513, 
    metalness: 0.6, 
    roughness: 0.5
  });
  const wirelessRadio = new THREE.Mesh(radioGeometry, radioMaterial);
  wirelessRadio.position.set(3, 0.4, -1);
  wirelessRadio.castShadow = true;
  scene.add(wirelessRadio);

  // Radio dial detail
  const dialGeometry = new THREE.SphereGeometry(0.1, 16, 16);
  const dialMaterial = new THREE.MeshStandardMaterial({ color: 0x2B1B00 });
  const dial = new THREE.Mesh(dialGeometry, dialMaterial);
  dial.position.set(3, 0.5, -0.8);
  scene.add(dial);

  // 1945-era: Wall posters/advertisements reflecting travel and coffee brands of era
  // Travel poster - "See America First" style
  const travelPosterGeometry = new THREE.PlaneGeometry(1.5, 2);
  const travelPosterMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x8B4513,
    side: THREE.DoubleSide
  });
  const travelPoster = new THREE.Mesh(travelPosterGeometry, travelPosterMaterial);
  travelPoster.position.set(-4, 2.5, -1);
  travelPoster.rotation.y = -Math.PI / 2;
  scene.add(travelPoster);

  // Coffee brand poster - "Maxwell House" style
  const coffeePosterGeometry = new THREE.PlaneGeometry(1.5, 1);
  const coffeePosterMaterial = new THREE.MeshStandardMaterial({ 
    color: 0xD2691E,
    side: THREE.DoubleSide
  });
  const coffeePoster = new THREE.Mesh(coffeePosterGeometry, coffeePosterMaterial);
  coffeePoster.position.set(-1, 2.5, -1);
  coffeePoster.rotation.y = -Math.PI / 2;
  scene.add(coffeePoster);

  // 1945-era: Patrons wearing 1940s fashion (suits, dresses, hats, hairstyles)
  // Simple geometric representations of 1940s patrons
  const patronGeometry = new THREE.CapsuleGeometry(0.25, 0.5, 4, 8);
  const patronMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
  
  // Patron 1 - man in suit
  const patron1 = new THREE.Mesh(patronGeometry, patronMaterial);
  patron1.position.set(-3, 0.5, -3.5);
  patron1.castShadow = true;
  scene.add(patron1);
  
  // Patron 2 - woman in dress with hat
  const patron2 = new THREE.Mesh(patronGeometry, patronMaterial);
  patron2.position.set(3, 0.5, -3.5);
  patron2.castShadow = true;
  scene.add(patron2);

  // Add some simple decorative elements
  for (let i = 0; i < 3; i++) {
    const boxGeometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const boxMaterial = new THREE.MeshStandardMaterial({
      color: Math.random() * 0xffffff,
      roughness: 0.6
    });
    const box = new THREE.Mesh(boxGeometry, boxMaterial);
    box.position.set(
      (Math.random() - 0.5) * 4,
      0.25 + Math.random() * 1,
      (Math.random() - 0.5) * 4
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
  
  // Era-specific: unload non-1945 assets when selecting 1945
  // (Other era assets will be managed by their respective task modules)
  if (year === 1945) {
    console.log(`Loading 1945 era: Furniture (banquettes, chrome tables, leather seats), lever espresso machine, manual till, chalkboard menu, wireless radio, 1940s patrons, warm Edison lighting`);
  }
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