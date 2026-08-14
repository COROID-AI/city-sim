import * as THREE from 'three';
import { EraConfig, getEraConfig, EraKey } from './eras';

/**
 * StorefrontSystem manages building storefronts, signage, and advertisements
 * with period-accurate designs across 5 historical periods.
 *
 * Period mappings:
 *  - 1945: Hand-painted signs, art deco style
 *  - 1965: Neon lit, mid-century style
 *  - 1985: Vinyl graphics, 80s commercial style
 *  - 2005: Digital screens, LED style
 *  - 2025: Interactive smart displays, contemporary style
 */
export class StorefrontSystem {
  private scene: THREE.Scene;
  private storefronts: THREE.Mesh[] = [];
  private signage: THREE.Mesh[] = [];
  private advertisements: THREE.Mesh[] = [];
  private currentPeriod: EraKey = '2025';
  private eraConfig: EraConfig | null = null;

  /**
   * Create a new StorefrontSystem
   * @param scene The Three.js scene to add storefronts/signage to
   */
  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Set the time period for the storefront system
   * @param period The era year (1945, 1965, 1985, 2005, 2025)
   */
  setTimePeriod(period: EraKey): void {
    this.currentPeriod = period;
    this.eraConfig = getEraConfig(period);
    if (!this.eraConfig) {
      console.warn(`No era configuration found for period ${period}`);
      return;
    }
    this.applyPeriodDesigns();
  }

  /**
   * Get the current time period
   */
  getTimePeriod(): EraKey {
    return this.currentPeriod;
  }

  /**
   * Apply period-accurate storefront textures, logos, and signage
   */
  private applyPeriodDesigns(): void {
    this.clearAll();
    if (!this.eraConfig) return;

    // Apply era-appropriate storefronts
    this._createStorefronts();

    // Apply era-appropriate signage
    this._createSignage();

    // Apply era-appropriate advertisements
    this._createAdvertisements();

    console.log(`Applied ${this.currentPeriod} period storefront designs`);
  }

  /**
   * Clear all storefronts, signage, and advertisements from the scene
   */
  private clearAll(): void {
    // Remove and dispose storefronts
    this.storefronts.forEach((mesh) => {
      this.scene.remove(mesh);
    });
    this.storefronts = [];

    // Remove and dispose signage
    this.signage.forEach((mesh) => {
      this.scene.remove(mesh);
    });
    this.signage = [];

    // Remove and dispose advertisements
    this.advertisements.forEach((mesh) => {
      this.scene.remove(mesh);
    });
    this.advertisements = [];
  }

  /**
   * Create era-appropriate storefronts with period-specific textures and logos
   */
  private _createStorefronts(): void {
    const { storefrontStyle, buildingColors } = this.eraConfig;

    // Create 8 storefronts per period with period-appropriate styling
    for (let i = 0; i < 8; i++) {
      const width = 6;
      const height = 3 + Math.random() * 4;
      const depth = 1;

      // Create storefront material with era-appropriate colors
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(buildingColors.secondary),
        roughness: 0.6,
        metalness: 0.2,
      });

