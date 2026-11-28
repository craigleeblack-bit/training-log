import { useEffect, useState } from 'react';

/** Wide enough for the desktop layout: the tab rail on the left and the Plan workspace. */
export const WIDE_QUERY = '(min-width: 960px)';

const matches = (query: string) => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches;

/** Whether the window currently matches a media query, kept current as it is resized. */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => matches(query));
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const update = () => setOn(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return on;
}

/** True on a PC-sized window, where Plan opens as a workspace with the routine editor beside it. */
export const useWide = (): boolean => useMedia(WIDE_QUERY);
