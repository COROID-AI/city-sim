import { useEffect, useState } from 'react';

/**
 * Loader: DOM overlay shown while the WebGL scene warms up. It fades out when
 * `loading` flips false. Also used by the error boundary as a retry button.
 */
export function Loader({ loading, onRetry }: { loading: boolean; onRetry?: () => void }) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!loading) {
      const t = setTimeout(() => setHidden(true), 500);
      return () => clearTimeout(t);
    }
    setHidden(false);
    return undefined;
  }, [loading]);

  if (hidden) return null;

  return (
    <div className={`loader ${!loading ? 'loader-done' : ''}`}>
      <div className="loader-inner">
        <div className="loader-logo">◈</div>
        <div className="loader-title">City Time Period Timelapse</div>
        <div className="loader-bar">
          <div className="loader-bar-fill" />
        </div>
        <div className="loader-sub">
          {loading ? 'Building the city block…' : 'Ready'}
        </div>
        {!loading && onRetry && (
          <button className="loader-retry" onClick={onRetry}>
            Reconnect
          </button>
        )}
      </div>
    </div>
  );
}