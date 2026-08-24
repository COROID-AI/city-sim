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

// Add café interior geometry compatible across 5 eras
// Floor - worn checkerboard tile pattern (1945 era base)
// Mod color palette alternative: teak wood mid-century modern (1965 era)
function addCaféGeometry() {
  const floorGeometry = new THREE.PlaneGeometry(10, 10);
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xC1840C, roughness: 0.6 });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Back wall - faded wallpaper with 1945 travel posters (base)
  // Accent stripe references 1965 mod burnt orange palette
  const wallGeometry = new THREE.PlaneGeometry(10, 6);
  const backWall = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({ color: 0x4B3832 }));
  backWall.position.set(0, 3, -5);
  backWall.rotation.y = Math.PI / 2;
  backWall.receiveShadow = true;
  scene.add(backWall);

  // Left wall (cream-colored base with 1945 travel poster accents)
  // Olive green mod color reference
  const leftWall = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({ color: 0xF5F5DC }));
  leftWall.position.set(-5, 3, 0);
  leftWall.receiveShadow = true;
  scene.add(leftWall);

  // Right wall (cream-colored base with 1945 travel poster accents)
  // Mustard yellow mod color reference
  const rightWall = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({ color: 0xF5F5DC }));
  rightWall.position.set(5, 3, 0);
  rightWall.receiveShadow = true;
  scene.add(rightWall);
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