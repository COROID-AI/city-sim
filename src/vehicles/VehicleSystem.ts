import * as THREE from 'three';
import { eraConfigs, EraKey, EraConfig, getEraConfig } from './eras';

/**
 * Vehicle types for each historical period
 */
export type VehicleType =
  | 'vintage1940s'
  | 'vintage1960s'
  | 'vintage1980s'
  | 'early2000s'
  | 'modern_ev';

/**
 * Period-specific vehicle configuration
 */
interface PeriodVehicleConfig {
  style: VehicleType;
  color: string;
  name: string;
}

/**
 * VehicleSystem manages car, taxi, bus, and truck population
 * with period-accurate models, colors, and spacing
 */
export class VehicleSystem {
  private scene: THREE.Scene;
  private eraConfig: EraConfig;
  private vehicles: THREE.Object3D[] = [];
  private eraKey: EraKey;

  /**
   * Constructs a VehicleSystem with a specific time period
   * @param timePeriod The historical period ('1945', '1965', '185', '2005', '2025')
   * @param scene The Three.js scene to populate with vehicles
   */
  constructor(timePeriod: number, scene: THREE.Scene) {
    const eraKey = ` ${timePeriod}` as EraKey;
    this.eraKey = eraKey;
    this.scene = scene;

    // Load the era configuration
    this.eraConfig = getEraConfig(timePeriod);
    if (!this.eraConfig) {
      console.warn(`No era configuration found for year ${timePeriod}`);
      // Default to 2025 if not found
      this.eraConfig = eraConfigs['2025'];
      this.eraKey = '2025' as EraKey;
    }

    // Initialize vehicles for the period
    this.initializeVehicles();
  }

  /**
   * Get the current era key
   */
  getCurrentEra(): EraKey {
    return this.eraKey;
  }

  /**
   * Get the current era configuration
   */
  getEraConfig(): EraConfig {
    return this.eraConfig;
  }

  /**
   * Initialize vehicles for the current era
   */
  private initializeVehicles(): void {
    if (!this.eraConfig) return;

    const vehicleCount = Math.floor(20 * this.eraConfig.vehicleDensity);
    const vehicleStyles = this.eraConfig.vehicleStyles;

    for (let i = 0; i < vehicleCount; i++) {
      const type = vehicleStyles[i % vehicleStyles.length];
      const vehicle = this.createVehicle(type);

      // Random position on roads around the city block
      const x = (Math.random() - 0.5) * 60;
      const z = (Math.random() - 0.5) * 60;
      const y = 0.5;

      vehicle.position.set(x, y, z);
      vehicle.rotation.y = Math.random() * Math.PI * 2;

      this.scene.add(vehicle);
      this.vehicles.push(vehicle);
    }
  }

  /**
   * Switch to a new time period, updating all vehicles
   * @param timePeriod The new historical period
   */
  switchEra(timePeriod: number): void {
    // Clear existing vehicles
    this.vehicles.forEach((vehicle) => {
      this.scene.remove(vehicle);
      vehicle.dispose();
    });
    this.vehicles = [];

    // Update era configuration
    this.eraKey = ` ${timePeriod}` as EraKey;
    this.eraConfig = getEraConfig(timePeriod);
    if (!this.eraConfig) {
      console.warn(`No era configuration found for year ${timePeriod}`);
      return;
    }

    // Re-initialize vehicles for the new period
    this.initializeVehicles();
  }

  /**
   * Create a vehicle with period-accurate style, color, and geometry
   * @param style The vehicle style identifier
   * @returns A Three.js Object3D representing the vehicle
   */
  private createVehicle(style: VehicleType): THREE.Object3D {
    // Period-accurate colors and model styles
    const vehicleConfig = this.getVehicleConfig(style);

    const geometry = this.getVehicleGeometry(style);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(vehicleConfig.color),
      roughness: 0.7,
      metalness: 0.3,
    });

    const vehicle = new THREE.Mesh(geometry, material);

    // Add era-specific details
    this.applyEraDetails(vehicle, style);

    return vehicle;
  }

  /**
   * Get period-accurate vehicle configuration (color and name)
   */
  private getVehicleConfig(style: VehicleType): PeriodVehicleConfig {
    switch (style) {
      case 'vintage1940s':
        return { style: 'vintage1940s', color: '#8B4513', name: '1945 Vintage Car' };
      case 'vintage1960s':
        return { style: 'vintage1960s', color: '#D2691E', name: '1965 Muscle Car' };
      case 'vintage1980s':
        return { style: 'vintage1980s', color: '#8B0000', name: '1985 Compact Car' };
      case 'early2000s':
        return { style: 'early2000s', color: '#2F4F4F', name: '2005 Modern Car' };
      case 'modern_ev':
        return { style: 'modern_ev', color: '#1A1A2E', name: '2025 EV/Autonomous' };
      default:
        return { style: 'vintage1940s', color: '#555555', name: 'Vehicle' };
    }
  }

  /**
   * Get period-accurate vehicle geometry
   */
  private getVehicleGeometry(style: VehicleType): THREE.BoxGeometry {
    switch (style) {
      case 'vintage1940s':
        return new THREE.BoxGeometry(2, 1, 4);
      case 'vintage1960s':
        return new THREE.BoxGeometry(2.5, 1.2, 5);
      case 'vintage1980s':
        return new THREE.BoxGeometry(3, 1.1, 4.5);
      case 'early2000s':
        return new THREE.BoxGeometry(3.5, 1.3, 4.8);
      case 'modern_ev':
        return new THREE.BoxGeometry(3.2, 1.4, 5);
      default:
        return new THREE.BoxGeometry(2.5, 1.2, 4.5);
    }
  }

  /**
   * Apply era-specific details to vehicle (lights, decals, etc.)
   */
  private applyEraDetails(vehicle: THREE.Object3D, style: VehicleType): void {
    // Era-specific detailing can be added here
    // For example: period-appropriate lights, decals, or accessories
    vehicle.userData = {
      era: this.eraKey,
      style,
      type: 'vehicle',
    };
  }

  /**
   * Get the number of vehicles in the current period
   */
  getVehicleCount(): number {
    return this.vehicles.length;
  }

  /**
   * Update vehicle positions (for animation/parking logic)
   */
  update(deltaTime: number): void {
    // Update vehicle animations - subtle parking/ driving behavior
    this.vehicles.forEach((vehicle) => {
      // Subtle "parking" animation - slight rocking motion
      const time = Date.now() * 0.001;
      vehicle.rotation.z = Math.sin(time + (vehicle.userData?.era as number)) * 0.01;
      vehicle.position.y = 0.5 + Math.sin(time * 0.5) * 0.05;
    });
  }
}