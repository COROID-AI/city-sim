/* HUD / overlay driver. Owns every DOM mutation so gameplay modules stay
 * canvas-side. Element ids match index.html; classes match css/style.css. */

const $ = (id) => document.getElementById(id);

const STATES = ['state-menu', 'state-playing', 'state-paused', 'state-gameover'];
const TIERS = ['tier-high', 'tier-medium', 'tier-low'];

function fmtPop(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(0) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(Math.max(0, Math.round(n)));
}

export class UI {
  constructor(handlers) {
    this.body = document.body;
    this.canvas = $('c');
    this.hud = $('hud');
    this.el = {
      integrityBar: $('integrity-bar'),
      integrityNum: $('integrity-num'),
      population: $('population'),
      popDelta: $('population-delta'),
      dock: $('dock'),
      toasts: $('toasts'),
      crosshair: $('crosshair'),
      flash: $('flash'),
      start: $('start'),
      pause: $('pause'),
      help: $('help'),
      gameover: $('gameover'),
      fatal: $('fatal'),
      fatalMsg: $('fatal-msg'),
      btnQuality: $('btn-quality'),
      btnMute: $('btn-mute'),
      btnHelp: $('btn-help'),
      btnStart: $('btn-start'),
      btnHelpClose: $('btn-help-close'),
      goRebuild: $('go-rebuild'),
      goTime: $('go-time'),
      goShots: $('go-shots'),
      goFlavor: $('go-flavor')
    };
    this.slots = [];
    this.deltaTimer = 0;
    this.handlers = handlers;

    this.el.btnStart.addEventListener('click', () => handlers.onStart());
    this.el.goRebuild.addEventListener('click', () => handlers.onRebuild());
    this.el.btnQuality.addEventListener('click', () => handlers.onQuality());
    this.el.btnMute.addEventListener('click', () => handlers.onMute());
    this.el.btnHelp.addEventListener('click', () => handlers.onHelp());
    this.el.btnHelpClose.addEventListener('click', () => handlers.onHelpClose());

    /* Buttons live inside the (opacity-faded) HUD on the menu screen — make
     * sure stray clicks on their area never reach the canvas. */
    for (const b of [this.el.btnQuality, this.el.btnMute, this.el.btnHelp]) {
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
  }

  /* ---------- states & overlays ---------- */

  setState(state) {
    for (const s of STATES) this.body.classList.remove(s);
    this.body.classList.add('state-' + state);
    /* HUD buttons are pointer-events:auto even while the HUD is faded out,
     * so hide it outright on screens where it must not intercept input. */
    this.hud.style.visibility = state === 'menu' ? 'hidden' : 'visible';
    this.canvas.classList.toggle('dead', state === 'gameover');
  }

  setTier(idShort) {
    for (const t of TIERS) this.body.classList.remove(t);
    this.body.classList.add('tier-' + idShort);
  }

  overlay(name, show) {
    const el = this.el[name];
    if (el) el.classList.toggle('hidden', !show);
  }

  fatal(msg) {
    if (msg) this.el.fatalMsg.textContent = msg;
    this.el.fatal.classList.remove('hidden');
  }

  /* ---------- weapon dock ---------- */

  buildDock(weapons) {
    this.el.dock.innerHTML = '';
    this.slots = weapons.map((w, i) => {
      const b = document.createElement('button');
      b.className = 'slot';
      b.title = w.name + ' [' + w.key + ']';
      b.innerHTML =
        '<span class="key">' + w.key + '</span>' + w.icon + '<span class="nm">' + w.name + '</span>';
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', () => this.handlers.onSelect(i));
      this.el.dock.appendChild(b);
      return b;
    });
  }

  select(i) {
    this.slots.forEach((s, j) => s.classList.toggle('selected', i === j));
  }

  cooldown(i, frac) {
    const s = this.slots[i];
    if (!s) return;
    s.style.setProperty('--p', frac > 0.001 ? frac.toFixed(3) : '0');
    s.classList.toggle('cd', frac > 0.001);
  }

  hot(isHot) {
    const s = this.slots[this.selected ?? 0];
    if (s) s.classList.toggle('hot', !!isHot);
  }

  setSelectedRef(i) { this.selected = i; }

  /* ---------- planet panel ---------- */

  integrity(frac) {
    const f = Math.max(0, Math.min(1, frac));
    this.el.integrityBar.querySelector('i').style.transform = 'scaleX(' + f + ')';
    this.el.integrityNum.textContent = Math.round(f * 100) + '%';
    this.el.integrityBar.classList.toggle('critical', f < 0.25);
  }

  population(value) {
    this.el.population.textContent = fmtPop(Math.max(0, value));
  }

  populationDelta(killed) {
    if (killed <= 0) return;
    const el = this.el.popDelta;
    el.textContent = '\u2212' + fmtPop(killed);
    clearTimeout(this.deltaTimer);
    this.deltaTimer = setTimeout(() => { el.textContent = ''; }, 1500);
  }

  /* ---------- feedback ---------- */

  toast(msg, info) {
    const box = this.el.toasts;
    while (box.children.length >= 4) box.removeChild(box.firstChild);
    const t = document.createElement('div');
    t.className = 'toast' + (info ? ' info' : '');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 380);
    }, 2400);
  }

  crosshair(x, y) {
    this.el.crosshair.style.transform =
      'translate(' + (x - 17) + 'px,' + (y - 17) + 'px)';
  }

  flash(v) { this.el.flash.style.opacity = Math.min(1, Math.max(0, v)).toFixed(3); }

  /* ---------- topbar labels ---------- */

  qualityLabel(text) { this.el.btnQuality.textContent = text; }
  muteLabel(muted) { this.el.btnMute.textContent = muted ? 'SND OFF' : 'SND ON'; }

  /* ---------- game over ---------- */

  gameover(stats, flavor) {
    const m = Math.floor(stats.time / 60);
    const s = Math.floor(stats.time % 60);
    this.el.goTime.textContent = m + ':' + String(s).padStart(2, '0');
    this.el.goShots.textContent = String(stats.shots);
    this.el.goFlavor.textContent = flavor;
  }
}
