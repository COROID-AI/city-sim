import * as THREE from 'three';
import { eras, type EraConfig, type BuildingConfig, type VehicleConfig, type StorefrontConfig, type AdvertisementConfig, type PedestrianOutfit } from './eraConfig';

// Scene setup
const scene = new THREE.Scene();

// Perspective camera
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 10, 20);

// WebGL renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// Ground plane (base city block)
const groundGeometry = new THREE.PlaneGeometry(100, 100);
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x2c3e50, side: THREE.DoubleSide });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(10, 20, 10);
scene.add(directionalLight);

// Current era state
let currentEra: EraConfig = eras[0];
let eraMeshes: (THREE.Mesh | THREE.Group)[] = [];

// Building material cache
const buildingMaterials: Map<string, THREE.Material> = new Map();

// Create building based on era config
function createBuilding(config: BuildingConfig, position: THREE.Vector3): THREE.Mesh {
  // Check if we have a cached material for this style
  const materialKey = `${config.style}-${config.materials.join('-')}`;
  let material = buildingMaterials.get(materialKey);

  if (!material) {
    // Create a material based on style and materials
    if (config.style.includes('Art Deco') || config.style.includes('Traditional')) {
      material = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.7 });
    } else if (config.style.includes('Mid-Century Modern')) {
      material = new THREE.MeshStandardMaterial({ color: 0xFF4500, roughness: 0.5 });
    } else if (config.style.includes('Post-Modern')) {
      material = new THREE.MeshStandardMaterial({ color: 0xDA70D6, roughness: 0.6 });
    } else if (config.style.includes('Contemporary')) {
      material = new THREE.MeshStandardMaterial({ color: 0x1E90FF, roughness: 0.4 });
    } else if (config.style.includes('Sustainable/High-Tech')) {
      material = new THREE.MeshStandardMaterial({ color: 0x32CD32, roughness: 0.3 });
    } else {
      material = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.5 });
    }
    buildingMaterials.set(materialKey, material);
  }

  const height = config.height;
  const geometry = new THREE.BoxGeometry(5, height, 5);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.position.y = height / 2;
  return mesh;
}

// Create vehicle based on era config
function createVehicle(config: VehicleConfig, position: THREE.Vector3): THREE.Group {
  const group = new THREE.Group();

  // Create chassis
  const chassisMaterial = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.5 });
  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(3, 1.5, 2),
    chassisMaterial
  );
  chassis.position.y = 0.75;
  group.add(chassis);

  // Add vehicle-specific details based on era
  if (config.types.includes('classic car') || config.types.includes('muscle car')) {
    // Add headlights
    const lightMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const leftLight = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), lightMaterial);
    leftLight.position.set(-1.2, 0.8, 0.8);
    group.add(leftLight);
    const rightLight = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), lightMaterial);
    rightLight.position.set(1.2, 0.8, 0.8);
    group.add(rightLight);
  } else if (config.types.includes('electric') || config.types.includes('autonomous')) {
    // Add futuristic details
    const accentMaterial = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
    const accent = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1, 8), accentMaterial);
    accent.position.y = 0.75;
    group.add(accent);
  }

  group.position.copy(position);
  return group;
}

// Create storefront based on era config
function createStorefront(config: StorefrontConfig, position: THREE.Vector3): THREE.Mesh {
  const materialKey = `${config.architecturalStyle}-${config.materials.join('-')}`;
  let material = buildingMaterials.get(materialKey);

  if (!material) {
    if (config.architecturalStyle.includes('Traditional')) {
      material = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.7 });
    } else if (config.architecturalStyle.includes('Mid-Century Modern')) {
      material = new THREE.MeshStandardMaterial({ color: 0xFF4500, roughness: 0.5 });
    } else if (config.architecturalStyle.includes('Commercial 80s')) {
      material = new THREE.MeshStandardMaterial({ color: 0xDA70D6, roughness: 0.6 });
    } else if (config.architecturalStyle.includes('Early 2000s')) {
      material = new THREE.MeshStandardMaterial({ color: 0x1E90FF, roughness: 0.4 });
    } else if (config.architecturalStyle.includes('Smart Storefront')) {
      material = new THREE.MeshStandardMaterial({ color: 0x32CD32, roughness: 0.3 });
    } else {
      material = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.5 });
    }
    buildingMaterials.set(materialKey, material);
  }

  const width = 8;
  const height = 4;
  const geometry = new THREE.BoxGeometry(width, height, 1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.position.y = height / 2;
  return mesh;
}

// Create advertisement based on era config
function createAdvertisement(config: AdvertisementConfig, position: THREE.Vector3): THREE.Mesh {
  const materialKey = `${config.style}-${config.content.substring(0, 10)}`;
  let material = buildingMaterials.get(materialKey);

  if (!material) {
    if (config.style.includes('Retro')) {
      material = new THREE.MeshStandardMaterial({ color: 0x8B0000, roughness: 0.7 });
    } else if (config.style.includes('Space Age')) {
      material = new THREE.MeshStandardMaterial({ color: 0x00BFFF, roughness: 0.5 });
    } else if (config.style.includes('Neon')) {
      material = new THREE.MeshStandardMaterial({ color: 0xFF1493, roughness: 0.4 });
    } else if (config.style.includes('Digital')) {
      material = new THREE.MeshStandardMaterial({ color: 0x8A2BE2, roughness: 0.3 });
    } else if (config.style.includes('Programmatic/AR')) {
      material = new THREE.MeshStandardMaterial({ color: 0xFFD700, roughness: 0.2 });
    } else {
      material = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.5 });
    }
    buildingMaterials.set(materialKey, material);
  }

  const width = 6;
  const height = 3;
  const geometry = new THREE.BoxGeometry(width, height, 0.5);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.position.y = height / 2 + 2;
  return mesh;
}

