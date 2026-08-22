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
      // Trucks
      { type: 'vehicle', name: 'truck1945', modelUrl: '/models/1945/truck.glb', textureUrls: ['/textures/1945/truck-metal.jpg'] },
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
      // Additional 1980s storefront ads
      { type: 'storefront', name: 'shop1985a', modelUrl: '/models/1985/shop_alt.glb', textureUrls: ['/textures/1985/shop-alt.jpg'] },
    ]);

    this.defineEraAssets(Era.Era2005, [
      // Buildings
      { type: 'building', name: 'skyscraper2005', modelUrl: '/models/2005/skyscraper.glb', textureUrls: ['/textures/2005/glass-trim.jpg'], materialParams: { color: 0xE5E5E5, roughness: 0.3, metalness: 0.9 } },
      { type: 'building', name: 'office2005', modelUrl: '/models/2005/office.glb', textureUrls: ['/textures/2005/concrete.jpg'], materialParams: { color: 0xD0D0D0, roughness: 0.4, metalness: 0.6 } },

      // Storefronts with 2000s aesthetic
      { type: 'storefront', name: 'store2005', modelUrl: '/models/2005/store.glb', textureUrls: ['/textures/2005/store.jpg'] },
      { type: 'storefront', name: 'shop2005a', modelUrl: '/models/2005/shop_a.glb', textureUrls: ['/textures/2005/shop_front.jpg'], materialParams: { color: 0xFFE4B5, roughness: 0.5, metalness: 0.2 } },
      { type: 'storefront', name: 'shop2005b', modelUrl: '/models/2005/shop_b.glb', textureUrls: ['/textures/2005/shop_front2.jpg'], materialParams: { color: 0xFFDAB9, roughness: 0.6, metalness: 0.1 } },

      // 2005-era billboards / digital displays / poster panels
      // (Textures/model paths are placeholders aligned with the existing catalog conventions.)
      { type: 'advertisement', name: 'digital2005', modelUrl: '/models/2005/digital.glb', textureUrls: ['/textures/2005/digital.jpg'] },
      { type: 'advertisement', name: 'digitalDisplay2005', modelUrl: '/models/2005/digital_display.glb', textureUrls: ['/textures/2005/digital_screen.jpg'], materialParams: { color: 0x1E90FF, roughness: 0.1, metalness: 0.0 } },
      // Explicit billboard + LED signage variants for building-mounted placement
      { type: 'advertisement', name: 'billboard2005', modelUrl: '/models/2005/billboard.glb', textureUrls: ['/textures/2005/billboard.jpg'] },
      { type: 'advertisement', name: 'ledSign2005', modelUrl: '/models/2005/led_sign.glb', textureUrls: ['/textures/2005/led_sign.jpg'], materialParams: { color: 0x00E5FF, roughness: 0.2, metalness: 0.2 } },

      // Poster panels / street-level commercial advertising
      { type: 'advertisement', name: 'poster2005', modelUrl: '/models/2005/poster.glb', textureUrls: ['/textures/2005/poster.jpg'] },
      { type: 'advertisement', name: 'posterPanel2005', modelUrl: '/models/2005/poster_panel.glb', textureUrls: ['/textures/2005/poster_panel.jpg'] },

      // Store signage (LED/LCD look)
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
      // Additional 2025-era storefronts with digital displays
      { type: 'storefront', name: 'shop2025a', modelUrl: '/models/2025/shop_a.glb', textureUrls: ['/textures/2025/shop-front.jpg'], materialParams: { color: 0xF0F0F0, roughness: 0.4, metalness: 0.5 } },
      { type: 'storefront', name: 'shop2025b', modelUrl: '/models/2025/shop_b.glb', textureUrls: ['/textures/2025/shop-front2.jpg'], materialParams: { color: 0xE8E8E8, roughness: 0.3, metalness: 0.6 } },
      { type: 'advertisement', name: 'digitalDisplay2025', modelUrl: '/models/2025/digital_display.glb', textureUrls: ['/textures/2025/digital_screen.jpg'], materialParams: { color: 0x1E90FF, roughness: 0.1, metalness: 0.0 } },
      { type: 'advertisement', name: 'signage2025', modelUrl: '/models/2025/sign.glb', textureUrls: ['/textures/2025/sign.jpg'], materialParams: { color: 0xB0C4DE, roughness: 0.7, metalness: 0.3 } },
      // 2025-era pedestrian variations
      { type: 'pedestrian', name: 'walker2025a', modelUrl: '/models/2025/pedestrian.glb', textureUrls: ['/textures/2025/people.jpg'] },
      { type: 'pedestrian', name: 'walker2025b', modelUrl: '/models/2025/pedestrian.glb', textureUrls: ['/textures/2025/people2.jpg'] },
    ]);
  }

  // Define assets for a specific era (internal use during init)
  private static defineEraAssets(era: Era, assets: AssetDefinition[]): void {
    this.definitions.set(era, assets);
  }

  // Swap all assets from one era to another
  static async swapAssets(fromEra: Era, toEra: Era): Promise<void> {
    // Return early if eras are the same
    if (fromEra === toEra) {
      return;
    }

    // Get the asset definitions for the target era
    const toAssets = this.definitions.get(toEra);
    if (!toAssets) {
      console.warn(`No asset definitions found for era ${toEra}`);
      return;
    }

    // Load all assets for the target era
    const loadedMap: Map<string, THREE.Object3D> = new Map();

    for (const asset of toAssets) {
      try {
        // Load the model using Three.js GLTF loader
        const loader = new THREE.GLTFLoader();
        const url = asset.modelUrl;

        // Add base path prefix if needed
        const fullUrl = url.startsWith('/') ? url : `/${url}`;

        const gltf = await loader.loadAsync(fullUrl);

        // Add loaded asset to the map
        const name = asset.name;
        loadedMap.set(name, gltf.scene);
      } catch (error) {
        console.error(`Failed to load asset ${asset.name} from ${asset.modelUrl}:`, error);
      }
    }

    // Store the loaded assets
    this.loadedAssets.set(toEra, loadedMap);

    // Clear loaded assets from the source era (if different)
    if (fromEra !== toEra) {
      this.loadedAssets.delete(fromEra);
    }
  }
}
