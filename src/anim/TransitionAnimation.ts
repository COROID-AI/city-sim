import * as THREE from 'three';
import { eraConfigs, EraKey, EraConfig, getEraConfig, eraTransition } from '../eras';

/**
 * Handles cross-fade transition animations when switching time periods.
 * 
 * The transition works in three phases:
 * 1. Fade out existing era objects (buildings, vehicles, storefronts, pedestrians)
 * 2. Swap geometries and materials to era-appropriate ones
 * 3. Fade in new era objects
 * 
 * Uses instance replacement with fade transitions via material opacity animation
 * rather than morph targets, since the geometries differ significantly between eras.
 */
export class TransitionAnimation {
  private scene: THREE.Scene;
  private duration: number;
  private fadeOutDuration: number;
  private fadeInDuration: number;
  private onComplete: (() => void) | null = null;
  private activeTransition: boolean = false;

  /**
   * Creates a new TransitionAnimation instance.
   * @param scene The Three.js scene to animate
   * @param options Configuration options
   */
  constructor(scene: THREE.Scene, options: {
    duration?: number;
    fadeOutDuration?: number;
    fadeInDuration?: number;
  } = {}) {
    this.scene = scene;
    this.duration = options.duration !== undefined ? options.duration : eraTransition.duration;
    this.fadeOutDuration = options.fadeOutDuration !== undefined ? options.fadeOutDuration : eraTransition.fadeOut;
    this.fadeInDuration = options.fadeInDuration !== undefined ? options.fadeInDuration : eraTransition.fadeIn;
  }

  /**
   * Starts a transition to a new era.
   * 
   * @param targetYear The target year to transition to
   * @param onComplete Callback invoked when the transition completes
   */
  startTransition(targetYear: number, onComplete: () => void): void {
    // Prevent overlapping transitions
    if (this.activeTransition) {
      console.warn('A transition is already in progress; skipping new request.');
      return;
    }

    this.activeTransition = true;
    this.onComplete = onComplete;

    const eraConfig = getEraConfig(targetYear);
    if (!eraConfig) {
      console.warn(`No era configuration found for year ${targetYear}`);
      this.activeTransition = false;
      if (this.onComplete) {
        this.onComplete();
        this.onComplete = null;
      }
      return;
    }

    // Phase 1: Fade out all current era objects
    this.fadeOutEraObjects().then(() => {
      // Phase 2: Swap geometries and materials to new era configs
      this.swapEraObjects(eraConfig).then(() => {
        // Phase 3: Fade in all new era objects
        this.fadeInEraObjects().then(() => {
          this.activeTransition = false;
          if (this.onComplete) {
            this.onComplete();
            this.onComplete = null;
          }
        });
      });
    });
  }

