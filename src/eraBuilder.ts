import * as THREE from 'three';

export interface EraConfig {
  year: number;
  name: string;
  buildingCount: number;
  vehicleCount: number;
  pedestrianCount: number;
  buildingHeightMin: number;
  buildingHeightMax: number;
  buildingColor: number;
  vehicleColor: number;
  pedestrianColor: number;
  billboardCount: number;
}

/**
 * Clears the previous era's objects from the scene.
 * @param scene The Three.js scene
 * @param eraObjects Array of objects belonging to the current era to be removed
 */
function clearEraObjects(scene: THREE.Scene, eraObjects: THREE.Object3D[]): void {
  for (const obj of eraObjects) {
    // Remove from scene
    scene.remove(obj);
    // Dispose geometry and material if available
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
  eraObjects.length = 0; // Clear the array
}

/**
 * Generates a random integer between min (inclusive) and max (inclusive)
 */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generates a random float between min (inclusive) and max (exclusive)
 */
function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/**
 * Builds the city block for the given era.
 * @param scene The Three.js scene to add objects to
 * @param eraConfig Configuration for the era
 * @returns Array of objects created for this era (for later clearing)
 */
export function buildEra(scene: THREE.Scene, eraConfig: EraConfig): THREE.Object3D[] {
  const eraObjects: THREE.Object3D[] = [];

  // Define the city block area (x and z from -50 to 50)
  const blockSize = 50;
  const halfSize = blockSize / 2;

  // Create buildings as simple boxes (extruded shapes)
  for (let i = 0; i < eraConfig.buildingCount; i++) {
    const width = randInt(4, 8);
    const depth = randInt(4, 8);
    const height = randFloat(eraConfig.buildingHeightMin, eraConfig.buildingHeightMax);

    const geometry = new THREE.BoxGeometry(width, height, depth);
    const material = new THREE.MeshStandardMaterial({ color: eraConfig.buildingColor });
    const building = new THREE.Mesh(geometry, material);
    building.castShadow = true;
    building.receiveShadow = true;

    // Position the building on the ground (y = height/2)
    building.position.set(
      randFloat(-halfSize, halfSize),
      height / 2,
      randFloat(-halfSize, halfSize)
    );

    scene.add(building);
    eraObjects.push(building);
  }

  // Create vehicles as simple boxes
  for (let i = 0; i < eraConfig.vehicleCount; i++) {
    const length = randInt(3, 6);
    const width = randInt(2, 4);
    const height = randInt(1, 3);

    const geometry = new THREE.BoxGeometry(length, width, height);
    const material = new THREE.MeshStandardMaterial({ color: eraConfig.vehicleColor });
    const vehicle = new THREE.Mesh(geometry, material);
    vehicle.castShadow = true;
    vehicle.receiveShadow = true;

    // Position the vehicle on the ground (y = height/2)
    vehicle.position.set(
      randFloat(-halfSize, halfSize),
      height / 2,
      randFloat(-halfSize, halfSize)
    );

    // Random rotation
    vehicle.rotation.y = randFloat(0, Math.PI * 2);

    scene.add(vehicle);
    eraObjects.push(vehicle);
  }

  // Create pedestrians as simple capsules (cylinder + sphere) or just boxes for simplicity
  for (let i = 0; i < eraConfig.pedestrianCount; i++) {
    const height = randFloat(1.5, 2.0);
    const width = randFloat(0.5, 0.8);
    const depth = randFloat(0.5, 0.8);

    // Use a group to combine cylinder and sphere for a simple person
    const personGroup = new THREE.Group();

    // Body (cylinder)
    const bodyGeometry = new THREE.CylinderGeometry(width, width, height * 0.8, 8);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: eraConfig.pedestrianColor });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.castShadow = true;
    body.receiveShadow = true;
    body.position.y = height * 0.4; // Adjust for the body's height
    personGroup.add(body);

    // Head (sphere)
    const headGeometry = new THREE.SphereGeometry(width * 0.6, 8, 8);
    const headMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff }); // Simple skin color
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.castShadow = true;
    head.receiveShadow = true;
    head.position.y = height * 0.8 + width * 0.3; // Above the body
    personGroup.add(head);

    // Position the person on the ground
    personGroup.position.set(
      randFloat(-halfSize, halfSize),
      height / 2, // So the bottom touches the ground
      randFloat(-halfSize, halfSize)
    );

    scene.add(personGroup);
    eraObjects.push(personGroup);
  }

  // Create advertisement billboards as simple planes
  for (let i = 0; i < eraConfig.billboardCount; i++) {
    const width = randInt(4, 8);
    const height = randInt(2, 4);

    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshStandardMaterial({
      color: 0xff0000, // Red for advertisement
      side: THREE.DoubleSide
    });
    const billboard = new THREE.Mesh(geometry, material);
    // Billboards typically don't cast shadows but can receive them
    billboard.castShadow = false;
    billboard.receiveShadow = true;

    // Position the billboard vertically (rotated 90 degrees on x-axis) and place it above ground
    billboard.rotation.x = -Math.PI / 2; // Make it face upwards? Actually, we want it vertical facing outward.
    // Let's make it face the camera? For simplicity, we'll rotate it to be vertical and facing outward randomly.
    billboard.rotation.y = randFloat(0, Math.PI * 2); // Random rotation around y-axis
    billboard.position.set(
      randFloat(-halfSize, halfSize),
      randFloat(5, 15), // Above ground
      randFloat(-halfSize, halfSize)
    );

    scene.add(billboard);
    eraObjects.push(billboard);
  }

  // Storefronts: we can add simple rectangles on the sides of buildings facing the street.
  // For simplicity, we'll skip detailed storefronts and just note that they could be added.

  return eraObjects;
}