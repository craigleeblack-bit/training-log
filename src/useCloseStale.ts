import { useEffect } from 'react';
import { db } from './db/schema';
import { closeStaleWorkouts } from './lib/close';
import { isoDate } from './lib/dates';
import { useToday } from './useToday';

/**
 * Close sessions left open from an earlier day: when the app starts, whenever it comes back into
 * view, and at local midnight (when `useToday` moves on).
 */
export function useCloseStale(): void {
  const today = useToday();
  useEffect(() => {
    const run = () => void closeStaleWorkouts(db, isoDate()).catch(() => {});
    run();
    const wake = () => document.visibilityState === 'visible' && run();
    document.addEventListener('visibilitychange', wake);
    return () => document.removeEventListener('visibilitychange', wake);
  }, [today]);
}
