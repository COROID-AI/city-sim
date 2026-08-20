import { useCallback, useEffect, useRef, useState } from 'react';
import { CityTimelapseScene } from './scene';
import { useSim, ERAS, eraPos, eraLabel, yearFromT } from './sim';
import { audioEngine } from './audio';

const fmtHour = (h: number) => {
  const hh = Math.floor(h) % 24;
  const mm = Math.floor((h - Math.floor(h)) * 60);
  const ampm = hh < 12 ? 'AM' : 'PM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${mm.toString().padStart(2, '0')} ${ampm}`;
};

export default function App() {
  const muted = useSim((s) => s.muted);
  const soundEnabled = useSim((s) => s.soundEnabled);
  const contextLost = useSim((s) => s.contextLost);
  const reducedMotion = useSim((s) => s.reducedMotion);
  const webglOk = useSim((s) => s.webglOk);
  const playing = useSim((s) => s.playing);
  const speed = useSim((s) => s.speed);
  const setT = useSim((s) => s.setT);
  const togglePlay = useSim((s) => s.togglePlay);
  const setSpeed = useSim((s) => s.setSpeed);
  const setSoundEnabled = useSim((s) => s.setSoundEnabled);
  const toggleMuted = useSim((s) => s.toggleMuted);
  const setReducedMotion = useSim((s) => s.setReducedMotion);
  const jumpToEra = useSim((s) => s.jumpToEra);
  const setWebglOk = useSim((s) => s.setWebglOk);

  const [hoveredEra, setHoveredEra] = useState<number | null>(null);
  const [activeIdx, setActiveIdx] = useState(5);
  const dragging = useRef(false);
  const sliderRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLSpanElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const clockRef = useRef<HTMLDivElement>(null);

  // Test WebGL availability up-front.
  useEffect(() => {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      setWebglOk(!!gl);
    } catch {
      setWebglOk(false);
    }
  }, [setWebglOk]);

  // Imperatively update per-frame readouts from the store (no React re-render
  // during playback/scrub, keeping large scene reconciliation out of the hot path).
  useEffect(() => {
    let lastIdx = -1;
    const unsub = useSim.subscribe((s) => {
      const idx = Math.round(s.t * (ERAS.length - 1));
      if (idx !== lastIdx) {
        lastIdx = idx;
        setActiveIdx(idx);
      }
      if (sliderRef.current) {
        const el = sliderRef.current;
        if (document.activeElement !== el) el.value = String(s.t * 10000);
      }
      if (yearRef.current) yearRef.current.textContent = String(yearFromT(s.t));
      if (labelRef.current) {
        const i = Math.round(s.t * (ERAS.length - 1));
        labelRef.current.textContent = ERAS[Math.min(ERAS.length - 1, Math.max(0, i))].label;
      }
      if (clockRef.current) clockRef.current.textContent = fmtHour(s.hour);
    });
    return unsub;
  }, []);

  // unlock audio on first gesture
  useEffect(() => {
    const unlock = () => {
      audioEngine.unlock();
      setSoundEnabled(true);
    };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [setSoundEnabled]);

  // respect prefers-reduced-motion
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const on = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const scrub = useCallback(
    (v: number) => {
      setT(v);
      audioEngine.click();
    },
    [setT],
  );

  const initialYear = yearFromT(eraPos(5));
  const initialLabel = eraLabel(eraPos(5));

  return (
    <div className="app" onClick={soundEnabled ? undefined : () => { audioEngine.unlock(); setSoundEnabled(true); }}>
      <CityTimelapseScene />

      {/* ===== Top: Timeline + era chips ===== */}
      <div className="topbar">
        <div className="brand">City Time Period Timelapse</div>
        <div className="timeline-wrap">
          <div className="era-chip-row">
            {ERAS.map((er, i) => {
              const active = i === activeIdx;
              return (
                <button
                  key={er.year}
                  className={`era-chip ${active ? 'active' : ''}`}
                  onMouseEnter={() => setHoveredEra(i)}
                  onMouseLeave={() => setHoveredEra(null)}
                  onClick={() => jumpToEra(i)}
                  style={{ left: `${eraPos(i) * 100}%` }}
                >
                  {er.short}
                </button>
              );
            })}
          </div>
          <input
            ref={sliderRef}
            type="range"
            className="timeline"
            min={0}
            max={10000}
            defaultValue={eraPos(5) * 10000}
            onChange={(e) => scrub(Number(e.target.value) / 10000)}
            onPointerDown={() => { dragging.current = true; audioEngine.unlock(); }}
            onPointerUp={() => { dragging.current = false; }}
            onTouchStart={(e) => { audioEngine.unlock(); e.stopPropagation(); }}
          />
          <div className="timeline-scale">
            <span>{ERAS[0].year}</span>
            <span>{ERAS[ERAS.length - 1].year}</span>
          </div>
        </div>
        <div className="year-readout">
          <span className="year" ref={yearRef}>{initialYear}</span>
          <span className="era-label" ref={labelRef}>{hoveredEra != null ? ERAS[hoveredEra].label : initialLabel}</span>
        </div>
      </div>

      {/* ===== Transport + settings ===== */}
      <div className="controls">
        <button className="icon-btn" onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
          {playing ? '⏸' : '▶'}
        </button>
        <div className="speed-row">
          {[0.5, 1, 2, 4].map((s) => (
            <button key={s} className={`speed ${speed === s ? 'active' : ''}`} onClick={() => setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        <button className="icon-btn" onClick={toggleMuted} title={muted ? 'Unmute' : 'Mute'}>
          {muted ? '🔇' : '🔊'}
        </button>
      </div>

      {/* ===== HUD ===== */}
      <div className="hud">
        <div className="hud-clock" ref={clockRef}>{fmtHour(11.5)}</div>
        <div className="hud-sec">drag to look · scroll to zoom</div>
      </div>

      {/* ===== Context banner ===== */}
      {contextLost && (
        <div className="banner error">
          WebGL context lost. Attempting to restore — click anywhere to resume.
        </div>
      )}
      {!webglOk && (
        <div className="banner error">
          WebGL is not available. This 3D experience needs WebGL — enable hardware acceleration or try another browser.
        </div>
      )}
      {!soundEnabled && !muted && (
        <div className="banner hint">Click anywhere to enable sound &amp; start the timelapse</div>
      )}
    </div>
  );
}