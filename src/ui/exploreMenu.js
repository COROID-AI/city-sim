/**
 * src/ui/exploreMenu.js
 *
 * "Explore" menu: per-era preset camera bookmarks (counter/machine, menu
 * board, music source, seating area, wall posters) reachable from a small
 * dropdown, plus a "Return to overview" control. The presets and overview
 * are fully data-driven from the active era's declared metadata (read via
 * src/ui/metadata.js).
 */
import { getOverview, getPresets } from './metadata.js';

/**
 * @param {object} opts
 *   - toggleEl:   the Explore button
 *   - menuEl:     the dropdown list container
 *   - getActiveEra(): () -> era module
 *   - onFlyTo(bookmark): called with a { name, position, target } preset
 *   - onOverview():      called when Return-to-overview is chosen
 */
export function createExploreMenu(opts) {
  const toggleEl = opts.toggleEl;
  const menuEl = opts.menuEl;
  const getActiveEra = opts.getActiveEra;
  const onFlyTo = opts.onFlyTo;
  const onOverview = opts.onOverview;

  let open = false;

  function rebuild() {
    const era = getActiveEra();
    menuEl.innerHTML = '';
    for (const preset of getPresets(era)) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'explore-item';
      item.dataset.testid = `explore-preset-${preset.id || preset.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      item.textContent = preset.name;
      item.addEventListener('click', () => {
        close();
        if (onFlyTo) onFlyTo(preset);
      });
      menuEl.appendChild(item);
    }
    const overview = getOverview(era);
    if (overview) {
      const sep = document.createElement('div');
      sep.className = 'explore-sep';
      menuEl.appendChild(sep);
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'explore-item explore-overview';
      back.textContent = 'Return to overview';
      back.dataset.testid = 'explore-overview';
      back.addEventListener('click', () => {
        close();
        if (onOverview) onOverview(overview);
      });
      menuEl.appendChild(back);
    }
  }

  function openMenu() {
    rebuild();
    open = true;
    menuEl.classList.add('open');
    toggleEl.setAttribute('aria-expanded', 'true');
  }

  function close() {
    open = false;
    menuEl.classList.remove('open');
    toggleEl.setAttribute('aria-expanded', 'false');
  }

  function toggle() {
    if (open) close();
    else openMenu();
  }

  toggleEl.addEventListener('click', toggle);
  toggleEl.setAttribute('aria-haspopup', 'menu');
  toggleEl.setAttribute('aria-expanded', 'false');

  document.addEventListener('pointerdown', (e) => {
    if (open && !menuEl.contains(e.target) && e.target !== toggleEl) close();
  });

  return {
    rebuild,
    open: openMenu,
    close,
    toggle,
    get isOpen() { return open; },
  };
}