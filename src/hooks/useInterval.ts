/**
 * useInterval — declarative `setInterval` hook for React 19.
 *
 * Calls `callback` every `delay` milliseconds. Passing `null` as the
 * delay pauses the interval. The latest `callback` is captured via a
 * ref so re-renders do not restart the timer; only a change to
 * `delay` resets the interval.
 *
 * Cleanup is performed on unmount and on every `delay` change, so
 * there is no risk of overlapping intervals even under React 19
 * strict-mode double-invocation.
 *
 * Implementation note: the callback is stored in a ref because the
 * interval handle itself is keyed on the *delay* value. If we
 * depended on `callback` identity we'd restart the interval on every
 * render of the parent.
 */

import { useEffect, useRef } from 'react';

export type UseIntervalCallback = () => void;

/**
 * Run `callback` every `delay` ms.
 *
 * @param callback Function to invoke. The latest reference is always
 *   used; identity changes do not restart the timer.
 * @param delay Interval length in milliseconds, or `null` to pause.
 */
export function useInterval(callback: UseIntervalCallback, delay: number | null): void {
  // Always read the freshest callback without making it a dependency
  // of the effect — re-running the effect on every render would
  // thrash the underlying setInterval handle.
  const savedCallback = useRef<UseIntervalCallback>(callback);
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return undefined;
    if (!Number.isFinite(delay) || delay < 0) return undefined;
    const id = setInterval(() => {
      savedCallback.current();
    }, delay);
    return () => {
      clearInterval(id);
    };
  }, [delay]);
}

export default useInterval;
