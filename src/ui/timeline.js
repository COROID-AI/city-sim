import { getEraCaption, getEraTint } from './metadata.js';

export const ERA_YEARS = Object.freeze([1945, 1965, 1985, 2005, 2025]);

/** Bind the accessible native range input to its visual stop rail. */
export function createTimeline({ sliderEl, railEl, captionEl, getActiveEra, onSelect }) {
  const wrap = sliderEl?.parentElement;
  let thumbEl;

  function buildRail() {
    if (!railEl) return;
    railEl.querySelectorAll('.era-stop').forEach((el) => el.remove());
    thumbEl = railEl.querySelector('.era-thumb');
    for (let i = 0; i < ERA_YEARS.length; i += 1) {
      const stop = document.createElement('button');
      stop.type = 'button';
      stop.className = 'era-stop';
      stop.dataset.index = String(i);
      stop.textContent = String(ERA_YEARS[i]);
      stop.style.left = `${(i / (ERA_YEARS.length - 1)) * 100}%`;
      stop.setAttribute('aria-label', `Select ${ERA_YEARS[i]} era`);
      stop.dataset.testid = `era-stop-${ERA_YEARS[i]}`;
      stop.addEventListener('click', () => selectYear(ERA_YEARS[i]));
      railEl.appendChild(stop);
    }
  }

  function selectYear(year) {
    const index = ERA_YEARS.indexOf(Number(year));
    if (index < 0) return;
    sliderEl.value = String(index);
    sync();
    onSelect?.(ERA_YEARS[index]);
  }

  function sync() {
    const index = Math.max(0, Math.min(ERA_YEARS.length - 1, Number(sliderEl.value) || 0));
    const era = getActiveEra();
    const tint = getEraTint(era);
    const caption = getEraCaption(era);
    const percent = (index / (ERA_YEARS.length - 1)) * 100;
    sliderEl.setAttribute('aria-valuenow', String(index));
    sliderEl.setAttribute('aria-valuetext', String(ERA_YEARS[index]));
    sliderEl.style.setProperty('--accent', tint);
    railEl?.style.setProperty('--accent', tint);
    railEl?.style.setProperty('--fill', `${percent}%`);
    if (thumbEl) thumbEl.style.left = `${percent}%`;
    railEl?.querySelectorAll('.era-stop').forEach((stop, i) => {
      const active = i === index;
      stop.classList.toggle('active', active);
      stop.setAttribute('aria-pressed', String(active));
    });
    if (captionEl) {
      captionEl.replaceChildren();
      const name = document.createElement('strong');
      name.className = 'caption-name';
      name.textContent = caption.name || String(ERA_YEARS[index]);
      const vibe = document.createElement('span');
      vibe.className = 'caption-vibe';
      vibe.textContent = caption.vibe ? ` — ${caption.vibe}` : '';
      captionEl.append(name, vibe);
    }
  }

  sliderEl.addEventListener('input', () => {
    sync();
    onSelect?.(ERA_YEARS[Math.max(0, Math.min(4, Number(sliderEl.value))) ]);
  });
  sliderEl.addEventListener('pointerdown', () => wrap?.classList.add('dragging'));
  sliderEl.addEventListener('change', () => wrap?.classList.remove('dragging'));
  window.addEventListener('pointerup', () => wrap?.classList.remove('dragging'));
  buildRail();
  sync();
  return { sync, selectYear, get year() { return ERA_YEARS[Number(sliderEl.value)]; } };
}