/** Small, DOM-only controller for the era-context inspection card. */
import { getEraTint } from './metadata.js';

export function createInfoCard(opts) {
  const { cardEl, closeEl, nameEl, storyEl, eraEl, getActiveEra } = opts;
  let open = false;

  function openCard(card) {
    const era = card?.era || getActiveEra();
    nameEl.textContent = card?.name || '';
    storyEl.textContent = card?.story || '';
    eraEl.textContent = era?.year ? `Café · ${era.year}` : '';
    cardEl.style.setProperty('--accent', getEraTint(era));
    cardEl.classList.add('open');
    cardEl.setAttribute('aria-hidden', 'false');
    open = true;
  }

  function close() {
    cardEl.classList.remove('open');
    cardEl.setAttribute('aria-hidden', 'true');
    open = false;
  }

  closeEl.addEventListener('click', close);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  return { open: openCard, close, get isOpen() { return open; } };
}