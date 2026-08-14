import * as THREE from 'three';
import { eras, type EraConfig } from '../eraConfig';

// Type definition for era keys since EraKey is not exported from eraConfig
type EraKey = '1945' | '1965' | '1985' | '2005' | '2025';

// Extended era config type with pedestrianDensity
interface EraConfigWithDensity extends EraConfig {
  pedestrianDensity: number;
}

// Period-specific pedestrian outfit definitions with distinct fashion styles
const periodOutfits: Record<string, { clothingStyles: string[]; color: THREE.Color; accessories: THREE.Object3D[] }> = {
  '1945': {
    clothingStyles: ['utility suits', 'wartime dresses', 'military uniforms'],
    color: new THREE.Color(0x8B4513),
    accessories: [],
  },
  '1965': {
    clothingStyles: ['1960s mod fashion', 'shift dresses', 'suits with narrow ties'],
    color: new THREE.Color(0xD2691E),
    accessories: [],
  },
  '1985': {
    clothingStyles: ['power suits', 'shoulder pads', 'leg warmers'],
    color: new THREE.Color(0x8B0000),
    accessories: [],
  },
  '2005': {
    clothingStyles: ['early 2000s casual', 'denim dominant', 'track suits'],
    color: new THREE.Color(0x2F4F4F),
    accessories: [],
  },
  '2025': {
    clothingStyles: ['modular fashion', 'tech-integrated', 'sustainable fabrics'],
    color: new THREE.Color(0x1A1A2E),
    accessories: [],
  },
};

// Pedestrian system managing sidewalk crowd with period-specific styles
export class PedestrianSystem {
  private pedestrians: THREE.Group[] = [];
  private currentPeriod: EraKey = '1945';
  private eraConfig: EraConfigWithDensity;
  private sidewalkWidth: number = 10;
  private sidewalkDepth: number = 2;
  private walkingSpeed: number = 1.5;

  constructor(currentPeriod: EraKey = '1945') {
    this.currentPeriod = currentPeriod;
    // Find the era config matching the period year
    const foundEra = eras.find((e) => e.year === Number(currentPeriod));
    // Type assertion to access pedestrianDensity
    this.eraConfig = foundEra as EraConfigWithDensity;
    this.initializePedestrians();
  }

  /** Get the era config for the current period */
  private getDefaultEraConfig(): EraConfigWithDensity {
    const foundEra = eras.find((e) => e.year === Number(this.currentPeriod));
    return foundEra as EraConfigWithDensity;
  }

  /** Initialize pedestrians for the current period */
  private initializePedestrians(): void {
    if (!this.eraConfig) return;
    const pedestrianCount = Math.floor((this.eraConfig.pedestrianDensity || 1.0) * 20);

    for (let i = 0; i < pedestrianCount; i++) {
      const pedestrian = this.createPedestrian();
      this.pedestrians.push(pedestrian);
    }
  }

  /** Create a single pedestrian with period-appropriate outfit */
  private createPedestrian(): THREE.Group {
    const group = new THREE.Group();

    // Body
    const bodyGeometry = new THREE.CylinderGeometry(0.4, 0.5, 1.8, 12);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: periodOutfits[this.currentPeriod].color,
      roughness: 0.7,
      metalness: 0.1,
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.9;
    group.add(body);

    // Head
    const headGeometry = new THREE.SphereGeometry(0.3, 12, 12);
    const headMaterial = new THREE.MeshStandardMaterial({
      color: periodOutfits[this.currentPeriod].color,
      roughness: 0.8,
    });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 1.7;
    group.add(head);

    // Add period-specific accessories
    this.addPeriodAccessories(group, this.currentPeriod);

    // Position pedestrian on sidewalk
    const x = (Math.random() - 0.5) * this.sidewalkWidth;
    const z = Math.random() * this.sidewalkDepth;
    group.position.set(x, 0, z);

    // Store original rotation for walking animation
    group.userData.originalRotation = 0;

    return group;
  }

  /** Add period-specific accessories to pedestrian */
  private addPeriodAccessories(group: THREE.Group, period: EraKey): void {
    if (period === '1945') {
      // 1945: Military-style caps and gloves
      const capGeometry = new THREE.ConeGeometry(0.15, 0.2, 8);
      const capMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });
      const cap = new THREE.Mesh(capGeometry, capMaterial);
      cap.position.set(0, 1.8, 0.15);
      cap.rotation.z = Math.PI / 2;
      group.add(cap);

