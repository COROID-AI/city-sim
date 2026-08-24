// Three.js Scene Foundation for Café Time Period Timelapse
// This module sets up the shared scene graph, renderer, camera, lighting,
// and animation loop that all era-specific tasks will build upon.
// 1945 ERA TRANSFORMATION: Art Deco/retro furniture, vintage coffee machines,
// manual till, chalkboard menu, wireless radio, 1940s patrons, warm lighting

// Scene globals
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

  // --- Lighting (merged from both conflict sides) ---
  // Warm Edison-style ambient (1945)
  ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);

  // Pastel neon ambient (retro/1980s)
  const pastelAmbient = new THREE.AmbientLight(0xffe8f0, 0.8);
  scene.add(pastelAmbient);

  // Warm directional (1945)
  directionalLight = new THREE.DirectionalLight(0xffa54f, 0.6);
  directionalLight.position.set(5, 10, 7.5);
  directionalLight.castShadow = true;
  scene.add(directionalLight);

  // Neon hue directional (1980s)
  const neonDirectional = new THREE.DirectionalLight(0xff6b6b, 0.8);
  neonDirectional.position.set(-5, 10, -7.5);
  neonDirectional.castShadow = false;
  scene.add(neonDirectional);

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
    glow.position.set(
      (Math.random() - 0.5) * 4,
      1 + Math.random() * 2,
      (Math.random() - 0.5) * 4
    );
    scene.add(glow);
  }

  // Warm dark background (merged from both conflict sides)
  const envColor = 0x212121;
  renderer.setClearColor(envColor, 1);

  addCaféGeometry();
  addTimelineSlider();

  // Handle resize
  window.addEventListener('resize', onWindowResize);

  // Start animation loop
  animate();
}

