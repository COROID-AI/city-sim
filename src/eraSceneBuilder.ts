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
  /** Transition state for era switching */
  private transitionState = {
    isTransitioning: false,
    startTime: 0,
    duration: 1000, // 1 second transition
    endAlpha: 0.3
  };

  /** Switch to a specific era with smooth transition */
  switchEra(year: number): void {
    // Prevent multiple simultaneous transitions
    if (this.transitionState.isTransitioning) {
      console.warn('Transition already in progress, skipping');
      return;
    }

    const eraConfig = getEraConfig(year);
    if (!eraConfig) {
      console.warn(`No era configuration found for year ${year}`);
      return;
    }

    this.transitionState.isTransitioning = true;
    this.transitionState.startTime = Date.now();

    // Clear previous era objects first
    this._clearEraObjects();

    // Generate the new era's city block immediately
    this._buildEraCityBlock(eraConfig);

    // Fade in the new era over the transition duration
    const start = performance.now();
    const animateTransition = () => {
      const elapsed = performance.now() - start;
      const t = Math.min(elapsed / this.transitionState.duration, 1);

      // Apply fade alpha to all era objects
      this.eraObjects.forEach((obj) => {
        if ('opacity' in obj.material) {
          ;(obj.material as THREE.Material).opacity = 1 - t;
        }
      });

      if (t < 1) {
        requestAnimationFrame(animateTransition);
      } else {
        this.transitionState.isTransitioning = false;
      }
    };

    requestAnimationFrame(animateTransition);

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
    const gridSize = 8;
    const buildingWidth = 5;
    const buildingDepth = 5;

    // Create a proper city block - buildings along the perimeter with a central plaza
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        // Create corner buildings (larger, more prominent)
        if (row === 0 || row === gridSize - 1 || col === 0 || col === gridSize - 1) {
          const height = 4 + config.buildingHeightFactor * (row < 3 ? 0.5 : 1);

          // Create building material with era-appropriate colors
          const material = new THREE.MeshStandardMaterial({
            color: this._getEraBuildingColor(config, row, col),
            roughness: 0.7,
          });

          const building = new THREE.Mesh(
            new THREE.BoxGeometry(buildingWidth, height, buildingDepth),
            material
          );

          // Position buildings around the perimeter
          const offset = 2;
          if (row === 0) {
            // Top row
            building.position.set(
              -20 + col * (buildingWidth + offset),
              height / 2,
              -20
            );
          } else if (row === gridSize - 1) {
            // Bottom row
            building.position.set(
              -20 + col * (buildingWidth + offset),
              height / 2,
              20 - buildingDepth
            );
          } else if (col === 0) {
            // Left column
            building.position.set(
              -20,
              height / 2,
              -20 + row * (buildingDepth + offset)
            );
          } else if (col === gridSize - 1) {
            // Right column
            building.position.set(
              20 - buildingWidth,
              height / 2,
              -20 + row * (buildingDepth + offset)
            );
          }

          // Add slight rotation variation
          building.rotation.y = Math.random() * 0.2;

          this.scene.add(building);
          this.eraObjects.push(building);
        }
        // Add a central plaza (open space)
        else if (row >= 3 && row <= 4 && col >= 3 && col <= 4) {
          // Central plaza - just leave empty space
        }
      }
    }
    // Add a central monument/tower for visual interest
    this._addCentralMonument(config);
  }

  /** Get era-appropriate building color based on config and position */
  private _getEraBuildingColor(config: EraConfig, row: number, col: number): THREE.Color {
    const baseColors: {[key: string]: THREE.Color} = {
      '1945': new THREE.Color('#8B4513'),      // Art Deco/Traditional - brown brick
      '1965': new THREE.Color('#FF4500'),      // Mid-Century Modern - orange concrete
      '1985': new THREE.Color('#DA70D6'),      // Post-Modern - purple glass
      '2005': new THREE.Color('#1E90FF'),      // Contemporary - blue glass
      '2025': new THREE.Color('#32CD32'),      // Sustainable/High-Tech - green concrete
    };
    return baseColors[config.year] || new THREE.Color('#808080');
  }

  /** Add a central monument/tower for visual interest */
  private _addCentralMonument(config: EraConfig): void {
    const monumentHeight = 8 + config.buildingHeightFactor * 2;
    const monumentMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(config.buildingColors.primary),
      roughness: 0.5,
    });

    // Create a pyramid/obelisk style monument based on era
    const geometry = new THREE.BoxGeometry(4, monumentHeight, 4);
    const monument = new THREE.Mesh(geometry, monumentMaterial);
    monument.position.set(0, monumentHeight / 2, 0);
    this.scene.add(monument);
    this.eraObjects.push(monument);
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