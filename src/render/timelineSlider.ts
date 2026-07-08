import { TIME_PERIODS, DEFAULT_PERIOD, type TimePeriod } from '../core/timePeriod.js';

const SLIDER_STYLES = `
.timeline-root {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 22px 16px;
  background: linear-gradient(135deg, rgba(16,22,34,0.85), rgba(8,12,20,0.85));
  border: 1px solid rgba(120,170,230,0.24);
  border-radius: 16px;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 10px 30px rgba(0,0,0,0.4);
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  color: #eaf2ff;
  user-select: none;
}
.timeline-title {
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #8fd0ff;
  font-weight: 600;
}
.timeline-track {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
}
.timeline-line {
  position: absolute;
  left: 14px;
  right: 14px;
  top: 50%;
  height: 3px;
  transform: translateY(-50%);
  background: rgba(255,255,255,0.14);
  border-radius: 2px;
  z-index: 0;
}
.timeline-line-fill {
  position: absolute;
  left: 14px;
  top: 50%;
  height: 3px;
  transform: translateY(-50%);
  background: linear-gradient(90deg, #3aa0ff, #8fe0ff);
  border-radius: 2px;
  z-index: 1;
  transition: width 0.45s cubic-bezier(0.22,1,0.36,1);
}
.timeline-stops {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 38px;
}
.timeline-stop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
  color: inherit;
  font-family: inherit;
}
.timeline-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #0d1320;
  border: 2px solid rgba(160,200,255,0.5);
  transition: all 0.25s cubic-bezier(0.22,1,0.36,1);
}
.timeline-stop:hover .timeline-dot {
  border-color: #8fe0ff;
  transform: scale(1.15);
}
.timeline-stop.active .timeline-dot {
  background: radial-gradient(circle at 35% 35%, #bfe6ff, #3aa0ff);
  border-color: #bfe6ff;
  box-shadow: 0 0 12px rgba(120,200,255,0.85);
  transform: scale(1.2);
}
.timeline-year {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
  color: rgba(234,242,255,0.6);
  transition: color 0.25s;
}
.timeline-stop:hover .timeline-year { color: #cfe6ff; }
.timeline-stop.active .timeline-year { color: #ffffff; }
.timeline-hint {
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(234,242,255,0.4);
}
`;

export class TimelineSlider {
  private root: HTMLDivElement;
  private styleEl: HTMLStyleElement;
  private lineFill: HTMLDivElement;
  private stops: HTMLButtonElement[] = [];
  private dots: HTMLDivElement[] = [];
  private current: TimePeriod = DEFAULT_PERIOD;
  private callback: ((period: TimePeriod) => void) | null = null;

  constructor() {
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = SLIDER_STYLES;
    document.head.appendChild(this.styleEl);

    this.root = document.createElement('div');
    this.root.className = 'timeline-root';

    const title = document.createElement('div');
    title.className = 'timeline-title';
    title.textContent = 'City Timeline';
    this.root.appendChild(title);

    const track = document.createElement('div');
    track.className = 'timeline-track';

    const line = document.createElement('div');
    line.className = 'timeline-line';
    track.appendChild(line);

    this.lineFill = document.createElement('div');
    this.lineFill.className = 'timeline-line-fill';
    track.appendChild(this.lineFill);

    const stopsWrap = document.createElement('div');
    stopsWrap.className = 'timeline-stops';

    TIME_PERIODS.forEach((year) => {
      const btn = document.createElement('button');
      btn.className = 'timeline-stop';
      btn.type = 'button';
      btn.setAttribute('aria-label', `Select year ${year}`);

      const dot = document.createElement('div');
      dot.className = 'timeline-dot';
      btn.appendChild(dot);

      const label = document.createElement('span');
      label.className = 'timeline-year';
      label.textContent = String(year);
      btn.appendChild(label);

      btn.addEventListener('click', () => this.select(year));
      this.stops.push(btn);
      this.dots.push(dot);
      stopsWrap.appendChild(btn);
    });

    track.appendChild(stopsWrap);
    this.root.appendChild(track);

    const hint = document.createElement('div');
    hint.className = 'timeline-hint';
    hint.textContent = 'Click a year to travel through time';
    this.root.appendChild(hint);

    document.body.appendChild(this.root);
    this.renderActive();
  }

  private select(year: TimePeriod): void {
    if (year === this.current) return;
    this.current = year;
    this.renderActive();
    this.callback?.(year);
  }

  private renderActive(): void {
    const idx = TIME_PERIODS.indexOf(this.current);
    this.stops.forEach((s, i) => s.classList.toggle('active', i === idx));
    const pct = TIME_PERIODS.length > 1 ? (idx / (TIME_PERIODS.length - 1)) * 100 : 0;
    this.lineFill.style.width = `calc(${pct}% * (100% - 28px) / 100%)`;
  }

  onPeriodChange(cb: (period: TimePeriod) => void): void {
    this.callback = cb;
  }

  dispose(): void {
    this.styleEl.remove();
    this.root.remove();
    this.callback = null;
  }
}
