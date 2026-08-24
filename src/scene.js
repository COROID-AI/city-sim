// Three.js Scene Foundation for Café Time Period Timelapse
// This module sets up the shared scene graph, renderer, camera, lighting,
// and animation loop that all era-specific tasks will build upon.

let renderer, scene, camera, ambientLight, directionalLight;
let yearButtons = [];
let currentYear = 1985;

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

  // Add ambient lighting with pastel glow
  ambientLight = new THREE.AmbientLight(0xffe8f0, 0.8);
  scene.add(ambientLight);

  // Add directional lighting with neon hue
  directionalLight = new THREE.DirectionalLight(0xff6b6b, 0.8);
  directionalLight.position.set(5, 10, 7.5);
  directionalLight.castShadow = true;
  scene.add(directionalLight);

  // Neon strip lighting along ceiling
  const neonStripGeometry = new THREE.PlaneGeometry(10, 0.2);
  const neonStripMaterial = new THREE.MeshStandardMaterial({
    color: 0xff00ff,
    emissive: 0xff00ff,
    emissiveIntensity: 0.6,
    roughness: 0.1
  });
  const neonStrip = new THREE.Mesh(neonStripGeometry, neonStripMaterial);
  neonStrip.position.set(0, 6.1, 0);
  neonStrip.rotation.x = -Math.PI / 2;
  scene.add(neonStrip);

  // Glow-in-the-dark accent spheres
  const glowGeometry = new THREE.SphereGeometry(0.3, 16, 16);
  const glowColors = [0x00ffff, 0xff00ff, 0xffff00];
  for (let i = 0; i < 6; i++) {
    const glow = new THREE.Mesh(glowGeometry, new THREE.MeshStandardMaterial({
      color: glowColors[i % glowColors.length],
      emissive: glowColors[i % glowColors.length],
      emissiveIntensity: 1.2,
      transparent: true,
      opacity: 0.8,
      roughness: 0.1
    }));
    glow.position.set((Math.random() - 0.5) * 4, 1 + Math.random() * 2, (Math.random() - 0.5) * 4);
    scene.add(glow);
  }

  // Add 1985 era café interior geometry
  addCaféGeometry();

  // Add timeline slider container
  addTimelineSlider();

  // Handle resize
  window.addEventListener('resize', onWindowResize);

  // Start animation loop
  animate();
}

