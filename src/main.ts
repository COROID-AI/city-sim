/**
 * Application entry point — the milestone boot.
 *
 * Phase 1 boots the kernel and renders the placeholder lit room from
 * `src/core/milestone.ts` so the page loads and renders before any period
 * domain exists. The app composition layer (phase 6) takes over the final
 * content of this file: the timeline slider, the period registry, the ten
 * domain modules and the audio bus.
 */

import { createKernel, type Kernel } from './core/kernel';
import { MILESTONE_PERIOD, buildMilestoneRoom, type MilestoneRoom } from './core/milestone';

declare global {
  interface Window {
    /** Debug handle for the running scene (manual QA and later composition). */
    cafeKernel?: Kernel;
  }
}

interface BootHandle {
  readonly kernel: Kernel;
  readonly room: MilestoneRoom;
  dispose(): void;
}

/** Returns the scene container, creating it if the document does not provide one. */
function ensureContainer(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const existing = document.getElementById('app');
  if (existing) return existing;
  const created = document.createElement('div');
  created.id = 'app';
  created.style.position = 'fixed';
  created.style.inset = '0';
  document.body.appendChild(created);
  return created;
}

/** Shows a small, non-blocking status chip (headless fallback or boot failure). */
function announceStatus(message: string): void {
  if (typeof document === 'undefined' || !document.body) return;
  const chip = document.createElement('p');
  chip.id = 'scene-status';
  chip.textContent = message;
  chip.setAttribute('role', 'status');
  chip.style.position = 'fixed';
  chip.style.left = '50%';
  chip.style.bottom = '1.25rem';
  chip.style.transform = 'translateX(-50%)';
  chip.style.margin = '0';
  chip.style.padding = '0.5rem 0.9rem';
  chip.style.borderRadius = '999px';
  chip.style.background = 'rgba(22, 17, 13, 0.78)';
  chip.style.color = '#f4ead9';
  chip.style.font = '0.8rem/1.4 system-ui, sans-serif';
  chip.style.pointerEvents = 'none';
  document.body.appendChild(chip);
}

function boot(): BootHandle {
  const container = ensureContainer();
  const kernel = createKernel(container, {
    background: MILESTONE_PERIOD.palette.background,
  });
  const room = buildMilestoneRoom(kernel.scene, { period: MILESTONE_PERIOD, bounds: kernel.bounds });

  if (kernel.headless) {
    announceStatus('WebGL is unavailable here — the café is running headless.');
  }

  kernel.start();

  const handle: BootHandle = {
    kernel,
    room,
    dispose(): void {
      room.dispose();
      kernel.dispose();
    },
  };

  window.cafeKernel = kernel;
  window.addEventListener('pagehide', () => handle.dispose(), { once: true });
  return handle;
}

function main(): void {
  try {
    const handle = boot();
    if (import.meta.hot) {
      import.meta.hot.dispose(() => handle.dispose());
    }
  } catch (error) {
    console.error('[cafe] failed to boot the scene', error);
    announceStatus('The café scene failed to start — see the console for details.');
  }
}

main();