// Add café interior geometry compatible across 5 eras
// Add café interior geometry compatible across 5 eras
function addCaféGeometry() {
  // Floor
  const floorGeometry = new THREE.PlaneGeometry(10, 10);
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x8B4513,
    roughness: 0.4
  });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Checkerboard inset (1945 language)
  const checkerTileGeometry = new THREE.BoxGeometry(1, 0.02, 1);
  const checkerColors = [0x111111, 0x1a1a1a];
  for (let ix = 0; ix < 10; ix++) {
    for (let iz = 0; iz < 10; iz++) {
      const tile = new THREE.Mesh(
        checkerTileGeometry,
        new THREE.MeshStandardMaterial({
          color: checkerColors[(ix + iz) % checkerColors.length],
          roughness: 0.35,
          metalness: 0.05
        })
      );
      tile.position.set(ix - 4.5 + 0.5, 0.025, iz - 4.5 + 0.5);
      scene.add(tile);
    }
  }

  // Memphis-style rectangles (1985 language)
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
    rect.rotation.z = (Math.random() * Math.PI) / 2;
    scene.add(rect);
  }

  // Walls
  const wallGeometry = new THREE.PlaneGeometry(10, 6);

  const backWall = new THREE.Mesh(
    wallGeometry,
    new THREE.MeshStandardMaterial({ color: 0xF5F5F0, roughness: 0.7 })
  );
  backWall.position.set(0, 3, -5);
  backWall.rotation.y = Math.PI / 2;
  backWall.receiveShadow = true;
  scene.add(backWall);

  const backPatternColors = [0xff00ff, 0x00ffff, 0xffa500];
  for (let i = 0; i < 20; i++) {
    const panelGeometry = new THREE.BoxGeometry(
      0.8 + Math.random() * 1.2,
      2 + Math.random() * 1,
      0.1
    );
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
    panel.rotation.z = (Math.random() * Math.PI) / 4;
    scene.add(panel);
  }

  const leftWall = new THREE.Mesh(
    wallGeometry,
    new THREE.MeshStandardMaterial({ color: 0xDEB887, roughness: 0.8 })
  );
  leftWall.position.set(-5, 3, 0);
  leftWall.receiveShadow = true;
  scene.add(leftWall);

  const leftAccentColors = [0x4169e1, 0x00ffff];
  for (let i = 0; i < 10; i++) {
    const panelGeometry = new THREE.BoxGeometry(0.4 + Math.random() * 0.6, 1.2 + Math.random() * 1.5, 0.08);
    const panelMaterial = new THREE.MeshStandardMaterial({
      color: leftAccentColors[Math.floor(Math.random() * leftAccentColors.length)],
      roughness: 0.7
    });
    const panel = new THREE.Mesh(panelGeometry, panelMaterial);
    panel.position.set(
      -4.55,
      1 + Math.random() * 3.0,
      (Math.random() - 0.5) * 3
    );
    scene.add(panel);
  }

  const rightWall = new THREE.Mesh(
    wallGeometry,
    new THREE.MeshStandardMaterial({ color: 0xDEB887, roughness: 0.8 })
  );
  rightWall.position.set(5, 3, 0);
  rightWall.receiveShadow = true;
  scene.add(rightWall);

  const rightAccent = new THREE.Mesh(
    wallGeometry,
    new THREE.MeshStandardMaterial({
      color: 0xffa500,
      emissive: 0xffa500,
      emissiveIntensity: 0.1,
      roughness: 0.65
    })
  );
  rightAccent.position.set(5.01, 3, 0);
  scene.add(rightAccent);

  // Ceiling
  const ceilingGeometry = new THREE.PlaneGeometry(10, 6);
  const ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0xF0F0F0, roughness: 0.8 });
  const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
  ceiling.position.set(0, 6, 0);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.receiveShadow = true;
  scene.add(ceiling);

  // Neon tubes (1985 language)
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

  // --- Furniture + props (merged) ---

  // 2005 era table + chairs
  const tableGeometry = new THREE.BoxGeometry(2, 0.7, 1.2);
  const tableMaterial = new THREE.MeshStandardMaterial({ color: 0xCD853F, roughness: 0.6 });
  const table = new THREE.Mesh(tableGeometry, tableMaterial);
  table.position.set(0, 0.35, -2);
  table.castShadow = true;
  scene.add(table);

  const chairGeometry = new THREE.BoxGeometry(0.5, 0.8, 0.5);
  const chairMaterial = new THREE.MeshStandardMaterial({ color: 0xA0522D, roughness: 0.7 });
  const chairPositions = [
    [-1.8, 0.4, -2],
    [1.8, 0.4, -2],
    [-0.8, 0.4, -3],
    [0.8, 0.4, -3]
  ];
  for (const [x,y,z] of chairPositions) {
    const chair = new THREE.Mesh(chairGeometry, chairMaterial);
    chair.position.set(x,y,z);
    scene.add(chair);
  }

  // Espresso machine (2000s)
  const espressoGeometry = new THREE.BoxGeometry(1, 1.5, 0.5);
  const espressoMaterial = new THREE.MeshStandardMaterial({ color: 0x2B1B0C, roughness: 0.5, metalness: 0.7 });
  const espressoMachine = new THREE.Mesh(espressoGeometry, espressoMaterial);
  espressoMachine.position.set(0, 0.75, -3.5);
  espressoMachine.castShadow = true;
  scene.add(espressoMachine);

  const gaugeGeometry = new THREE.CircleGeometry(0.1, 32);
  const gaugeMaterial = new THREE.MeshStandardMaterial({ color: 0xFF0000, roughness: 0.3, metalness: 0.9 });
  const gauge = new THREE.Mesh(gaugeGeometry, gaugeMaterial);
  gauge.position.set(0.3, 1.2, -3.5);
  gauge.rotation.x = Math.PI / 2;
  scene.add(gauge);

  // iPod docking (2000s)
  const dockingGeometry = new THREE.BoxGeometry(0.8, 0.3, 0.2);
  const dockingMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.6 });
  const dockingStation = new THREE.Mesh(dockingGeometry, dockingMaterial);
  dockingStation.position.set(2, 0.15, -2.5);
  dockingStation.castShadow = true;
  scene.add(dockingStation);

  const ipodGeometry = new THREE.BoxGeometry(0.12, 0.06, 0.08);
  const ipodMaterial = new THREE.MeshStandardMaterial({ color: 0x1A1A1A, roughness: 0.9 });
  const ipod = new THREE.Mesh(ipodGeometry, ipodMaterial);
  ipod.position.set(2, 0.2, -2.5);
  ipod.rotation.z = 0.2;
  scene.add(ipod);

  // 1980s sofa + armchairs
  const sofaGeometry = new THREE.BoxGeometry(3, 0.6, 2.5);
  const sofaMaterial = new THREE.MeshStandardMaterial({ color: 0xff69b4, roughness: 0.9 });
  const sofa = new THREE.Mesh(sofaGeometry, sofaMaterial);
  sofa.position.set(0, 0.3, -4);
  sofa.castShadow = true;
  scene.add(sofa);

  const armchairGeometry = new THREE.BoxGeometry(0.8, 0.6, 0.7);
  const armchairMaterial = new THREE.MeshStandardMaterial({ color: 0x1e90ff, roughness: 0.9 });
  const armchair1 = new THREE.Mesh(armchairGeometry, armchairMaterial);
  armchair1.position.set(-2.5, 0.3, -3);
  scene.add(armchair1);
  const armchair2 = new THREE.Mesh(armchairGeometry, armchairMaterial);
  armchair2.position.set(2.5, 0.3, -3);
  scene.add(armchair2);

  // Boombox (1980s)
  const boomboxGeometry = new THREE.BoxGeometry(2, 1, 1.5);
  const boomboxMaterial = new THREE.MeshStandardMaterial({ color: 0x4169e1, roughness: 0.7 });
  const boombox = new THREE.Mesh(boomboxGeometry, boomboxMaterial);
  boombox.position.set(-3.5, 0.5, -1);
  boombox.castShadow = true;
  scene.add(boombox);

  // Cassette deck
  const cassetteGeometry = new THREE.BoxGeometry(0.8, 0.2, 0.5);
  const cassetteMaterial = new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.8 });
  const cassette1 = new THREE.Mesh(cassetteGeometry, cassetteMaterial);
  cassette1.position.set(-3.2, 0.7, -0.8);
  scene.add(cassette1);
  const cassette2 = new THREE.Mesh(cassetteGeometry, cassetteMaterial);
  cassette2.position.set(-2.8, 0.7, -0.8);
  scene.add(cassette2);

  // Menu board + posters (digital + coffee culture merged)
  const menuGeometry = new THREE.PlaneGeometry(2, 1.5);
  const menuMaterial = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, roughness: 0.3 });
  const menuBoard = new THREE.Mesh(menuGeometry, menuMaterial);
  menuBoard.position.set(0, 2.5, -5);
  menuBoard.rotation.y = Math.PI / 2;
  scene.add(menuBoard);

  const menuScreenGeometry = new THREE.PlaneGeometry(1.8, 1.3);
  const menuScreenMaterial = new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.9 });
  const menuScreen = new THREE.Mesh(menuScreenGeometry, menuScreenMaterial);
  menuScreen.position.set(0, 2.55, -4.9);
  menuScreen.rotation.y = Math.PI / 2;
  scene.add(menuScreen);

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

  const posterGeometry = new THREE.PlaneGeometry(1.5, 2);
  const posterMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, transparent: true, opacity: 0.9 });

  const poster1 = new THREE.Mesh(posterGeometry, posterMaterial);
  poster1.position.set(0, 1.5, -4.9);
  poster1.rotation.y = Math.PI / 2;
  scene.add(poster1);

  const poster2 = new THREE.Mesh(posterGeometry, posterMaterial.clone());
  poster2.position.set(-4.5, 1.5, 0);
  poster2.rotation.y = Math.PI;
  scene.add(poster2);

  const poster3 = new THREE.Mesh(posterGeometry, posterMaterial.clone());
  poster3.position.set(4.5, 1.5, 0);
  poster3.rotation.y = Math.PI;
  scene.add(poster3);

  // Tableware (merged)
  const plateGeometry = new THREE.BoxGeometry(0.3, 0.05, 0.3);
  const plateMaterial = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, roughness: 0.8 });
  const plate1 = new THREE.Mesh(plateGeometry, plateMaterial);
  plate1.position.set(0, 0.1, -1.8);
  scene.add(plate1);

  const mugGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.8, 32);
  const mugMaterial = new THREE.MeshStandardMaterial({ color: 0xF0E68C, roughness: 0.7 });
  const mug1 = new THREE.Mesh(mugGeometry, mugMaterial);
  mug1.position.set(-1, 0.15, -1.5);
  scene.add(mug1);
  const mug2 = new THREE.Mesh(mugGeometry, mugMaterial);
  mug2.position.set(1, 0.15, -1.5);
  scene.add(mug2);

  const glassGeometry = new THREE.CylinderGeometry(0.1, 0.15, 0.6, 32);
  const glassMaterial = new THREE.MeshStandardMaterial({ color: 0xE0E0F8, transparent: true, opacity: 0.8, roughness: 0.3 });
  const glass1 = new THREE.Mesh(glassGeometry, glassMaterial);
  glass1.position.set(-0.5, 0.3, -1.8);
  scene.add(glass1);
  const glass2 = new THREE.Mesh(glassGeometry, glassMaterial);
  glass2.position.set(0.5, 0.3, -1.8);
  scene.add(glass2);

  // Decorative items
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

// Add timeline slider container
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

// Start animation loop
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
