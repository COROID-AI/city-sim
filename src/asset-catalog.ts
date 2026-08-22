/// <reference types="three" />

// Asset types for era-specific city elements
export type AssetType = 
  | 'building'
  | 'vehicle'
  | 'storefront'
  | 'advertisement'
  | 'pedestrian';

// Asset definition interface
export interface AssetDefinition {
  type: AssetType;
  name: string;
  modelUrl: string;
  textureUrls: string[];
  materialParams?: {
    color?: number;
    roughness?: number;
    metalness?: number;
  };
}

// Era identifiers (5 historical periods)
export const enum Era {
  Era1945 = 1945,
  Era1965 = 1965,
  Era1985 = 1985,
  Era2005 = 2005,
  Era2025 = 2025,
}

// Asset catalog manages era-specific asset definitions and loading/unloading
export class AssetCatalog {
  // Static definitions for all 5 eras across all asset types
  private static definitions: Map<Era, AssetDefinition[]> = new Map();

  // Loaded assets per era: era -> Map<name, THREE.Object3D>
  private static loadedAssets: Map<Era, Map<string, THREE.Object3D>> = new Map();

  // Initialize asset definitions for all eras
  static init(): void {
    this.defineEraAssets(Era.Era1945, [
      // Buildings
      { type: 'building', name: 'skyscraper1945', modelUrl: '/models/1945/skyscraper.glb', textureUrls: ['/textures/1945/brick.jpg'], materialParams: { color: 0x8B4513, roughness: 0.7, metalness: 0.2 } },
      { type: 'building', name: 'house1945', modelUrl: '/models/1945/house.glb', textureUrls: ['/textures/1945/wood.jpg'], materialParams: { color: 0xDEB887, roughness: 0.8, metalness: 0.1 } },
      // Vehicles
      { type: 'vehicle', name: 'car1945', modelUrl: '/models/1945/car.glb', textureUrls: ['/textures/1945/car-metal.jpg'] },
      // Storefronts
      { type: 'storefront', name: 'diner1945', modelUrl: '/models/1945/diner.glb', textureUrls: ['/textures/1945/diner.jpg'] },
      // Ads
      { type: 'advertisement', name: 'poster1945', modelUrl: '/models/1945/poster.glb', textureUrls: ['/textures/1945/poster.jpg'] },
      // Pedestrians
      { type: 'pedestrian', name: 'walker1945', modelUrl: '/models/1945/pedestrian.glb', textureUrls: ['/textures/1945/people.jpg'] },
    ]);

    this.defineEraAssets(Era.Era1965, [
      { type: 'building', name: 'skyscraper1965', modelUrl: '/models/1965/skyscraper.glb', textureUrls: ['/textures/1965/glass.jpg'], materialParams: { color: 0xFFFFFF, roughness: 0.4, metalness: 0.6 } },
      { type: 'building', name: 'apartment1965', modelUrl: '/models/1965/apartment.glb', textureUrls: ['/textures/1965/concrete.jpg'], materialParams: { color: 0x8B0000, roughness: 0.7, metalness: 0.2 } },
      { type: 'building', name: 'brownstone1965', modelUrl: '/models/1965/brownstone.glb', textureUrls: ['/textures/1965/brick.jpg'], materialParams: { color: 0xA0522D, roughness: 0.8, metalness: 0.1 } },
      { type: 'building', name: 'commercial1965', modelUrl: '/models/1965/commercial.glb', textureUrls: ['/textures/1965/steel.jpg'], materialParams: { color: 0xE0E0E0, roughness: 0.5, metalness: 0.7 } },
      // Vehicles
      { type: 'vehicle', name: 'car1965', modelUrl: '/models/1965/car.glb', textureUrls: ['/textures/1965/car-chrome.jpg'] },
      { type: 'vehicle', name: 'truck1965', modelUrl: '/models/1965/truck.glb', textureUrls: ['/textures/1965/truck-metal.jpg'] },
      // Storefronts with 1960s aesthetic
      { type: 'storefront', name: 'diner1965', modelUrl: '/models/1965/diner.glb', textureUrls: ['/textures/1965/diner.jpg'], materialParams: { color: 0xFF6B6B, roughness: 0.5, metalness: 0.3 } },
      { type: 'storefront', name: 'shop1965', modelUrl: '/models/1965/shop.glb', textureUrls: ['/textures/1965/shop-front.jpg'], materialParams: { color: 0x4ECDC4, roughness: 0.6, metalness: 0.2 } },
      { type: 'storefront', name: 'mall1965', modelUrl: '/models/1965/mall.glb', textureUrls: ['/textures/1965/mall.jpg'] },
      { type: 'storefront', name: 'sign1965', modelUrl: '/models/1965/sign.glb', textureUrls: ['/textures/1965/sign.jpg'], materialParams: { color: 0xFFD93D, roughness: 0.9, metalness: 0.1 } },
      // Ads with neon elements
      { type: 'advertisement', name: 'billboard1965', modelUrl: '/models/1965/billboard.glb', textureUrls: ['/textures/1965/billboard.jpg'] },
      { type: 'advertisement', name: 'poster1965', modelUrl: '/models/1965/poster.glb', textureUrls: ['/textures/1965/poster.jpg'] },
      { type: 'advertisement', name: 'neon1965', modelUrl: '/models/1965/neon.glb', textureUrls: ['/textures/1965/neon-tube.jpg'], materialParams: { color: 0xFF00FF, roughness: 0.3, metalness: 0.8 } },
      // Pedestrians
      { type: 'pedestrian', name: 'walker1965', modelUrl: '/models/1965/pedestrian.glb', textureUrls: ['/textures/1965/people.jpg'] },
    ]);

    this.defineEraAssets(Era.Era1985, [
      { type: 'building', name: 'skyscraper1985', modelUrl: '/models/1985/skyscraper.glb', textureUrls: ['/textures/1985/steel.jpg'], materialParams: { color: 0xB0C4DE, roughness: 0.5, metalness: 0.8 } },
      { type: 'building', name: 'condo1985', modelUrl: '/models/1985/condo.glb', textureUrls: ['/textures/1985/concrete.jpg'], materialParams: { color: 0x808080, roughness: 0.6, metalness: 0.5 } },
      { type: 'vehicle', name: 'car1985', modelUrl: '/models/1985/car.glb', textureUrls: ['/textures/1985/car.jpg'] },
      { type: 'storefront', name: 'shop1985', modelUrl: '/models/1985/shop.glb', textureUrls: ['/textures/1985/shop.jpg'] },
      { type: 'advertisement', name: 'poster1985', modelUrl: '/models/1985/poster.glb', textureUrls: ['/textures/1985/poster.jpg'] },
      { type: 'pedestrian', name: 'walker1985', modelUrl: '/models/1985/pedestrian.glb', textureUrls: ['/textures/1985/people.jpg'] },
    ]);

    this.defineEraAssets(Era.Era2005, [
      // Buildings
      { type: 'building', name: 'skyscraper2005', modelUrl: '/models/2005/skyscraper.glb', textureUrls: ['/textures/2005/glass-trim.jpg'], materialParams: { color: 0xE5E5E5, roughness: 0.3, metalness: 0.9 } },
      { type: 'building', name: 'office2005', modelUrl: '/models/2005/office.glb', textureUrls: ['/textures/2005/concrete.jpg'], materialParams: { color: 0xD0D0D0, roughness: 0.4, metalness: 0.6 } },
      // Storefronts with 2000s aesthetic
      { type: 'storefront', name: 'store2005', modelUrl: '/models/2005/store.glb', textureUrls: ['/textures/2005/store.jpg'] },
      { type: 'storefront', name: 'shop2005a', modelUrl: '/models/2005/shop_a.glb', textureUrls: ['/textures/2005/shop_front.jpg'], materialParams: { color: 0xFFE4B5, roughness: 0.5, metalness: 0.2 } },
      { type: 'storefront', name: 'shop2005b', modelUrl: '/models/2005/shop_b.glb', textureUrls: ['/textures/2005/shop_front2.jpg'], materialParams: { color: 0xFFDAB9, roughness: 0.6, metalness: 0.1 } },
      // Digital display elements (early 2000s)
      { type: 'advertisement', name: 'digital2005', modelUrl: '/models/2005/digital.glb', textureUrls: ['/textures/2005/digital.jpg'] },
      { type: 'advertisement', name: 'digitalDisplay2005', modelUrl: '/models/2005/digital_display.glb', textureUrls: ['/textures/2005/digital_screen.jpg'], materialParams: { color: 0x1E90FF, roughness: 0.1, metalness: 0.0 } },
      // Signage
      { type: 'advertisement', name: 'signage2005', modelUrl: '/models/2005/sign.glb', textureUrls: ['/textures/2005/sign.jpg'], materialParams: { color: 0xB0C4DE, roughness: 0.7, metalness: 0.3 } },
      // Vehicles
      { type: 'vehicle', name: 'car2005', modelUrl: '/models/2005/car.glb', textureUrls: ['/textures/2005/car.jpg'] },
      // Pedestrians
      { type: 'pedestrian', name: 'walker2005', modelUrl: '/models/2005/pedestrian.glb', textureUrls: ['/textures/2005/people.jpg'] },
    ]);

    this.defineEraAssets(Era.Era2025, [
      { type: 'building', name: 'skyscraper2025', modelUrl: '/models/2025/skyscraper.glb', textureUrls: ['/textures/2025/curtain-wall.jpg'], materialParams: { color: 0xFFFFFF, roughness: 0.2, metalness: 1.0 } },
      { type: 'building', name: 'tower2025', modelUrl: '/models/2025/tower.glb', textureUrls: ['/textures/2025/glass.jpg'], materialParams: { color: 0xE0E0E0, roughness: 0.3, metalness: 0.7 } },
      { type: 'vehicle', name: 'car2025', modelUrl: '/models/2025/car.glb', textureUrls: ['/textures/2025/car-ev.jpg'] },
      { type: 'storefront', name: 'store2025', modelUrl: '/models/2025/store.glb', textureUrls: ['/textures/2025/storefront.jpg'] },
      { type: 'advertisement', name: 'digital2025', modelUrl: '/models/2025/digital.glb', textureUrls: ['/textures/2025/digital.jpg'] },
      { type: 'pedestrian', name: 'walker2025', modelUrl: '/models/2025/pedestrian.glb', textureUrls: ['/textures/2025/people.jpg'] },
    ]);
  }