      const storefront = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        material
      );

      // Position storefronts along the facade
      const x = (Math.random() - 0.5) * 70;
      const z = -30 + (Math.random() * 20);
      storefront.position.set(x, height / 2, z);
      storefront.rotation.y = Math.PI / 2;

      // Add period-specific logo/emblem
      this._addPeriodLogo(storefront, i);

      this.scene.add(storefront);
      this.storefronts.push(storefront);
    }
  }

  /**
   * Add period-specific logo/emblem to a storefront
   */
  private _addPeriodLogo(storefront: THREE.Mesh, index: number): void {
    const period = this.currentPeriod;
    const logoGeometry = new THREE.PlaneGeometry(2, 1);
    let logoMaterial: THREE.Material;
    let logoPositionY = 2.5;

    switch (period) {
      case '1945':
        // Hand-painted sign style: parchment-colored with brush strokes
        logoMaterial = new THREE.MeshStandardMaterial({
          color: new THREE.Color('#F5E9DC'),
          roughness: 0.9,
        });
        // Add "hand-painted" texture indicator
        const brushStroke = new THREE.Mesh(
          new THREE.PlaneGeometry(1.8, 0.5),
          new THREE.MeshStandardMaterial({ color: new THREE.Color('#6B4B2A'), roughness: 0.8 })
        );
        brushStroke.position.set(0, 0.25, 0.01);
        storefront.add(brushStroke);
        break;

      case '1965':
        // Neon lit style: bright colors, glowing effect
        logoMaterial = new THREE.MeshStandardMaterial({
          color: new THREE.Color('#FF00FF'),
          emissive: new THREE.Color('#FF00FF'),
          emissiveIntensity: 0.5,
          roughness: 0.3,
        });
        logoPositionY = 2.8;
        break;

      case '1985':
        // Vinyl graphics style: bold colors, slightly reflective
        logoMaterial = new THREE.MeshStandardMaterial({
          color: new THREE.Color('#FFD700'),
          metalness: 0.8,
          roughness: 0.4,
        });
        logoPositionY = 2.5;
        break;

      case '2005':
        // Digital screen style: dark background with glowing text
        logoMaterial = new THREE.MeshStandardMaterial({
          color: new THREE.Color('#1A1A2E'),
          emissive: new THREE.Color('#00FF00'),
          emissiveIntensity: 0.3,
          roughness: 0.2,
        });
        logoPositionY = 2.8;
        break;

      case '2025':
        // Interactive smart display: sleek, high-tech appearance
        logoMaterial = new THREE.MeshStandardMaterial({
          color: new THREE.Color('#E94560'),
          emissive: new THREE.Color('#E94560'),
          emissiveIntensity: 0.4,
          roughness: 0.1,
        });
        logoPositionY = 2.8;
        break;
    }

    const logo = new THREE.Mesh(logoGeometry, logoMaterial);
    logo.position.set(0, logoPositionY, 0.01);
    storefront.add(logo);
  }

  /**
   * Create era-appropriate signage matching period design language
   */
  private _createSignage(): void {
    const { billboardStyle } = this.eraConfig;
    const signCount = 5; // 5 period-specific signs

    for (let i = 0; i < signCount; i++) {
      const width = 4 + Math.random() * 3;
      const height = 2 + Math.random() * 3;
      const depth = 0.2;

      const signMaterial = new THREE.MeshStandardMaterial({
        transparent: true,
        opacity: 0.9,
      });

      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        signMaterial
      );

      // Position signage along the street
      const x = (Math.random() - 0.5) * 60;
      const z = 35 + (Math.random() * 15);
      const y = height / 2;
      sign.position.set(x, y, z);
      sign.rotation.x = -Math.PI / 2;

      // Apply period-specific sign style
      this._applySignStyle(sign, i);

      this.scene.add(sign);
      this.signage.push(sign);
    }
  }

  /**
   * Apply period-specific sign style
   */
  private _applySignStyle(sign: THREE.Mesh, index: number): void {
    const period = this.currentPeriod;

    switch (period) {
      case '1945':
        // Hand-painted sign: parchment background with brush stroke details
        sign.material = new THREE.MeshStandardMaterial({
          color: new THREE.Color('#F5E9DC'),
          roughness: 0.85,
          transparent: true,
          opacity: 0.95,
        });
        // Add subtle texture variation for hand-painted look
        sign.userData = { type: 'hand_painted', textureVariation: Math.random() * 0.1 };
        break;

      case '1965':
        // Neon lit sign: glowing neon tubes, bright colors
        sign.material = new THREE.MeshStandardMaterial({
          color: new THREE.Color('#FF00FF'),
          emissive: new THREE.Color('#FF00FF'),
          emissiveIntensity: 0.8,
          transparent: true,
          opacity: 0.8,
        });
        sign.userData = { type: 'neon_lit', tubeCount: 3 + index };
        break;

      case '1985':
        // Vinyl graphics: bold colors, slightly reflective
        sign.material = new THREE.MeshStandardMaterial({
          color: new THREE.Color('#FFD700'),
          metalness: 0.7,
          roughness: 0.4,
          transparent: true,
          opacity: 0.9,
        });
        sign.userData = { type: 'vinyl_graphics', finish: 'glossy' };
        break;

      case '2005':
        // Digital screen: LED display style
        sign.material = new THREE.MeshStandardMaterial({
          color: new THREE.Color('#1A1A2E'),
          emissive: new THREE.Color('#00FF00'),
          emissiveIntensity: 0.6,
          transparent: true,
          opacity: 0.9,
        });
        sign.userData = { type: 'digital_screen', refreshRate: 60 };
        break;

      case '2025':
        // Interactive smart display: high-res digital display
        sign.material = new THREE.MeshStandardMaterial({
          color: new THREE.Color('#E94560'),
          emissive: new THREE.Color('#E94560'),
          emissiveIntensity: 0.7,
          transparent: true,
          opacity: 0.85,
        });
        sign.userData = { type: 'interactive_smart', resolution: '4K' };
        break;
    }
  }

  /**
   * Create era-appropriate advertisements showing period-accurate products/messages
   */
  private _createAdvertisements(): void {
    const { billboardStyle } = this.eraConfig;
    const adCount = 5; // 5 period-accurate advertisements

    for (let i = 0; i < adCount; i++) {
      const width = 3 + Math.random() * 2;
      const height = 2 + Math.random() * 3;
      const depth = 0.1;

      const adMaterial = new THREE.MeshStandardMaterial({
        transparent: true,
        opacity: 0.85,
      });

      const ad = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        adMaterial
      );

      // Position advertisement
      const x = (Math.random() - 0.5) * 50;
      const z = 45 + (Math.random() * 10);
      const y = height / 2;
      ad.position.set(x, y, z);
      ad.rotation.x = -Math.PI / 2;

      // Apply period-accurate product/message content
      this._applyPeriodAdContent(ad, i);

      this.scene.add(ad);
      this.advertisements.push(ad);
    }
  }

  /**
   * Apply period-accurate product/message content to advertisement
   */
  private _applyPeriodAdContent(ad: THREE.Mesh, index: number): void {
    const period = this.currentPeriod;

    // Define period-accurate advertisement messages
    const periodMessages: Record<string, string[]> = {
      '1945': [
        'Local Bakery - Fresh Bread Daily',
        'Handcrafted Furniture',
        'Community Pharmacy',
      ],
      '1965': [
        'Diner - Burgers & Shakes',
        'Vintage Clothing Co.',
        'Neon Sign Shop',
      ],
      '1985': [
        'Video Arcade - Game Tokens',
        'Cyber Mall Shopping',
        'New Wave Records',
      ],
      '2005': [
        'Internet Cafe - Web Surfing',
        'Digital Camera Store',
        'Mobile Phone Depot',
      ],
      '2025': [
        'Smart Tech Store - AI Assistants',
        'Eco-Friendly Products',
        'VR Experience Center',
      ],
    };

    const messages = periodMessages[period] || ['Advertisement'];
    const message = messages[index % messages.length];

    // Create a simple text representation as a colored panel
    // with period-appropriate color scheme
    const adColors: Record<string, THREE.Color> = {
      '1945': new THREE.Color('#8B4513'),
      '1965': new THREE.Color('#FF69B4'),
      '1985': new THREE.Color('#8B0000'),
      '2005': new THREE.Color('#00BFFF'),
      '2025': new THREE.Color('#1A1A2E'),
    };

    ad.material = new THREE.MeshStandardMaterial({
      color: adColors[period],
      transparent: true,
      opacity: 0.85,
    });
    ad.userData = { type: 'advertisement', message, period };
  }

  /**
   * Get all storefront meshes currently in the scene
   */
  getStorefronts(): THREE.Mesh[] {
    return this.storefronts;
  }

  /**
   * Get all signage meshes currently in the scene
   */
  getSignage(): THREE.Mesh[] {
    return this.signage;
  }

  /**
   * Get all advertisement meshes currently in the scene
   */
  getAdvertisements(): THREE.Mesh[] {
    return this.advertisements;
  }

  /**
   * Get the current era configuration
   */
  getEraConfig(): EraConfig | null {
    return this.eraConfig;
  }
}