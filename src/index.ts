import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildEra, EraConfig } from './eraBuilder.js';

// Initialize scene, camera, renderer
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // Sky blue

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Add OrbitControls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // Smooth controls
controls.dampingFactor = 0.05;

// Add a simple ground plane
const groundGeometry = new THREE.PlaneGeometry(100, 100);
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x4CAF50, side: THREE.DoubleSide });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2; // Rotate to be horizontal
scene.add(ground);

// Add a grid helper
const gridHelper = new THREE.GridHelper(100, 10, 0x888888, 0x444444);
scene.add(gridHelper);

// Add some lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(10, 20, 10);
scene.add(directionalLight);

// Era configurations
const eraConfigs: EraConfig[] = [
  {
    year: 1400,
    name: 'Medieval',
    buildingCount: 20,
    vehicleCount: 5,
    pedestrianCount: 30,
    buildingHeightMin: 5,
    buildingHeightMax: 15,
    buildingColor: 0x8B4513, // SaddleBrown
    vehicleColor: 0x654321, // SaddleBrown for carts
    pedestrianColor: 0xFFE4B5, // Moccasin for clothing
    billboardCount: 2
  },
  {
    year: 1900,
    name: 'Industrial',
    buildingCount: 25,
    vehicleCount: 10,
    pedestrianCount: 40,
    buildingHeightMin: 10,
    buildingHeightMax: 30,
    buildingColor: 0x2F4F4F, // DarkSlateGray
    vehicleColor: 0x000000, // Black
    pedestrianColor: 0x808080, // Gray
    billboardCount: 5
  },
  {
    year: 2020,
    name: 'Modern',
    buildingCount: 30,
    vehicleCount: 20,
    pedestrianCount: 50,
    buildingHeightMin: 15,
    buildingHeightMax: 60,
    buildingColor: 0xFFFFFF, // White
    vehicleColor: 0xFF0000, // Red
    pedestrianColor: 0x0000FF, // Blue
    billboardCount: 10
  },
  {
    year: 2100,
    name: 'Futuristic',
    buildingCount: 35,
    vehicleCount: 25,
    pedestrianCount: 60,
    buildingHeightMin: 20,
    buildingHeightMax: 100,
    buildingColor: 0x00FFFF, // Cyan
    vehicleColor: 0xFFFF00, // Yellow
    pedestrianColor: 0xFF00FF, // Magenta
    billboardCount: 15
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
  button.addEventListener('click', () => {
    switchEra(index);
    updateButtonStyles(index);
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

// Handle window resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Start with the first era
switchEra(0);
// Initialize button styles
updateButtonStyles(0);

// Optional: automatically cycle through eras every 5 seconds
setInterval(() => {
  const nextIndex = (currentEraIndex + 1) % eraConfigs.length;
  switchEra(nextIndex);
  updateButtonStyles(nextIndex);
}, 5000);

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  controls.update(); // Required if controls.enableDamping = true
  renderer.render(scene, camera);
}

animate();