// Create pedestrian outfit based on era config
function createPedestrian(config: PedestrianOutfit): THREE.Group {
  const group = new THREE.Group();

  // Create a simple human shape
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xf0e6d2, roughness: 0.8 });
  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 1.5, 0.5),
    skinMaterial
  );
  torso.position.y = 0.75;
  group.add(torso);

  // Add clothing details based on era
  config.clothingStyles.forEach(s => {
    if (s.includes('utility') || s.includes('wartime')) {
      // Military/utility style - add buttons and pockets
      const buttonMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });
      for (let i = 0; i < 6; i++) {
        const button = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), buttonMaterial);
        button.position.set(-0.5 + i * 0.2, 1.0, 0.35);
        group.add(button);
      }
    } else if (s.includes('mod fashion') || s.includes('1960s')) {
      // 1960s mod style - add geometric patterns
      const patternMaterial = new THREE.MeshStandardMaterial({ color: 0x0000ff });
      for (let i = 0; i < 4; i++) {
        const rect = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.05), patternMaterial);
        rect.position.set(-0.6 + i * 0.3, 1.2, 0.3);
        group.add(rect);
      }
    } else if (s.includes('power suit') || s.includes('shoulder')) {
      // 1980s power suit - broad shoulders
      const shoulderMaterial = new THREE.MeshStandardMaterial({ color: 0x8B0000 });
      const leftShoulder = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.1), shoulderMaterial);
      leftShoulder.position.set(-0.4, 1.2, 0.3);
      group.add(leftShoulder);
      const rightShoulder = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.1), shoulderMaterial);
      rightShoulder.position.set(0.4, 1.2, 0.3);
      group.add(rightShoulder);
    } else if (s.includes('early 2000s') || s.includes('denim')) {
      // Early 2000s casual - add casual details
      const detailMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
      const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.05), detailMaterial);
      pocket.position.set(0, 0.8, 0.35);
      group.add(pocket);
    } else if (s.includes('modular') || s.includes('tech-integrated')) {
      // Futuristic - add tech details
      const techMaterial = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
      const techNode = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), techMaterial);
      techNode.position.y = 1.2;
      group.add(techNode);
      // Add circuit pattern
      for (let i = 0; i < 6; i++) {
        const line = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), techMaterial);
        line.position.set(-0.5 + i * 0.2, 1.35, 0.3);
        group.add(line);
      }
    }
  });

  group.position.y = 0.5;
  return group;
}

// Generate a city block based on the current era config
function generateEraBlock(era: EraConfig): void {
  // Clear previous meshes
  eraMeshes.forEach(mesh => {
    if (mesh.parent) {
      mesh.parent.remove(mesh);
    }
  });
  eraMeshes = [];

  const blockSize = 50;
  const spacing = 8;

  // Generate buildings
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const position = new THREE.Vector3(
        i * spacing - blockSize / 2 + spacing / 2,
        0,
        j * spacing - blockSize / 2 + spacing / 2
      );

      // Create building
      const building = createBuilding(era.buildings, position);
      scene.add(building);
      eraMeshes.push(building);

      // Create storefront
      const storefront = createStorefront(era.storefronts, new THREE.Vector3(
        position.x,
        position.y + era.buildings.height + 0.5,
        position.z
      ));
      scene.add(storefront);
      eraMeshes.push(storefront);
    }
  }

  // Generate vehicles (spaced across the block)
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const position = new THREE.Vector3(
        i * spacing * 2 - blockSize / 2 + spacing * 2,
        0,
        j * spacing * 2 - blockSize / 2 + spacing * 2
      );
      const vehicle = createVehicle(era.vehicles, position);
      scene.add(vehicle);
      eraMeshes.push(vehicle);
    }
  }

  // Generate pedestrians
  const pedestrianPositions = [
    new THREE.Vector3(-15, 0, -15),
    new THREE.Vector3(15, 0, -15),
    new THREE.Vector3(-15, 0, 15),
    new THREE.Vector3(15, 0, 15),
  ];

  pedestrianPositions.forEach(pos => {
    const pedestrian = createPedestrian(era.pedestrianOutfits);
    pedestrian.position.copy(pos);
    scene.add(pedestrian);
    eraMeshes.push(pedestrian);
  });

  // Generate advertisements on building faces
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const position = new THREE.Vector3(
        i * spacing * 2 - blockSize / 2 + spacing * 2,
        0,
        j * spacing * 2 - blockSize / 2 + spacing * 2 + 5
      );
      const advert = createAdvertisement(era.advertisements, position);
      scene.add(advert);
      eraMeshes.push(advert);
    }
  }
}

// Initialize with first era
generateEraBlock(currentEra);

// Animation loop
function animate() {
  requestAnimationFrame(animate);

  renderer.render(scene, camera);
}

animate();

// Handle window resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Era switching function - updates the scene without full page reload
function switchEra(eraIndex: number): void {
  if (eraIndex >= 0 && eraIndex < eras.length) {
    currentEra = eras[eraIndex];
    // Update document title or UI indicator
    document.title = `City Timelapse - ${currentEra.name}`;
    // Generate new era block (replacing old meshes)
    generateEraBlock(currentEra);
  }
}

// Expose era switching for UI interaction
(window as any).switchEra = switchEra;
(window as any).eras = eras;
(window as any).currentEraName = currentEra.name;