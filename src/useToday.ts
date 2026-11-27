import { useEffect, useState } from 'react';
import { isoDate } from './lib/dates';

/**
 * Today's date, kept current: checked again when the app comes back into view or focus, and
 * at local midnight. A screen that shows "this week" moves on by itself, with no reload.
 */
export function useToday(): string {
  const [today, setToday] = useState(isoDate);
  useEffect(() => {
    let timer: number | undefined;
    const check = () => setToday(isoDate());
    const arm = () => {
      window.clearTimeout(timer);
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
      timer = window.setTimeout(() => {
        check();
        arm();
      }, midnight.getTime() - now.getTime());
    };
    // A phone asleep overnight may never fire the timer, so waking the app checks too.
    const wake = () => {
      if (document.visibilityState !== 'visible') return;
      check();
      arm();
    };
    arm();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, []);
  return today;
}