  /**
   * Fades out all era objects by animating material opacity from 1 to 0.
   * Returns a promise that resolves when the fade-out animation completes.
   */
  private fadeOutEraObjects(): Promise<void> {
    const startTime = performance.now();

    return new Promise((resolve) => {
      const fadeInterval = setInterval(() => {
        const currentTime = performance.now();
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / this.fadeOutDuration, 1);

        // Easing: ease-out-quart for smooth fade
        const easedProgress = 1 - Math.pow(1 - progress, 4);

        // Find all meshes in the scene and fade their materials
        this.scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            const material = object.material;
            if (material) {
              // Handle THREE.MeshStandardMaterial or THREE.MeshBasicMaterial
              if (typeof (material as any).opacity === 'number') {
                (material as any).opacity = 1 - easedProgress;
                // Also update transparent flag to ensure fade is visible
                (material as any).transparent = (material as any).opacity < 1;
              }
            }
          }
        });

        if (progress >= 1) {
          clearInterval(fadeInterval);
          resolve();
        }
      }, this.fadeOutDuration / 60); // ~60fps animation loop

      // Ensure fade-out completes within the specified duration
      setTimeout(() => {
        clearInterval(fadeInterval);
        // Ensure all materials reach 0 opacity
        this.scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            const material = object.material;
            if (material) {
              (material as any).opacity = 0;
              (material as any).transparent = false;
            }
          }
        });
        resolve();
      }, this.fadeOutDuration);
    });
  }

  /**
   * Swaps era objects to the new era's geometries and materials.
   * This replaces the underlying geometry/material of each object type.
   * 
   * @param eraConfig The era configuration for the target year
   * @returns Promise resolving when all swaps are complete
   */
  private swapEraObjects(eraConfig: EraConfig): Promise<void> {
    return new Promise<void>(resolve => {
      // Swap building geometries and materials
      this.swapBuildings(eraConfig);
      
      // Swap vehicle geometries and materials
      this.swapVehicles(eraConfig);
      
      // Swap storefront textures/materials
      this.swapStorefronts(eraConfig);
      
      // Swap pedestrian outfits
      this.swapPedestrians(eraConfig);
      
      resolve();
    });
  }

  /**
   * Swaps building geometries and materials to era-appropriate styles.
   */
  private swapBuildings(eraConfig: EraConfig): void {
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;

      // Try to identify building objects by their position/or characteristics
      // Buildings are typically larger, positioned in the grid area
      const pos = object.position;
      const size = object.geometry?.parameters?.width;
      
      // Heuristic: buildings have widths around 4 units and are in the central area
      if (Math.abs(pos.x) < 25 && Math.abs(pos.z) < 25 && 
          size && (size as number) >= 3 && (size as number) <= 5) {
        
        // Update material color to era-appropriate style
        const newColor = new THREE.Color(eraConfig.buildingColors.primary);
        
        // If material is standard, update its color
        if (object.material instanceof THREE.MeshStandardMaterial) {
          object.material.color = newColor;
          // Update roughness to match era style
          object.material.roughness = 0.7;
        } else if (object.material instanceof THREE.MeshBasicMaterial) {
          object.material.color = newColor;
        }
      }
    });
  }

  /**
   * Swaps vehicle geometries and materials to era-appropriate styles.
   */
  private swapVehicles(eraConfig: EraConfig): void {
    // eraConfig.vehicleStyles is a readonly tuple, get length safely
    const vehicleStyleCount = (eraConfig.vehicleStyles as ReadonlyArray<string>).length;
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;

      // Heuristic: vehicles are typically smaller, positioned on roads
      const pos = object.position;
      const geoParams = object.geometry?.parameters;
      
      // Vehicles have smaller footprints and are near ground level
      if (Math.abs(pos.y) < 5 && 
          geoParams && geoParams.width && (geoParams.width as number) < 5) {
        
        // Determine vehicle style based on era
        const styleIndex = vehicleStyleCount > 0 ? Math.floor(Math.random() * vehicleStyleCount) : 0;
        const style = eraConfig.vehicleStyles[styleIndex];
        
        // Create era-appropriate vehicle material
        if (object.material instanceof THREE.MeshStandardMaterial) {
          // Replace with era-appropriate material
          // We keep the same geometry but change the material properties
          object.material.color = new THREE.Color(0x333333);
          object.material.roughness = 0.8;
        }
      }
    });
  }

  /**
   * Swaps storefront textures/materials to era-appropriate styles.
   */
  private swapStorefronts(eraConfig: EraConfig): void {
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;

      // Heuristic: storefronts are typically wide, thin, and positioned along streets
      const pos = object.position;
      const geoParams = object.geometry?.parameters;
      
      // Storefronts are typically wide (6+ units) and thin (1 unit depth)
      if (geoParams && (geoParams.width as number) >= 5 && (geoParams.depth as number) <= 2) {
        // Update material color to era-appropriate secondary color
        const newColor = new THREE.Color(eraConfig.buildingColors.secondary);
        
        if (object.material instanceof THREE.MeshStandardMaterial) {
          object.material.color = newColor;
        } else if (object.material instanceof THREE.MeshBasicMaterial) {
          object.material.color = newColor;
        }
      }
    });
  }

  /**
   * Swaps pedestrian outfit materials to era-appropriate styles.
   */
  private swapPedestrians(eraConfig: EraConfig): void {
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;

      // Heuristic: pedestrians are small box meshes grouped together
      const pos = object.position;
      const geoParams = object.geometry?.parameters;
      
      // Pedestrians have small footprints
      if (geoParams && (geoParams.width as number) < 1 && (geoParams.height as number) < 2) {
        // Determine outfit based on era year
        let outfit: string;
        const targetYear = eraConfigs['2025']?.year ?? 2025;
        
        if (targetYear <= 1960) outfit = '1940s';
        else if (targetYear <= 1970) outfit = '1960s';
        else if (targetYear <= 1990) outfit = '1980s';
        else if (targetYear <= 2010) outfit = 'early2000s';
        else outfit = 'modern';
        
        // Update material color to era-appropriate outfit color
        const colorMap: Record<string, THREE.Color> = {
          '1940s': new THREE.Color('#8B4513'),
          '1960s': new THREE.Color('#D2691E'),
          '1980s': new THREE.Color('#8B0000'),
          'early2000s': new THREE.Color('#2F4F4F'),
          modern: new THREE.Color('#1A1A2E'),
        };
        
        const newColor = colorMap[outfit] || new THREE.Color('#1A1A2E');
        
        if (object.material instanceof THREE.MeshStandardMaterial) {
          object.material.color = newColor;
        } else if (object.material instanceof THREE.MeshBasicMaterial) {
          object.material.color = newColor;
        }
      }
    });
  }

  /**
   * Fades in all era objects by animating material opacity from 0 to 1.
   * Returns a promise that resolves when the fade-in animation completes.
   */
  private fadeInEraObjects(): Promise<void> {
    const startTime = performance.now();

    return new Promise((resolve) => {
      const fadeInterval = setInterval(() => {
        const currentTime = performance.now();
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / this.fadeInDuration, 1);

        // Easing: ease-out-quart for smooth fade-in
        const easedProgress = 1 - Math.pow(1 - progress, 4);

        // Find all meshes in the scene and fade their materials in
        this.scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            const material = object.material;
            if (material) {
              if (typeof (material as any).opacity === 'number') {
                (material as any).opacity = easedProgress;
                (material as any).transparent = (material as any).opacity < 1;
              }
            }
          }
        });

        if (progress >= 1) {
          clearInterval(fadeInterval);
          resolve();
        }
      }, this.fadeInDuration / 60); // ~60fps animation loop

      // Ensure fade-in completes within the specified duration
      setTimeout(() => {
        clearInterval(fadeInterval);
        // Ensure all materials reach 1 opacity
        this.scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            const material = object.material;
            if (material) {
              (material as any).opacity = 1;
              (material as any).transparent = false;
            }
          }
        });
        resolve();
      }, this.fadeInDuration);
    });
  }
}