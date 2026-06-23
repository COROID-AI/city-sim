/**
 * Renderer particle effect tests (spec §8 Phase 7).
 *
 * Covers: dust trail spawning for moving vehicles, no dust for stopped
 * vehicles, and zzZ sleep indicators for sleeping citizens.
 */
import { Renderer } from '@/engine/Renderer';
import { TILE_SIZE, World } from '@/engine/World';
import { Vehicle } from '@/entities/Vehicle';
import { Citizen } from '@/entities/Citizen';

/** Minimal mock canvas 2D context that records draw calls. */
function makeMockCtx() {
  const calls: {
    method: string;
    args: unknown[];
  }[] = [];
  const ctx = {
    save: () => calls.push({ method: 'save', args: [] }),
    restore: () => calls.push({ method: 'restore', args: [] }),
    scale: (...a: number[]) => calls.push({ method: 'scale', args: a }),
    translate: (...a: number[]) => calls.push({ method: 'translate', args: a }),
    rotate: (...a: number[]) => calls.push({ method: 'rotate', args: a }),
    fillRect: (...a: number[]) => calls.push({ method: 'fillRect', args: a }),
    arc: (...a: number[]) => calls.push({ method: 'arc', args: a }),
    beginPath: () => calls.push({ method: 'beginPath', args: [] }),
    fill: () => calls.push({ method: 'fill', args: [] }),
    moveTo: (...a: number[]) => calls.push({ method: 'moveTo', args: a }),
    fillText: (...a: unknown[]) => calls.push({ method: 'fillText', args: a }),
    drawImage: (...a: unknown[]) => calls.push({ method: 'drawImage', args: a }),
    createRadialGradient: () => ({
      addColorStop: () => {},
    }),
    createLinearGradient: () => ({
      addColorStop: () => {},
    }),
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    globalAlpha: 1,
    globalCompositeOperation: '',
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

/** Build a minimal World with given vehicles and citizens. */
function makeWorld(
  vehicles: Vehicle[] = [],
  citizens: Citizen[] = [],
): World {
  const world = {
    width: 80,
    height: 80,
    grid: [],
    buildings: new Map(),
    vehicles,
    citizens,
  };
  return world as unknown as World;
}

describe('Renderer particle effects (Phase 7)', () => {
  describe('drawDustTrails', () => {
    it('spawns dust particles for moving vehicles', () => {
      const { ctx, calls } = makeMockCtx();
      const vehicle = new Vehicle(
        { x: 10, y: 10 },
        { velocity: { x: 5, y: 0 } },
      );
      const world = makeWorld([vehicle]);
      const renderer = new Renderer(ctx, world);
      renderer.drawDustTrails();
      // Should have spawned at least one particle and drawn an arc.
      expect(renderer.getDustParticleCount()).toBeGreaterThan(0);
      const arcCalls = calls.filter((c) => c.method === 'arc');
      expect(arcCalls.length).toBeGreaterThan(0);
    });

    it('does NOT spawn dust for stopped vehicles', () => {
      const { ctx } = makeMockCtx();
      const vehicle = new Vehicle(
        { x: 10, y: 10 },
        { velocity: { x: 0, y: 0 } },
      );
      const world = makeWorld([vehicle]);
      const renderer = new Renderer(ctx, world);
      renderer.drawDustTrails();
      expect(renderer.getDustParticleCount()).toBe(0);
    });

    it('caps particle pool at 50', () => {
      const { ctx } = makeMockCtx();
      // Create many fast vehicles to saturate the pool.
      const vehicles: Vehicle[] = [];
      for (let i = 0; i < 100; i++) {
        vehicles.push(
          new Vehicle(
            { x: i, y: i },
            { velocity: { x: 10, y: 10 } },
          ),
        );
      }
      const world = makeWorld(vehicles);
      const renderer = new Renderer(ctx, world);
      renderer.drawDustTrails();
      expect(renderer.getDustParticleCount()).toBeLessThanOrEqual(50);
    });
  });

  describe('drawSleepIndicators', () => {
    it('renders z text above sleeping citizens', () => {
      const { ctx, calls } = makeMockCtx();
      const citizen = new Citizen({ x: 10 * TILE_SIZE, y: 10 * TILE_SIZE });
      citizen.activity = 'sleeping';
      citizen.visible = true;
      const world = makeWorld([], [citizen]);
      const renderer = new Renderer(ctx, world);
      renderer.drawSleepIndicators();
      const textCalls = calls.filter((c) => c.method === 'fillText');
      expect(textCalls.length).toBe(1);
      // The text should be 'z'.
      expect(textCalls[0]!.args[0]).toBe('z');
    });

    it('does NOT render z for non-sleeping citizens', () => {
      const { ctx, calls } = makeMockCtx();
      const citizen = new Citizen({ x: 10 * TILE_SIZE, y: 10 * TILE_SIZE });
      citizen.activity = 'working';
      citizen.visible = true;
      const world = makeWorld([], [citizen]);
      const renderer = new Renderer(ctx, world);
      renderer.drawSleepIndicators();
      const textCalls = calls.filter((c) => c.method === 'fillText');
      expect(textCalls.length).toBe(0);
    });

    it('does NOT render z for invisible citizens', () => {
      const { ctx, calls } = makeMockCtx();
      const citizen = new Citizen({ x: 10 * TILE_SIZE, y: 10 * TILE_SIZE });
      citizen.activity = 'sleeping';
      citizen.visible = false;
      const world = makeWorld([], [citizen]);
      const renderer = new Renderer(ctx, world);
      renderer.drawSleepIndicators();
      const textCalls = calls.filter((c) => c.method === 'fillText');
      expect(textCalls.length).toBe(0);
    });
  });
});
