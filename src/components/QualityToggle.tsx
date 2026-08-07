import { useQualityStore } from '../store/useQualityStore';

/**
 * Toggle for the render-quality preset. Switching to "low" disables heavy
 * effects (notably screen-space ambient occlusion) for lower-end devices.
 */
export function QualityToggle() {
  const quality = useQualityStore((s) => s.quality);
  const toggleQuality = useQualityStore((s) => s.toggleQuality);
  const high = quality === 'high';

  return (
    <button
      type="button"
      className={`quality-toggle${high ? '' : ' low'}`}
      onClick={toggleQuality}
      aria-pressed={high}
      aria-label={`Post-processing quality: ${high ? 'high' : 'low'}`}
      title="Toggle heavy post-processing (ambient occlusion)"
    >
      <span className="quality-toggle-label">Quality</span>
      <span className="quality-toggle-value">{high ? 'High' : 'Low'}</span>
    </button>
  );
}
