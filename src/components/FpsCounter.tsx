import { useEffect, useRef, useState } from 'react';

/**
 * Lightweight FPS readout for QA / performance profiling. Uses a sliding
 * window average of frame deltas from requestAnimationFrame. Renders a small
 * overlay chip showing the current FPS and the target (60).
 */
export function FpsCounter() {
  const [fps, setFps] = useState(0);
  const frames = useRef<number[]>([]);
  const last = useRef<number>(performance.now());
  const raf = useRef(0);

  useEffect(() => {
    // Throttle React state updates so the header does not re-render on every
    // animation frame (which would fight the WebGL main thread on slow/software
    // renderers). We push frame deltas continuously but only setState ~2x/sec.
    let lastCommit = performance.now();
    const tick = (now: number) => {
      const dt = now - last.current;
      last.current = now;
      if (dt > 0 && dt < 500) {
        frames.current.push(1000 / dt);
        if (frames.current.length > 60) frames.current.shift();
        if (now - lastCommit >= 500) {
          lastCommit = now;
          const avg =
            frames.current.reduce((a, b) => a + b, 0) / frames.current.length;
          setFps(avg);
        }
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const ok = fps >= 55;
  const poor = fps < 40;

  return (
    <div
      className={`fps-counter${ok ? '' : poor ? ' poor' : ' warn'}`}
      role="status"
      aria-label={`Frame rate: ${Math.round(fps)} frames per second`}
    >
      <span className="fps-label">FPS</span>
      <span className="fps-value">{Math.round(fps)}</span>
      <span className="fps-target">/60</span>
    </div>
  );
}