// Add 1985 era café interior geometry (walls, floor, ceiling)
function addCaféGeometry() {
  // Floor - black terrazzo with Memphis Group pattern
  const floorGeometry = new THREE.PlaneGeometry(10, 10);
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x0A0A0A,
    roughness: 0.3,
    metalness: 0.7
  });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Floor pattern - Memphis Group style rectangles
  const patternColors = [0xff00ff, 0x00ffff, 0xffa500, 0x4169e1];
  for (let i = 0; i < 50; i++) {
    const rectGeometry = new THREE.BoxGeometry(1 + Math.random() * 2, 0.1, 1 + Math.random() * 2);
    const rectMaterial = new THREE.MeshStandardMaterial({
      color: patternColors[Math.floor(Math.random() * patternColors.length)],
      roughness: 0.4
    });
    const rect = new THREE.Mesh(rectGeometry, rectMaterial);
    rect.position.set(
      (Math.random() - 0.5) * 4,
      0.05 + Math.random() * 0.2,
      (Math.random() - 0.5) * 4
    );
    rect.rotation.z = Math.random() * Math.PI / 2;
    scene.add(rect);
  }

  // Walls - Memphis Group inspired patterns with bold colors
  const wallGeometry = new THREE.PlaneGeometry(10, 6);

  // Back wall - hot pink accent wall with geometric pattern
  const backWallPatternColors = [0xff00ff, 0x00ffff, 0xffa500];
  const backWallMaterial = new THREE.MeshStandardMaterial({
    color: 0xff6b6b,
    emissive: 0xff00ff,
    emissiveIntensity: 0.3,
    roughness: 0.6
  });
  const backWall = new THREE.Mesh(wallGeometry, backWallMaterial);
  backWall.position.set(0, 3, -5);
  backWall.rotation.y = Math.PI / 2;
  backWall.receiveShadow = true;
  scene.add(backWall);

  // Add geometric wall panels on back wall
  for (let i = 0; i < 20; i++) {
    const panelGeometry = new THREE.BoxGeometry(0.8 + Math.random() * 1.2, 2 + Math.random() * 1, 0.1);
    const panelMaterial = new THREE.MeshStandardMaterial({
      color: backPatternColors[Math.floor(Math.random() * backPatternColors.length)],
      roughness: 0.7
    });
    const panel = new THREE.Mesh(panelGeometry, panelMaterial);
    panel.position.set(
      (Math.random() - 0.5) * 3,
      1 + Math.random() * 2,
      -4.55
    );
    panel.rotation.z = Math.random() * Math.PI / 4;
    scene.add(panel);
  }

  // Left wall - teal with Memphis Group elements
  const leftWallMaterial = new THREE.MeshStandardMaterial({
    color: 0x4169e1,
    roughness: 0.7
  });
  const leftWall = new THREE.Mesh(wallGeometry, leftWallMaterial);
  leftWall.position.set(-5, 3, 0);
  leftWall.receiveShadow = true;
  scene.add(leftWall);

  // Right wall - orange with Memphis Group elements
  const rightWallMaterial = new THREE.MeshStandardMaterial({
    color: 0xffa500,
    roughness: 0.7
  });
  const rightWall = new THREE.Mesh(wallGeometry, rightWallMaterial);
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

  // Neon tubes along ceiling perimeter
  const neonTubeGeometry = new THREE.BoxGeometry(0.2, 0.05, 10);
  const neonTubeMaterial = new THREE.MeshStandardMaterial({
    color: 0x00ffff,
    emissive: 0x00ffff,
    emissiveIntensity: 0.4,
    roughness: 0.1
  });
  const neonTube1 = new THREE.Mesh(neonTubeGeometry, neonTubeMaterial);
  neonTube1.position.set(-2, 6.1, -2);
  scene.add(neonTube1);
  const neonTube2 = new THREE.Mesh(neonTubeGeometry, neonTubeMaterial);
  neonTube2.position.set(2, 6.1, -2);
  scene.add(neonTube2);

  // 1985 era curved sofa (plastic/vinyl)
  const sofaGeometry = new THREE.BoxGeometry(3, 0.6, 2.5);
  const sofaMaterial = new THREE.MeshStandardMaterial({
    color: 0xff69b4,
    roughness: 0.9
  });
  const sofa = new THREE.Mesh(sofaGeometry, sofaMaterial);
  sofa.position.set(0, 0.3, -4);
  sofa.castShadow = true;
  scene.add(sofa);

  // 1985 era curved armchair
  const armchairGeometry = new THREE.BoxGeometry(0.8, 0.6, 0.7);
  const armchairMaterial = new THREE.MeshStandardMaterial({
    color: 0x1e90ff,
    roughness: 0.9
  });
  const armchair1 = new THREE.Mesh(armchairGeometry, armchairMaterial);
  armchair1.position.set(-2.5, 0.3, -3);
  scene.add(armchair1);
  const armchair2 = new THREE.Mesh(armchairGeometry, armchairMaterial);
  armchair2.position.set(2.5, 0.3, -3);
  scene.add(armchair2);

  // 1985 era coffee table - glass with bold base
  const coffeeTableGeometry = new THREE.BoxGeometry(1.5, 0.5, 1.5);
  const coffeeTableMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.8
  });
  const coffeeTableBaseGeometry = new THREE.BoxGeometry(1.2, 0.3, 1.2);
  const coffeeTableBase = new THREE.Mesh(coffeeTableBaseGeometry, coffeeTableMaterial);
  coffeeTableBase.position.set(0, 0.15, -1.5);
  coffeeTableBase.castShadow = true;
  scene.add(coffeeTableBase);
  const coffeeTable = new THREE.Mesh(coffeeTableGeometry, coffeeTableMaterial);
  coffeeTable.position.set(0, 0.4, -1.5);
  coffeeTable.castShadow = true;
  scene.add(coffeeTable);

  // 1980s digital espresso machine
  const espressoMachineGeometry = new THREE.BoxGeometry(1, 1.5, 0.5);
  const espressoMachineMaterial = new THREE.MeshStandardMaterial({
    color: 0x2c3e50,
    roughness: 0.5
  });
  const espressoMachine = new THREE.Mesh(espressoMachineGeometry, espressoMachineMaterial);
  espressoMachine.position.set(3, 0.75, -1.5);
  espressoMachine.castShadow = true;
  scene.add(espressoMachine);

  // Digital display panels on espresso machine
  const displayGeometry = new THREE.BoxGeometry(0.6, 0.2, 0.1);
  const displayMaterial = new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: 0x00ff00,
    emissiveIntensity: 0.8
  });
  const display1 = new THREE.Mesh(displayGeometry, displayMaterial);
  display1.position.set(3.2, 1.2, -1.35);
  scene.add(display1);
  const display2 = new THREE.Mesh(displayGeometry, displayMaterial);
  display2.position.set(3.2, 1.0, -1.35);
  scene.add(display2);
  const display3 = new THREE.Mesh(displayGeometry, displayMaterial);
  display3.position.set(3.2, 0.8, -1.35);
  scene.add(display3);

  // Boombox with 1980s aesthetics
  const boomboxGeometry = new THREE.BoxGeometry(2, 1, 1.5);
  const boomboxMaterial = new THREE.MeshStandardMaterial({
    color: 0x4169e1,
    roughness: 0.7
  });
  const boombox = new THREE.Mesh(boomboxGeometry, boomboxMaterial);
  boombox.position.set(-3.5, 0.5, -1);
  boombox.castShadow = true;
  scene.add(boombox);

  // Cassette tape deck on top
  const cassetteGeometry = new THREE.BoxGeometry(0.8, 0.2, 0.5);
  const cassetteMaterial = new THREE.MeshStandardMaterial({
    color: 0x2c3e50,
    roughness: 0.8
  });
  const cassette1 = new THREE.Mesh(cassetteGeometry, cassetteMaterial);
  cassette1.position.set(-3.2, 0.7, -0.8);
  scene.add(cassette1);
  const cassette2 = new THREE.Mesh(cassetteGeometry, cassetteMaterial);
  cassette2.position.set(-2.8, 0.7, -0.8);
  scene.add(cassette2);

  // Speaker grilles
  const grilleGeometry = new THREE.BoxGeometry(0.1, 0.3, 0.8);
  const grilleMaterial = new THREE.MeshStandardMaterial({
    color: 0x000000
  });
  const grille1 = new THREE.Mesh(grilleGeometry, grilleMaterial);
  grille1.position.set(-3.6, 0.5, -1.1);
  scene.add(grille1);
  const grille2 = new THREE.Mesh(grilleGeometry, grilleMaterial);
  grille2.position.set(-3.0, 0.5, -1.1);
  scene.add(grille2);

  // 1980s patrons seating at tables
  // Patron 1 - shoulder pads, members-only jacket
  const patron1Geometry = new THREE.BoxGeometry(0.5, 1.2, 0.5);
  const patron1Material = new THREE.MeshStandardMaterial({
    color: 0x8B4513,
    roughness: 0.6
  });
  const patron1 = new THREE.Mesh(patron1Geometry, patron1Material);
  patron1.position.set(-2, 0.6, -2);
  patron1.castShadow = true;
  scene.add(patron1);

  // Patron 2 - big hair (sphere), leg warmers
  const patron2Geometry = new THREE.SphereGeometry(0.3, 16, 16);
  const patron2Material = new THREE.MeshStandardMaterial({
    color: 0xFF69B4,
    emissive: 0xFF69B4,
    emissiveIntensity: 0.5
  });
  const patron2Head = new THREE.Mesh(patron2Geometry, patron2Material);
  patron2Head.position.set(2, 1.2, -2);
  scene.add(patron2Head);
  const patron2BodyGeometry = new THREE.BoxGeometry(0.4, 0.8, 0.4);
  const patron2Body = new THREE.Mesh(patron2BodyGeometry, patron2Material);
  patron2Body.position.set(2, 0.4, -2);
  scene.add(patron2Body);

  // Patron 3 - leg warmers
  const patron3Geometry = new THREE.BoxGeometry(0.5, 1.0, 0.5);
  const patron3Material = new THREE.MeshStandardMaterial({
    color: 0x1e90ff,
    roughness: 0.6
  });
  const patron3 = new THREE.Mesh(patron3Geometry, patron3Material);
  patron3.position.set(0, 0.5, -2);
  patron3.castShadow = true;
  scene.add(patron3);

  // Patron 4 - members-only jacket
  const patron4 = new THREE.Mesh(patron1Geometry, patron1Material);
  patron4.position.set(2, 0.6, -2);
  patron4.castShadow = true;
  scene.add(patron4);

  // Tableware - 1980s glass/ceramic styling with bold patterns
  // Plate with bold pattern
  const plateGeometry = new THREE.BoxGeometry(0.3, 0.04, 0.3);
  const platePatternColors = [0xff00ff, 0x00ffff, 0xffa500, 0x4169e1];
  const plateMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.3
  });
  const plate1 = new THREE.Mesh(plateGeometry, plateMaterial);
  plate1.position.set(-1.2, 0.15, -1.5);
  scene.add(plate1);
  const plate2 = new THREE.Mesh(plateGeometry, plateMaterial);
  plate2.position.set(1.2, 0.15, -1.5);
  scene.add(plate2);

  // Decorative 1980s bowls
  const bowlGeometry = new THREE.SphereGeometry(0.15, 16, 16);
  const bowlMaterial = new THREE.MeshStandardMaterial({
    color: 0xff69b4,
    roughness: 0.5,
    transparent: true,
    opacity: 0.7
  });
  const bowl1 = new THREE.Mesh(bowlGeometry, bowlMaterial);
  bowl1.position.set(-0.8, 0.2, -1.5);
  scene.add(bowl1);
  const bowl2 = new THREE.Mesh(bowlGeometry, bowlMaterial);
  bowl2.position.set(0.8, 0.2, -1.5);
  scene.add(bowl2);

  // Coffee mugs with 1980s styling
  const mugGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.8, 32);
  const mugMaterial = new THREE.MeshStandardMaterial({
    color: 0x4169e1,
    roughness: 0.7
  });
  const mug1 = new THREE.Mesh(mugGeometry, mugMaterial);
  mug1.position.set(-0.8, 0.6, -1.5);
  scene.add(mug1);
  const mug2 = new THREE.Mesh(mugGeometry, mugMaterial);
  mug2.position.set(0.8, 0.6, -1.5);
  scene.add(mug2);

  // Psychedelic/Memphis Group posters on walls
  // Back wall poster area - techno/futuristic typography
  const posterGeometry = new THREE.PlaneGeometry(1.5, 2);
  const posterMaterial1 = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, transparent: true, opacity: 0.9 });
  const poster1 = new THREE.Mesh(posterGeometry, posterMaterial1);
  poster1.position.set(0, 1.5, -4.9);
  poster1.rotation.y = Math.PI / 2;
  scene.add(poster1);

  // Left wall poster - Memphis Group pattern
  const poster2 = new THREE.Mesh(posterGeometry, posterMaterial1.clone());
  poster2.position.set(-4.5, 1.5, 0);
  poster2.rotation.y = Math.PI;
  scene.add(poster2);

  // Right wall poster - arcade/game theme
  const poster3 = new THREE.Mesh(posterGeometry, posterMaterial1.clone());
  poster3.position.set(4.5, 1.5, 0);
  poster3.rotation.y = Math.PI;
  scene.add(poster3);

  // Menu board with 1985 pricing and techno/futuristic typography
  const menuGeometry = new THREE.PlaneGeometry(2, 1.5);
  const menuMaterial = new THREE.MeshStandardMaterial({ color: 0xFFF5E1, roughness: 0.5 });
  const menuBoard = new THREE.Mesh(menuGeometry, menuMaterial);
  menuBoard.position.set(0, 2.5, -5);
  menuBoard.rotation.y = Math.PI / 2;
  scene.add(menuBoard);

  // Add digital pricing elements on menu board
  const pricingColors = [0xff00ff, 0x00ffff, 0xffa500, 0x4169e1];
  for (let i = 0; i < 8; i++) {
    const pricingGeometry = new THREE.BoxGeometry(0.3, 0.1, 0.1);
    const pricingMaterial = new THREE.MeshStandardMaterial({
      color: pricingColors[i % pricingColors.length],
      roughness: 0.8
    });
    const pricingLabel = new THREE.Mesh(pricingGeometry, pricingMaterial);
    pricingLabel.position.set(
      -0.8 + (i % 4) * 0.4,
      2.2 + Math.floor(i / 4) * 0.2,
      -4.51
    );
    scene.add(pricingLabel);
  }

  // Formica tableware patterns with bold 1980s styling
  const formicaPlateGeometry = new THREE.BoxGeometry(0.25, 0.04, 0.25);
  const formicaPlateMaterial = new THREE.MeshStandardMaterial({ color: 0xFFF8DC, roughness: 0.7 });
  const formicaPlate = new THREE.Mesh(formicaPlateGeometry, formicaPlateMaterial);
  formicaPlate.position.set(0, 0.1, -1.8);
  scene.add(formicaPlate);

  // Decorative items with Memphis Group patterns
  const memphisColors = [0xff00ff, 0x00ffff, 0xffa500, 0x4169e1, 0x8B4513, 0xF0E68C];
  for (let i = 0; i < 8; i++) {
    const boxGeometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const boxMaterial = new THREE.MeshStandardMaterial({
      color: memphisColors[i],
      roughness: 0.6
    });
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