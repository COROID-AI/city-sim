import * as THREE from 'three';

// Period-specific building configuration interface
export interface BuildingPeriodConfig {
  name: string;
  heightRange: [number, number]; // in stories
  windowPattern: 'vertical' | 'horizontal' | 'grid' | 'curtain' | 'high-performance';
  primaryColor: string;
  secondaryColor?: string;
  architecturalDetails: string[];
  floorHeight: number; // meters per story
}

// Period configurations for 5 historical architectural styles
const periodConfigs: Record<string, BuildingPeriodConfig> = {
  '1945': {
    name: '1945 Art Deco',
    heightRange: [4, 8],
    windowPattern: 'vertical',
    primaryColor: '#8B4513', // Brownstone/brick
    secondaryColor: '#A0522D',
    architecturalDetails: ['setbacks', 'zigzag', 'sunburst', 'decorative_spandrels'],
    floorHeight: 3.5,
  },
  '1965': {
    name: '1965 Mid-Century',
    heightRange: [4, 7],
    windowPattern: 'horizontal',
    primaryColor: '#D2691E', // Orange brick
    secondaryColor: '#F0E68C',
    architecturalDetails: ['ribbon_windows', 'central_entry', 'flat_roof', 'minimal_ornament'],
    floorHeight: 3.2,
  },
  '1985': {
    name: '1985 Modernist',
    heightRange: [5, 9],
    windowPattern: 'grid',
    primaryColor: '#8B0000', // Red brick
    secondaryColor: '#FFD700',
    architecturalDetails: ['pilotis', 'setback_terraces', 'brutalist_elements', 'curtain_wall'],
    floorHeight: 3.5,
  },
  '2005': {
    name: '2005 Glass/Steel',
    heightRange: [8, 15],
    windowPattern: 'curtain',
    primaryColor: '#2F4F4F', // Dark slate
    secondaryColor: '#5F9EA0',
    architecturalDetails: ['atrium', 'geometric_forms', 'reflective_surfaces', 'recessed_entries'],
    floorHeight: 3.8,
  },
  '2025': {
    name: '2025 Sustainable',
    heightRange: [6, 12],
    windowPattern: 'high-performance',
    primaryColor: '#1A1A2E', // Dark blue-gray
    secondaryColor: '#16213E',
    architecturalDetails: ['green_roof', 'solar_panels', 'rainwater_collection', 'vertical_gardens'],
    floorHeight: 3.5,
  },
};

/**
 * Building class that generates building meshes accepting a timePeriod parameter.
 * Creates period-appropriate architecture with distinct heights, window patterns,
 * materials, and architectural details for each of the 5 historical periods.
 */
export class Building {
  private period: string;
  private config: BuildingPeriodConfig;
  private buildingMesh: THREE.Mesh | null = null;

  /**
   * Create a new Building instance.
   * @param timePeriod The historical period string ('1945', '1965', '1985', '2005', '2025')
   * @throws Error if the timePeriod is not supported
   */
  constructor(timePeriod: string) {
    // Normalize the time period to ensure match
    const normalizedPeriod = timePeriod.trim();

    if (!periodConfigs[normalizedPeriod]) {
      const availablePeriods = Object.keys(periodConfigs).join(', ');
      throw new Error(
        `Unsupported time period: "${normalizedPeriod}". Available periods: ${availablePeriods}`
      );
    }

    this.period = normalizedPeriod;
    this.config = periodConfigs[normalizedPeriod];
  }

  /**
   * Get the period string.
   */
  getPeriod(): string {
    return this.period;
  }

  /**
   * Get the period configuration.
   */
  getConfig(): BuildingPeriodConfig {
    return this.config;
  }

