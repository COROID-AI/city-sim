/** Browser entrypoint for the composed café experience. */

import { createCafeComposition, reinitCafeComposition, type CafeComposition } from './app/compose';

let active: CafeComposition | null = null;

function boot(): CafeComposition {
  active?.dispose();
  const composition = createCafeComposition({
    container: document.getElementById('app') as HTMLElement | null,
    autoStart: true,
    ui: true,
  });
  active = composition;
  window.cafeReinit = () => {
    active?.dispose();
    active = reinitCafeComposition({
      container: document.getElementById('app') as HTMLElement | null,
      autoStart: true,
      ui: true,
    });
  };
  return composition;
}

function main(): void {
  try {
    boot();
  } catch (error) {
    console.error('[cafe] failed to compose the scene', error);
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = 'The café could not start. Please reload and try again.';
    status.style.cssText =
      'position:fixed;inset:auto 1rem 1rem;padding:.75rem 1rem;margin:0;border-radius:999px;background:#20130d;color:#f4ead9;font:14px system-ui,sans-serif;';
    document.body.appendChild(status);
  }
}

if (typeof document !== 'undefined') main();

export { boot };
