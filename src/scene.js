// Three.js Scene Foundation for Café Time Period Timelapse
// This module sets up the shared scene graph, renderer, camera, lighting,
// and animation loop that all era-specific tasks will build upon.
// 1945 ERA TRANSFORMATION: Art Deco/retro furniture, vintage coffee machines,
// manual till, chalkboard menu, wireless radio, 1940s patrons, warm lighting

// Scene globals
let renderer, scene, camera, ambientLight, directionalLight;
let yearButtons = [];
let currentYear = 1985;

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
function addCaféGeometry() {
  // Floor
  const floorGeometry = new THREE.PlaneGeometry(10, 10);
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x0a0a0a,
    roughness: 0.3,
    metalness: 0.7
  });

  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Base checkerboard tile pattern (from the 1945 side)
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

  // Additional Memphis Group style floor rectangles (from the 1985 side)
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

  // Back wall base color (1945 side)
  const backWall = new THREE.Mesh(
    wallGeometry,
    new THREE.MeshStandardMaterial({
      color: 0x4b3832,
      roughness: 0.7
    })
  );
  backWall.position.set(0, 3, -5);
  backWall.rotation.y = Math.PI / 2;
  backWall.receiveShadow = true;
  scene.add(backWall);

  // Back wall geometric panels (1985 side)
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

  // Left wall base color (1945 side)
  const leftWall = new THREE.Mesh(
    wallGeometry,
    new THREE.MeshStandardMaterial({ color: 0xf5f5dc })
  );
  leftWall.position.set(-5, 3, 0);
  leftWall.receiveShadow = true;
  scene.add(leftWall);

  // Add subtle left-wall accent panels (to merge the 1985 side color language)
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

  // Right wall base color (1945 side)
  const rightWall = new THREE.Mesh(
    wallGeometry,
    new THREE.MeshStandardMaterial({ color: 0xf5f5dc })
  );
  rightWall.position.set(5, 3, 0);
  rightWall.receiveShadow = true;
  scene.add(rightWall);

  // Right-wall orange accent band (1985 side)
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
  const ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.7 });
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

  // 1985 era furniture & props (preserve lane contents)
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
    color: 0x8b4513,
    roughness: 0.6
  });
  const patron1 = new THREE.Mesh(patron1Geometry, patron1Material);
  patron1.position.set(-2, 0.6, -2);
  patron1.castShadow = true;
  scene.add(patron1);

  // Patron 2 - big hair (sphere), leg warmers
  const patron2Geometry = new THREE.SphereGeometry(0.3, 16, 16);
  const patron2Material = new THREE.MeshStandardMaterial({
    color: 0xff69b4,
    emissive: 0xff69b4,
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
  // Plate
  const plateGeometry = new THREE.BoxGeometry(0.3, 0.04, 0.3);
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

  // Posters
  const posterGeometry = new THREE.PlaneGeometry(1.5, 2);
  const posterMaterial1 = new THREE.MeshStandardMaterial({
    color: 0x1a1a2e,
    transparent: true,
    opacity: 0.9
  });

  const poster1 = new THREE.Mesh(posterGeometry, posterMaterial1);
  poster1.position.set(0, 1.5, -4.9);
  poster1.rotation.y = Math.PI / 2;
  scene.add(poster1);

  const poster2 = new THREE.Mesh(posterGeometry, posterMaterial1.clone());
  poster2.position.set(-4.5, 1.5, 0);
  poster2.rotation.y = Math.PI;
  scene.add(poster2);

  const poster3 = new THREE.Mesh(posterGeometry, posterMaterial1.clone());
  poster3.position.set(4.5, 1.5, 0);
  poster3.rotation.y = Math.PI;
  scene.add(poster3);

  // Menu board
  const menuGeometry = new THREE.PlaneGeometry(2, 1.5);
  const menuMaterial = new THREE.MeshStandardMaterial({ color: 0xfff5e1, roughness: 0.5 });
  const menuBoard = new THREE.Mesh(menuGeometry, menuMaterial);
  menuBoard.position.set(0, 2.5, -5);
  menuBoard.rotation.y = Math.PI / 2;
  scene.add(menuBoard);

  // Digital pricing elements on menu board
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
  const formicaPlateMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff8dc,
    roughness: 0.7
  });
  const formicaPlate = new THREE.Mesh(formicaPlateGeometry, formicaPlateMaterial);
  formicaPlate.position.set(0, 0.1, -1.8);
  scene.add(formicaPlate);

  // Decorative items with Memphis Group patterns
  const memphisColors = [0xff00ff, 0x00ffff, 0xffa500, 0x4169e1, 0x8b4513, 0xf0e68c];
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

// Add timeline slider container
function addTimelineSlider() {
  // Timeline slider implementation
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
