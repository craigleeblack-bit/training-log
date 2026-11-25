import { useEffect, useRef } from 'react';

/**
 * Keep the screen on while `active` is true. The lock is dropped by the browser whenever the
 * page is hidden, so it is taken again each time the page comes back.
 */
export function useWakeLock(active: boolean): void {
  const lock = useRef<WakeLockSentinel | null>(null);
  useEffect(() => {
    let cancelled = false;
    const acquire = async () => {
      try {
        if (active && !lock.current && 'wakeLock' in navigator && document.visibilityState === 'visible') {
          const sentinel = await navigator.wakeLock.request('screen');
          if (cancelled) void sentinel.release();
          else {
            lock.current = sentinel;
            sentinel.addEventListener('release', () => (lock.current = null));
          }
        }
      } catch {
        /* denied or unsupported */
      }
    };
    if (active) {
      void acquire();
      document.addEventListener('visibilitychange', acquire);
    } else {
      void lock.current?.release();
      lock.current = null;
    }
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
    };
  }, [active]);

  // Let go when the screen using it goes away.
  useEffect(
    () => () => {
      void lock.current?.release();
      lock.current = null;
    },
    [],
  );
}
