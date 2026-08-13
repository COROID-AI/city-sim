import * as THREE from 'three';
import { eraConfigs, EraKey, EraConfig, getEraConfig, eraTransition } from './eras';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

// Scene manager for era-based city block generation
export class EraSceneBuilder {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private eraObjects: THREE.Object3D[] = [];
  private currentEra: EraKey = '2025';

  constructor() {
    // Initialize THREE.js scene
    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 10, 20);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    // Add ground plane
    this._addGround();

    // Add lighting
    this._addLighting();

    // Initial resize handler
    window.addEventListener('resize', () => this._onResize());
  }

  private _onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private _addGround(): void {
    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x2c3e50,
      side: THREE.DoubleSide,
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    const gridHelper = new THREE.GridHelper(50, 50, 0x888888, 0x888888);
    this.scene.add(gridHelper);
  }

  private _addLighting(): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    this.scene.add(directionalLight);
  }

  /**
   * Switch to a specific era, clearing previous era's objects first
   */
  switchEra(year: number): void {
    const eraConfig = getEraConfig(year);
    if (!eraConfig) {
      console.warn(`No era configuration found for year ${year}`);
      return;
    }

    this._clearEraObjects();
    this.currentEra = ` ${year}` as EraKey;

    // Generate the new era's city block
    this._buildEraCityBlock(eraConfig);

    console.log(`Switched to era: ${eraConfig.year}`);
  }

  /**
   * Clear all objects from the previous era
   */
  private _clearEraObjects(): void {
    // Remove all era-specific objects
    this.eraObjects.forEach((obj) => {
      this.scene.remove(obj);
      obj.dispose();
    });
    this.eraObjects = [];

    // Reset camera to default position if needed
    this.camera.position.set(0, 10, 20);
    this.controls.reset();
  }

  /**
   * Build a city block based on the era configuration
   */
  private _buildEraCityBlock(config: EraConfig): void {
    this._buildBuildings(config);
    this._placeVehicles(config);
    this._createStorefronts(config);
    this._addBillboards(config);
    this._placePedestrians(config);
  }

  /**
   * Build buildings as extruded shapes with era-appropriate styles
   */
  private _buildBuildings(config: EraConfig): void {
    const gridSize = 10;
    const buildingWidth = 4;
    const buildingDepth = 4;

    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        // Stagger buildings with some gaps
        if (Math.random() > 0.3) {
          const height = 2 + Math.random() * config.buildingHeightFactor;

          // Create building material with era-appropriate colors
          const material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(config.buildingColors.primary),
            roughness: 0.7,
          });

          const building = new THREE.Mesh(
            new THREE.BoxGeometry(buildingWidth, height, buildingDepth),
            material
          );

          // Position with some variation
          building.position.set(
            col * (buildingWidth + 1) - 20,
            height / 2,
            row * (buildingDepth + 1) - 20
          );

          // Add slight random rotation
          building.rotation.y = Math.random() * 0.3;

          this.scene.add(building);
          this.eraObjects.push(building);
        }
      }
    }
  }

  /**
   * Place vehicles appropriate to the era
   */
  private _placeVehicles(config: EraConfig): void {
    const vehicleCount = Math.floor(20 * config.vehicleDensity);

    for (let i = 0; i < vehicleCount; i++) {
      const type = config.vehicleStyles[i % config.vehicleStyles.length];
      const vehicle = this._createVehicle(type);

      // Random position on roads
      const x = (Math.random() - 0.5) * 60;
      const z = (Math.random() - 0.5) * 60;
      const y = 0.5;

      vehicle.position.set(x, y, z);
      vehicle.rotation.y = Math.random() * Math.PI * 2;

      this.scene.add(vehicle);
      this.eraObjects.push(vehicle);
    }
  }

  private _createVehicle(style: string): THREE.Object3D {
    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });

    switch (style) {
      case 'vintage1940s':
        return new THREE.Mesh(
          new THREE.BoxGeometry(2, 1, 4),
          roadMaterial
        );
      case 'vintage1960s':
        return new THREE.Mesh(
          new THREE.BoxGeometry(2.5, 1.2, 5),
          roadMaterial
        );
      case 'vintage1980s':
        return new THREE.Mesh(
          new THREE.BoxGeometry(3, 1.1, 4.5),
          roadMaterial
        );
      case 'early2000s':
        return new THREE.Mesh(
          new THREE.BoxGeometry(3.5, 1.3, 4.8),
          roadMaterial
        );
      case 'modern_ev':
        return new THREE.Mesh(
          new THREE.BoxGeometry(3.2, 1.4, 5),
          roadMaterial
        );
      default:
        return new THREE.Mesh(
          new THREE.BoxGeometry(2.5, 1.2, 4.5),
          roadMaterial
        );
    }
  }

  /**
   * Create storefronts with era-appropriate styles
   */
  private _createStorefronts(config: EraConfig): void {
    const storefrontCount = Math.floor(15 * config.vehicleDensity);

    for (let i = 0; i < storefrontCount; i++) {
      const x = (Math.random() - 0.5) * 80;
      const z = (Math.random() - 0.5) * 80;
      const height = 3 + Math.random() * 5;

      const materialColor = new THREE.Color(config.buildingColors.secondary);

      const storefront = new THREE.Mesh(
        new THREE.BoxGeometry(6, height, 1),
        new THREE.MeshStandardMaterial({ color: materialColor })
      );

      storefront.position.set(x, height / 2, -40);
      storefront.rotation.y = Math.PI / 2;

      this.scene.add(storefront);
      this.eraObjects.push(storefront);
    }
  }

  /**
   * Add advertisement billboards with era-appropriate styles
   */
  private _addBillboards(config: EraConfig): void {
    const billboardCount = Math.floor(10 * config.vehicleDensity);

    for (let i = 0; i < billboardCount; i++) {
      const x = (Math.random() - 0.5) * 80;
      const z = (Math.random() - 0.5) * 80;
      const height = 2 + Math.random() * 4;

      const billboard = new THREE.Mesh(
        new THREE.PlaneGeometry(3, height),
        new THREE.MeshStandardMaterial({
          color: 0xff0000,
          transparent: true,
          opacity: 0.8,
        })
      );

      billboard.position.set(x, height / 2, 40);
      billboard.rotation.x = -Math.PI / 2;

      this.scene.add(billboard);
      this.eraObjects.push(billboard);
    }
  }

  /**
   * Place pedestrian models with era-appropriate outfits
   */
  private _placePedestrians(config: EraConfig): void {
    const pedestrianCount = Math.floor(30 * config.pedestrianDensity);

    for (let i = 0; i < pedestrianCount; i++) {
      const x = (Math.random() - 0.5) * 70;
      const z = (Math.random() - 0.5) * 70;
      const y = 0.1;

      const pedestrian = this._createPedestrian(config.pedestrianOutfit);

      pedestrian.position.set(x, y, z);
      pedestrian.rotation.y = Math.random() * Math.PI * 2;

      this.scene.add(pedestrian);
      this.eraObjects.push(pedestrian);
    }
  }

  private _createPedestrian(outfit: string): THREE.Group {
    const group = new THREE.Group();

    // Body
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: outfit === '1940s' ? new THREE.Color('#8B4513') :
            outfit === '1960s' ? new THREE.Color('#D2691E') :
            outfit === '1980s' ? new THREE.Color('#8B0000') :
            outfit === 'early2000s' ? new THREE.Color('#2F4F4F') :
            new THREE.Color('#1A1A2E'),
    });

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 1.5, 0.5),
      bodyMaterial
    );
    group.add(body);

    // Hat (for certain eras)
    if (outfit === '1940s' || outfit === '1960s') {
      const hatMaterial = new THREE.MeshStandardMaterial({ color: '#000000' });
      const hat = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.2, 0.3),
        hatMaterial
      );
      hat.position.y = 1.6;
      group.add(hat);
    }

    // Walking animation - slight bob
    group.userData = { startTime: Date.now(), outfit };

    return group;
  }

  /**
   * Animation loop
   */
  animate(): void {
    requestAnimationFrame(() => this.animate());

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  start(): void {
    this.animate();
  }
}