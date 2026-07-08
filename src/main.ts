import { SceneManager } from './core/scene.js';
import { HUD } from './render/hud.js';
import { TimelineSlider } from './render/timelineSlider.js';
import { Minimap } from './render/minimap.js';
import { SFXManager } from './effects/sfx.js';

// Main application entry point
class CityTimelapseApp {
  private sceneManager: SceneManager;
  private hud: HUD;
  private timelineSlider: TimelineSlider;
  private minimap: Minimap;
  private sfx: SFXManager;
  private animationId: number | null = null;

  constructor() {
    this.sceneManager = new SceneManager();
    this.hud = new HUD();
    this.timelineSlider = new TimelineSlider();
    this.minimap = new Minimap();
    this.sfx = new SFXManager();
    
    this.initialize();
  }

  private initialize(): void {
    // Initialize scene
    this.sceneManager.initialize();
    
    // Setup timeline slider callbacks
    this.timelineSlider.onPeriodChange((period) => {
      this.sfx.playTransitionSound();
      this.sceneManager.transitionToPeriod(period);
    });
    
    // Setup render loop
    this.startRenderLoop();
    
    // Start simulation
    this.sceneManager.startSimulation();
    this.sfx.playAmbientSound();
  }

  private startRenderLoop(): void {
    const animate = () => {
      const deltaTime = 1/60;
      const state = this.sceneManager.update(deltaTime);
      
      // Update UI components
      this.hud.update(state);
      this.minimap.update(this.sceneManager.getCamera(), this.sceneManager.getWorldBounds());
      
      // Render the scene
      this.sceneManager.render();
      
      this.animationId = requestAnimationFrame(animate);
    };
    
    animate();
  }

  public dispose(): void {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    this.sceneManager.dispose();
    this.hud.dispose();
    this.minimap.dispose();
    this.sfx.dispose();
  }
}

// Auto-start when loaded in browser
document.addEventListener('DOMContentLoaded', () => {
  const app = new CityTimelapseApp();
  (window as any).cityApp = app; // Expose for debugging
});