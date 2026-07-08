import type { SimulationState } from '../core/scene.js';

const HUD_STYLES = `
.hud-root {
  position: fixed;
  top: 16px;
  left: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  z-index: 10;
  pointer-events: none;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  color: #eaf2ff;
  text-shadow: 0 1px 4px rgba(0,0,0,0.65);
}
.hud-card {
  background: linear-gradient(135deg, rgba(18,26,40,0.82), rgba(10,14,22,0.82));
  border: 1px solid rgba(120,170,230,0.22);
  border-radius: 12px;
  padding: 10px 14px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 6px 18px rgba(0,0,0,0.35);
  min-width: 168px;
}
.hud-period {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #8fd0ff;
  margin-bottom: 2px;
}
.hud-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.hud-label {
  font-size: 11px;
  opacity: 0.72;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.hud-value {
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.hud-clock {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
}
.hud-budget {
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.hud-progress {
  margin-top: 6px;
  height: 4px;
  border-radius: 2px;
  background: rgba(255,255,255,0.12);
  overflow: hidden;
  opacity: 0;
  transition: opacity 0.2s;
}
.hud-progress.active { opacity: 1; }
.hud-progress-bar {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, #3aa0ff, #8fe0ff);
  border-radius: 2px;
}
`;

function formatClock(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60);
  const hh = ((h + 11) % 12) + 1;
  const ap = h < 12 || h === 24 ? 'AM' : 'PM';
  return `${hh}:${m.toString().padStart(2, '0')} ${ap}`;
}

function formatBudget(population: number, period: number): string {
  const basePerCapita = period <= 1945 ? 1200 : period <= 1965 ? 3200 : period <= 1985 ? 9500 : period <= 2005 ? 24000 : 42000;
  const total = population * basePerCapita;
  if (total >= 1_000_000) return `$${(total / 1_000_000).toFixed(2)}M`;
  if (total >= 1_000) return `$${(total / 1_000).toFixed(1)}K`;
  return `$${total}`;
}

function employmentRate(population: number, period: number): string {
  const base = period <= 1945 ? 0.38 : period <= 1965 ? 0.44 : period <= 1985 ? 0.52 : period <= 2005 ? 0.6 : 0.66;
  const working = Math.round(population * base);
  const pct = Math.round(base * 100);
  return `${working.toLocaleString()} (${pct}%)`;
}

export class HUD {
  private root: HTMLDivElement;
  private periodEl: HTMLDivElement;
  private popEl: HTMLSpanElement;
  private empEl: HTMLSpanElement;
  private vehEl: HTMLSpanElement;
  private clockEl: HTMLSpanElement;
  private budgetEl: HTMLSpanElement;
  private progressEl: HTMLDivElement;
  private progressBar: HTMLDivElement;
  private styleEl: HTMLStyleElement;

  constructor() {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = HUD_STYLES;
    document.head.appendChild(this.styleEl);

    this.root = document.createElement('div');
    this.root.className = 'hud-root';

    this.periodEl = document.createElement('div');
    this.periodEl.className = 'hud-period';
    this.periodEl.textContent = '—';

    const clockCard = this.makeCard();
    this.clockEl = this.makeValue();
    clockCard.appendChild(this.row('Time of Day', this.clockEl, 'hud-clock'));

    const popCard = this.makeCard();
    this.popEl = this.makeValue();
    popCard.appendChild(this.row('Population', this.popEl));

    const empCard = this.makeCard();
    this.empEl = this.makeValue();
    empCard.appendChild(this.row('Employment', this.empEl));

    const vehCard = this.makeCard();
    this.vehEl = this.makeValue();
    vehCard.appendChild(this.row('Vehicles', this.vehEl));

    const budgetCard = this.makeCard();
    this.budgetEl = this.makeValue('hud-budget');
    budgetCard.appendChild(this.row('City Budget', this.budgetEl));

    this.progressEl = document.createElement('div');
    this.progressEl.className = 'hud-progress';
    this.progressBar = document.createElement('div');
    this.progressBar.className = 'hud-progress-bar';
    this.progressEl.appendChild(this.progressBar);
    popCard.appendChild(this.progressEl);

    this.root.appendChild(this.periodEl);
    this.root.appendChild(clockCard);
    this.root.appendChild(popCard);
    this.root.appendChild(empCard);
    this.root.appendChild(vehCard);
    this.root.appendChild(budgetCard);

    document.body.appendChild(this.root);
  }

  private makeCard(): HTMLDivElement {
    const c = document.createElement('div');
    c.className = 'hud-card';
    return c;
  }

  private makeValue(extraClass = ''): HTMLSpanElement {
    const s = document.createElement('span');
    s.className = `hud-value ${extraClass}`.trim();
    return s;
  }

  private row(label: string, value: HTMLElement, valueClass = ''): HTMLDivElement {
    const r = document.createElement('div');
    r.className = 'hud-row';
    const l = document.createElement('span');
    l.className = 'hud-label';
    l.textContent = label;
    if (valueClass) value.className = valueClass;
    r.appendChild(l);
    r.appendChild(value);
    return r;
  }

  update(state: SimulationState): void {
    this.periodEl.textContent = `Era · ${state.period}`;
    this.popEl.textContent = state.population.toLocaleString();
    this.empEl.textContent = employmentRate(state.population, state.period);
    this.vehEl.textContent = state.vehicles.toLocaleString();
    this.clockEl.textContent = formatClock(state.simHour);
    this.budgetEl.textContent = formatBudget(state.population, state.period);

    if (state.isTransitioning) {
      this.progressEl.classList.add('active');
      this.progressBar.style.width = `${Math.round(state.transitionProgress * 100)}%`;
    } else {
      this.progressEl.classList.remove('active');
      this.progressBar.style.width = '100%';
    }
  }

  dispose(): void {
    this.styleEl.remove();
    this.root.remove();
  }
}