  // Define assets for a specific era (internal use during init)
  private static defineEraAssets(era: Era, assets: AssetDefinition[]): void {
    this.definitions.set(era, assets);
  }

  // Get all asset definitions for an era
  static getAssetsForEra(era: Era): AssetDefinition[] {
    return this.definitions.get(era) || [];
  }

  // Load assets for a target era (async lazy loading)
  static async loadAssets(era: Era): Promise<Map<string, THREE.Object3D>> {
    // If assets already loaded for this era, return cached map
    if (this.loadedAssets.has(era)) {
      return this.loadedAssets.get(era)!;
    }

    const definitions = this.getAssetsForEra(era);
    const loadedMap = new Map<string, THREE.Object3D>();

    for (const def of definitions) {
      try {
        // Load GLTF model
        const loader = new THREE.GLTFLoader();
        const model = await new Promise<THREE.GLTF>((resolve, reject) => {
          loader.load(
            def.modelUrl,
            resolve,
            undefined,
            reject
          );
        });

        // Create a group for each asset, named by definition name
        const group = new THREE.Group();
        group.name = def.name;

        // Add loaded meshes to group
        model.scene.traverse((child) => {
          if (child.isMesh) {
            // Apply material parameters if defined
            if (def.materialParams) {
              child.material = child.material.clone();
              const params = def.materialParams;
              child.material.color = new THREE.Color(params.color / 0xFFFFFF);
              child.material.roughness = params.roughness;
              child.material.metalness = params.metalness;
            }
            // Apply texture if URLs provided
            if (def.textureUrls && def.textureUrls.length > 0) {
              const texLoader = new THREE.TextureLoader();
              const texture = texLoader.load(def.textureUrls[0]);
              child.material.map = texture;
            }
            group.add(child);
          }
        });

        loadedMap.set(def.name, group);
        this.loadedAssets.set(era, loadedMap);
      } catch (error) {
        console.error(`Failed to load asset ${def.name} for era ${era}:`, error);
      }
    }

    return loadedMap;
  }

  // Unload assets from a previous era (disposal to prevent memory leaks)
  static unloadAssets(era: Era): void {
    const previouslyLoaded = this.loadedAssets.get(era);
    if (previouslyLoaded) {
      for (const [name, object] of previouslyLoaded) {
        // Dispose geometries and materials to prevent leaks
        if (object.isGroup) {
          object.traverse((child) => {
            if (child.isMesh) {
              if (child.geometry) {
                child.geometry.dispose();
              }
              if (child.material) {
                if (Array.isArray(child.material)) {
                  child.material.forEach((m) => m.dispose());
                } else {
                  child.material.dispose();
                }
              }
            }
          });
        }
        previouslyLoaded.delete(name);
      }
      this.loadedAssets.delete(era);
    }
  }

  // Swap assets from current era to target era
  static async swapAssets(currentEra: Era, targetEra: Era): Promise<Map<string, THREE.Object3D>> {
    // Unload assets from current era (if different from target)
    if (currentEra && currentEra !== targetEra) {
      await this.unloadAssets(currentEra);
    }

    // Load assets for target era
    const targetAssets = await this.loadAssets(targetEra);
    return targetAssets;
  }
}

// Initialize asset catalog on module import
AssetCatalog.init();