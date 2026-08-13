import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BloomPass } from 'three/examples/jsm/postprocessing/BloomPass.js';
import { buildEra, EraConfig } from './eraBuilder.js';
import { TimelineSlider } from './timelineSlider.js';
import { audioManager } from './audioManager.js';

// Initialize scene, camera, renderer
const scene = new THREE.Scene();
// We'll set a background color, but it will be overridden by the environment map if loaded
scene.background = new THREE.Color(0x87ceeb); // Sky blue

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Default is PCFShadowMap, but we can use soft
document.body.appendChild(renderer.domElement);

// Create transition overlay for smooth era transitions
const transitionOverlay = document.createElement('div');
transitionOverlay.style.position = 'fixed';
transitionOverlay.style.top = '0';
transitionOverlay.style.left = '0';
transitionOverlay.style.width = '100%';
transitionOverlay.style.height = '100%';
transitionOverlay.style.backgroundColor = 'black';
transitionOverlay.style.opacity = '0';
transitionOverlay.style.pointerEvents = 'none';
transitionOverlay.style.transition = 'opacity 0.5s ease';
document.body.appendChild(transitionOverlay);

// Add OrbitControls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // Smooth controls
controls.dampingFactor = 0.05;

// Enable touch support for OrbitControls by preventing default touch actions on the domElement
(renderer.domElement as HTMLElement).style.touchAction = 'none';

// Add a simple ground plane
const groundGeometry = new THREE.PlaneGeometry(100, 100);
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x4CAF50, side: THREE.DoubleSide });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2; // Rotate to be horizontal
ground.receiveShadow = true; // Important for receiving shadows
scene.add(ground);

// Add a grid helper
const gridHelper = new THREE.GridHelper(100, 10, 0x888888, 0x444444);
scene.add(gridHelper);

// Add some lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(10, 20, 10);
directionalLight.castShadow = true; // Enable shadow casting for the directional light
// Set up shadow properties for the directional light
directionalLight.shadow.mapSize.width = 1024; // default
directionalLight.shadow.mapSize.height = 1024; // default
directionalLight.shadow.camera.near = 0.5; // default
directionalLight.shadow.camera.far = 50; // default
directionalLight.shadow.camera.left = -10;
directionalLight.shadow.camera.right = 10;
directionalLight.shadow.camera.top = 10;
directionalLight.shadow.camera.bottom = -10;
scene.add(directionalLight);

// Load HDRI environment map
new RGBELoader()
  .setPath('https://threejs.org/examples/textures/hdr/')
  .load('pedestrian_bridge_2k.hdr', (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = texture;
    scene.background = null; // Remove the solid background when environment map is loaded
  });

// Era configurations for the slider years: 1945, 1965, 1985, 2005, 2025
const eraConfigs: EraConfig[] = [
  {
    year: 1945,
    name: 'Post-war',
    buildingCount: 20,
    vehicleCount: 5,
    pedestrianCount: 30,
    buildingHeightMin: 10,
    buildingHeightMax: 15,
    buildingColor: 0x8B4513, // SaddleBrown
    vehicleColor: 0x654321, // SaddleBrown for carts
    pedestrianColor: 0xFFE4B5, // Moccasin for clothing
    billboardCount: 2
  },
  {
    year: 1965,
    name: 'Space Age',
    buildingCount: 25,
    vehicleCount: 10,
    pedestrianCount: 40,
    buildingHeightMin: 15,
    buildingHeightMax: 25,
    buildingColor: 0x2F4F4F, // DarkSlateGray
    vehicleColor: 0x000000, // Black
    pedestrianColor: 0x808080, // Gray
    billboardCount: 5
  },
  {
    year: 1985,
    name: 'Digital Dawn',
    buildingCount: 30,
    vehicleCount: 20,
    pedestrianCount: 50,
    buildingHeightMin: 25,
    buildingHeightMax: 35,
    buildingColor: 0xFFFFFF, // White
    vehicleColor: 0xFF0000, // Red
    pedestrianColor: 0x0000FF, // Blue
    billboardCount: 10
  },
  {
    year: 2005,
    name: 'Information Age',
    buildingCount: 35,
    vehicleCount: 25,
    pedestrianCount: 60,
    buildingHeightMin: 30,
    buildingHeightMax: 40,
    buildingColor: 0x00FFFF, // Cyan
    vehicleColor: 0xFFFF00, // Yellow
    pedestrianColor: 0xFF00FF, // Magenta
    billboardCount: 15
  },
  {
    year: 2025,
    name: 'Future',
    buildingCount: 40,
    vehicleCount: 30,
    pedestrianCount: 70,
    buildingHeightMin: 35,
    buildingHeightMax: 45,
    buildingColor: 0xFF00FF, // Magenta
    vehicleColor: 0x00FFFF, // Cyan
    pedestrianColor: 0xFFFF00, // Yellow
    billboardCount: 20
  }
];

// Current era index and objects
let currentEraIndex = 0;
let currentEraObjects: THREE.Object3D[] = [];

// UI element to display current era
const eraDisplay = document.createElement('div');
eraDisplay.style.position = 'absolute';
eraDisplay.style.top = '20px';
eraDisplay.style.left = '20px';
eraDisplay.style.background = 'rgba(0,0,0,0.7)';
eraDisplay.style.color = 'white';
eraDisplay.style.padding = '10px';
eraDisplay.style.borderRadius = '5px';
eraDisplay.style.fontFamily = 'Arial, sans-serif';
eraDisplay.style.zIndex = '1000';
document.body.appendChild(eraDisplay);

