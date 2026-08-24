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

// Add basic café interior geometry (walls, floor, ceiling)
function addCaféGeometry() {
  // Floor
  const floorGeometry = new THREE.PlaneGeometry(10, 10);
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.8 });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Walls - simple rectangular room
  const wallGeometry = new THREE.PlaneGeometry(10, 6);

  // Back wall (brown)
  const backWall = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({ color: 0x8B0000 }));
  backWall.position.set(0, 3, -5);
  backWall.rotation.y = Math.PI / 2;
  backWall.receiveShadow = true;
  scene.add(backWall);

  // Left wall (blue-gray)
  const leftWall = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({ color: 0x4682B4 }));
  leftWall.position.set(-5, 3, 0);
  leftWall.receiveShadow = true;
  scene.add(leftWall);

  // Right wall (blue-gray)
  const rightWall = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({ color: 0x4682B4 }));
  rightWall.position.set(5, 3, 0);
  rightWall.receiveShadow = true;
  scene.add(rightWall);

  // Ceiling
  const ceilingGeometry = new THREE.PlaneGeometry(10, 6);
  const ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0xD3D3D3, roughness: 0.7 });
  const ceiling = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
  ceiling.position.set(0, 6, 0);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.receiveShadow = true;
  scene.add(ceiling);

  // Table
  const tableGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.7, 32);
  const tableMaterial = new THREE.MeshStandardMaterial({ color: 0xDEB887 });
  const table = new THREE.Mesh(tableGeometry, tableMaterial);
  table.position.set(0, 0.35, -2);
  table.castShadow = true;
  scene.add(table);

  // Chair
  const chairGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.8, 32);
  const chairMaterial = new THREE.MeshStandardMaterial({ color: 0xCD853F });
  const chair = new THREE.Mesh(chairGeometry, chairMaterial);
  chair.position.set(-1.5, 0.4, -2);
  scene.add(chair);

  // Add some simple boxes for decorations
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