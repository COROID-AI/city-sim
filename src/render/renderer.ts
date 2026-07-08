import * as THREE from 'three';

export class SceneRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private readonly clock = new THREE.Clock();

  constructor(canvas?: HTMLCanvasElement) {
    const params: THREE.WebGLRendererParameters = {
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    };
    this.renderer = new THREE.WebGLRenderer(params);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.sortObjects = true;
    if (!canvas) {
      this.renderer.domElement.style.display = 'block';
    }
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.render(scene, camera);
  }

  setSize(width: number, height: number): void {
    this.renderer.setSize(width, height);
  }

  setExposure(exposure: number): void {
    this.renderer.toneMappingExposure = exposure;
  }

  getDelta(): number {
    return Math.min(this.clock.getDelta(), 0.1);
  }

  get elapsedTime(): number {
    return this.clock.elapsedTime;
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  dispose(): void {
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