// Slider container for era buttons
const sliderContainer = document.createElement('div');
sliderContainer.style.position = 'absolute';
sliderContainer.style.bottom = '20px';
sliderContainer.style.left = '50%';
sliderContainer.style.transform = 'translateX(-50%)';
sliderContainer.style.display = 'flex';
sliderContainer.style.gap = '10px';
sliderContainer.style.zIndex = '1000';
document.body.appendChild(sliderContainer);

// Create buttons for each era
eraConfigs.forEach((config, index) => {
  const button = document.createElement('button');
  button.textContent = `${config.name} (${config.year})`;
  button.style.padding = '8px 16px';
  button.style.fontSize = '14px';
  button.style.cursor = 'pointer';
  button.style.borderRadius = '4px';
  button.style.border = 'none';
  button.style.backgroundColor = index === currentEraIndex ? 'rgba(0,150,255,0.7)' : 'rgba(0,0,0,0.5)';
  button.style.color = 'white';
  button.addEventListener('click', async () => {
    await switchEraWithTransition(index);
    updateButtonStyles(index);
    // Initialize audio manager on first user interaction
    if (!audioManager.isInitialized) {
      await audioManager.initialize();
    }
    // Play era sound
    await audioManager.playEraSound(index);
  });
  sliderContainer.appendChild(button);
});

// Function to update era display
function updateEraDisplay() {
  eraDisplay.textContent = `Era: ${eraConfigs[currentEraIndex].name} (${eraConfigs[currentEraIndex].year})`;
}

// Function to update button styles based on current era
function updateButtonStyles(currentIndex: number) {
  const buttons = sliderContainer.children;
  for (let i = 0; i < buttons.length; i++) {
    const button = buttons[i] as HTMLButtonElement;
    if (i === currentIndex) {
      button.style.backgroundColor = 'rgba(0,150,255,0.7)';
    } else {
      button.style.backgroundColor = 'rgba(0,0,0,0.5)';
    }
  }
}

// Function to clear current era and build new one
function switchEra(newEraIndex: number) {
  // Clear previous era objects
  if (currentEraObjects.length > 0) {
    // We need to pass the scene and the objects to clear
    // Since clearEraObjects is not exported, we'll do it inline here
    for (const obj of currentEraObjects) {
      scene.remove(obj);
      if ((obj as THREE.Mesh).geometry) {
        ((obj as THREE.Mesh).geometry).dispose();
      }
      if ((obj as THREE.Mesh).material) {
        const material = (obj as THREE.Mesh).material;
        if (Array.isArray(material)) {
          material.forEach(m => m.dispose());
        } else {
          material.dispose();
        }
      }
    }
    currentEraObjects = [];
  }

  // Build new era
  currentEraIndex = newEraIndex;
  currentEraObjects = buildEra(scene, eraConfigs[currentEraIndex]);
  updateEraDisplay();
  console.log(`Switched to era: ${eraConfigs[currentEraIndex].name}`);
}

/**
 * Switches era with a smooth fade transition
 * @param newEraIndex Index of the era to switch to
 * @returns Promise that resolves when the transition is complete
 */
async function switchEraWithTransition(newEraIndex: number): Promise<void> {
  // Fade out
  transitionOverlay.style.opacity = '1';

  // Wait for fade out to complete (0.5s)
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      // Switch era while overlay is opaque
      switchEra(newEraIndex);
      // Fade in
      transitionOverlay.style.opacity = '0';
      // Wait for fade in to complete
      setTimeout(() => {
        resolve();
      }, 500);
    }, 500);
  });
}

// Helper function to switch era by year (used by timeline slider)
async function switchEraByYear(year: number): Promise<void> {
  // Find the index of the year in eraConfigs
  const index = eraConfigs.findIndex(config => config.year === year);
  if (index === -1) {
    console.error(`Year ${year} not found in eraConfigs`);
    return; // Resolve immediately to avoid breaking the chain
  }
  await switchEraWithTransition(index);
  updateButtonStyles(index);
}

// Create timeline slider
const timelineSlider = new TimelineSlider({
  onYearSelect: async (year) => {
    try {
      await switchEraByYear(year);
      // Play sound for the new era
      if (audioManager.isInitialized) {
        await audioManager.playEraSound(currentEraIndex);
      }
    } catch (error) {
      console.error('Error switching era:', error);
    }
  },
  initialYear: 1945
});

// Handle window resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Start with the first era (1945)
switchEra(0);
// Initialize button styles
updateButtonStyles(0);

// Initialize audio manager (will be suspended until user interaction)
await audioManager.initialize();
// Play initial era sound
await audioManager.playEraSound(0);

// Optional: automatically cycle through eras every 5 seconds
setInterval(async () => {
  const nextIndex = (currentEraIndex + 1) % eraConfigs.length;
  await switchEraWithTransition(nextIndex);
  updateButtonStyles(nextIndex);
  // Play sound for the new era
  if (audioManager.isInitialized) {
    await audioManager.playEraSound(nextIndex);
  }
}, 5000);

// Set up post-processing
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new BloomPass(
  1.5, // strength
  25,  // kernel size
  4.0  // sigma
);
composer.addPass(bloomPass);

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  controls.update(); // Required if controls.enableDamping = true
  composer.render(); // Use composer to render the scene with post-processing
}

animate();