  /**
   * Generate the building mesh with period-appropriate geometry.
   * @param footprintWidth Width of the building footprint in meters (default: 4)
   * @param footprintDepth Depth of the building footprint in meters (default: 4)
   * @returns THREE.Mesh representing the building
   */
  generateBuilding(footprintWidth: number = 4, footprintDepth: number = 4): THREE.Mesh {
    // Calculate height based on period config and random stories within range
    const minStories = this.config.heightRange[0];
    const maxStories = this.config.heightRange[1];
    const randomStories = minStories + Math.random() * (maxStories - minStories);
    const height = randomStories * this.config.floorHeight;

    // Create period-appropriate material
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.config.primaryColor),
      roughness: this._getRoughness(),
      metalness: 0.1,
    });

    // Create window geometry based on period pattern
    const windowGeometry = this._createWindowGeometry(
      footprintWidth,
      footprintDepth,
      height
    );

    // Create the building mesh
    this.buildingMesh = new THREE.Mesh(
      new THREE.BoxGeometry(footprintWidth, height, footprintDepth),
      material
    );

    // Apply period-specific architectural details
    this._applyArchitecturalDetails(
      footprintWidth,
      footprintDepth,
      height
    );

    // Position the building
    this.buildingMesh.position.set(0, height / 2, 0);

    return this.buildingMesh;
  }

  /**
   * Get roughness factor based on period.
   */
  private _getRoughness(): number {
    switch (this.period) {
      case '1945':
        return 0.7; // Brick/textured
      case '1965':
        return 0.6; // Painted brick
      case '1985':
        return 0.5; // Concrete
      case '2005':
        return 0.3; // Glass/steel
      case '2025':
        return 0.2; // Sustainable materials
      default:
        return 0.5;
    }
  }

  /**
   * Create window cutouts/pattern based on period.
   * @param footprintWidth Building width
   * @param footprintDepth Building depth
   * @param height Building height
   * @returns Modified geometry with window patterns
   */
  private _createWindowGeometry(
    footprintWidth: number,
    footprintDepth: number,
    height: number
  ): THREE.BufferGeometry {
    // Start with full box geometry
    const geometry = new THREE.BoxGeometry(
      footprintWidth,
      height,
      footprintDepth
    );

    // Window patterns will be applied as textures or separate meshes
    // in the city block generation. This returns the basic geometry
    // with user data marking the window pattern for later processing.
    geometry.userData = {
      windowPattern: this.config.windowPattern,
      period: this.period,
      footprintWidth,
      footprintDepth,
      height,
    };

    return geometry;
  }

  /**
   * Apply period-specific architectural details to the building.
   * @param footprintWidth Building width
   * @param footprintDepth Building depth
   * @param height Building height
   */
  private _applyArchitecturalDetails(
    footprintWidth: number,
    footprintDepth: number,
    height: number
  ): void {
    // Add architectural details based on period
    // This stores the details in userData for the scene builder to use
    ;(this.buildingMesh as THREE.Mesh).userData = {
      period: this.period,
      height,
      footprintWidth,
      footprintDepth,
      architecturalDetails: this.config.architecturalDetails,
      windowPattern: this.config.windowPattern,
    };
  }

  /**
   * Get the building mesh.
   */
  getMesh(): THREE.Mesh | null {
    return this.buildingMesh;
  }

  /**
   * Update the building to a new period (animating transformation).
   * @param newPeriod The new historical period
   */
  updatePeriod(newPeriod: string): void {
    const normalizedPeriod = newPeriod.trim();

    if (!periodConfigs[normalizedPeriod]) {
      console.warn(`Unsupported period: "${normalizedPeriod}"`);
      return;
    }

    this.period = normalizedPeriod;
    this.config = periodConfigs[normalizedPeriod];

    // Re-generate the building with new period config if exists
    if (this.buildingMesh) {
      if (this.buildingMesh.geometry) {
        this.buildingMesh.geometry.dispose();
      }
      if (this.buildingMesh.material) {
        const material = this.buildingMesh.material;
        if (Array.isArray(material)) {
          material.forEach(m => m.dispose?.());
        } else {
          material.dispose?.();
        }
      }
    }

    this.buildingMesh = this.generateBuilding(4, 4);
  }
}