      // Gloves
      const gloveGeometry = new THREE.SphereGeometry(0.1, 12, 12);
      const gloveMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });
      const leftGlove = new THREE.Mesh(gloveGeometry, gloveMaterial);
      leftGlove.position.set(-0.3, 0.9, 0.5);
      group.add(leftGlove);
      const rightGlove = new THREE.Mesh(gloveGeometry, gloveMaterial);
      rightGlove.position.set(0.3, 0.9, 0.5);
      group.add(rightGlove);
    } else if (period === '1965') {
      // 1965: Mod fashion accessories - oversized sunglasses
      const sunglassGeometry = new THREE.BoxGeometry(0.4, 0.1, 0.6);
      const sunglassMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });
      const sunglasses = new THREE.Mesh(sunglassGeometry, sunglassMaterial);
      sunglasses.position.set(0, 1.75, 0.2);
      sunglasses.rotation.z = Math.PI / 4;
      group.add(sunglasses);
    } else if (period === '1985') {
      // 1985: Neon sunglasses and earrings
      const neonGeometry = new THREE.BoxGeometry(0.3, 0.05, 0.4);
      const neonMaterial = new THREE.MeshStandardMaterial({ color: 0xff00ff });
      const sunglasses = new THREE.Mesh(neonGeometry, neonMaterial);
      sunglasses.position.set(0, 1.75, 0.2);
      group.add(sunglasses);

      // Earrings
      const earGeometry = new THREE.SphereGeometry(0.05, 8, 8);
      const earMaterial = new THREE.MeshStandardMaterial({ color: 0xff00ff });
      const leftEar = new THREE.Mesh(earGeometry, earMaterial);
      leftEar.position.set(-0.2, 1.5, 0.3);
      group.add(leftEar);
      const rightEar = new THREE.Mesh(earGeometry, earMaterial);
      rightEar.position.set(0.2, 1.5, 0.3);
      group.add(rightEar);
    } else if (period === '2005') {
      // 2005: Early 2000s style - tiny sunglasses and bling
      const tinyGeometry = new THREE.BoxGeometry(0.2, 0.02, 0.3);
      const tinyMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
      const sunglasses = new THREE.Mesh(tinyGeometry, tinyMaterial);
      sunglasses.position.set(0, 1.75, 0.25);
      group.add(sunglasses);

      // Small diamond earring
      const diamondGeometry = new THREE.SphereGeometry(0.03, 8, 8);
      const diamondMaterial = new THREE.MeshStandardMaterial({ color: 0xffd700 });
      const diamond = new THREE.Mesh(diamondGeometry, diamondMaterial);
      diamond.position.set(0.15, 1.5, 0.3);
      group.add(diamond);
    } else if (period === '2025') {
      // 2025: Tech-integrated accessories - AR glasses
      const arGeometry = new THREE.BoxGeometry(0.3, 0.05, 0.1);
      const arMaterial = new THREE.MeshStandardMaterial({ color: 0x00ffff });
      const arGlasses = new THREE.Mesh(arGeometry, arMaterial);
      arGlasses.position.set(0, 1.75, 0.2);
      arGlasses.rotation.z = Math.PI / 6;
      group.add(arGlasses);

      // Tech badge/brooch
      const badgeGeometry = new THREE.SphereGeometry(0.08, 8, 8);
      const badgeMaterial = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
      const badge = new THREE.Mesh(badgeGeometry, badgeMaterial);
      badge.position.set(0, 1.5, 0.1);
      group.add(badge);
    }
  }

  /** Update all pedestrians' walking animation */
  update(delta: number, period: EraKey): void {
    this.currentPeriod = period;
    const foundEra = eras.find((e) => e.year === Number(period));
    this.eraConfig = foundEra as EraConfigWithDensity;

    // Update outfit color based on period
    const outfitColor = periodOutfits[period].color;

    this.pedestrians.forEach((pedestrian, index) => {
      // Update color
      pedestrian.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.material.color = outfitColor;
        }
      });

      // Walking animation - sway motion
      const time = performance.now() / 1000;
      const sway = Math.sin(time * this.walkingSpeed + index) * 0.1;
      pedestrian.rotation.z = sway;

      // Periodic stride animation
      const stride = Math.cos(time * this.walkingSpeed * 0.5 + index * 0.5) * 0.05;
      pedestrian.position.y += stride;

      // Reset position if pedestrian goes off sidewalk
      if (pedestrian.position.y > 2.0) {
        pedestrian.position.y = 1.8;
      }
    });
  }

  /** Get all pedestrian groups for rendering */
  getPedestrians(): THREE.Group[] {
    return this.pedestrians;
  }

  /** Get the current period */
  getCurrentPeriod(): EraKey {
    return this.currentPeriod;
  }

  /** Get the era config for the current period */
  getEraConfig(): EraConfigWithDensity {
    return this.eraConfig;
  }

  /** Resize sidewalk dimensions */
  setSidewalkDimensions(width: number, depth: number): void {
    this.sidewalkWidth = width;
    this.sidewalkDepth = depth;
  }
}