import { useSimStore } from '../state/useSimStore';
import { ERA_IDS, ERA_REGISTRY } from '../contracts';

/**
 * Top timeline slider.
 *
 * Exposes exactly the five eras (1945, 1965, 1985, 2005, 2025) as a
 * keyboard-accessible radio group. Selecting an era writes the selection to
 * the shared zustand store via {@link useSimStore.requestTransition}.
 */
export function TimelineSlider() {
  const currentEra = useSimStore((s) => s.currentEra);
  const requestTransition = useSimStore((s) => s.requestTransition);

  return (
    <div
      className="timeline"
      role="radiogroup"
      aria-label="Select time period"
      aria-orientation="horizontal"
    >
      {ERA_IDS.map((era) => (
        <label key={era} className="timeline-option">
          <input
            type="radio"
            name="era"
            value={era}
            checked={currentEra === era}
            onChange={() => requestTransition(era)}
          />
          <span className="timeline-label">{ERA_REGISTRY[era].year}</span>
        </label>
      ))}
    </div>
  );
}
