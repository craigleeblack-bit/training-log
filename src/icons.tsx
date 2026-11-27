import type { ReactNode } from 'react';
import { ACTIVITIES, SPACE_ICONS, type ActivityKey, type SpaceIconKey } from './lib/activities';

/* Drawn to match the icons in ui.tsx: a 24 grid, round 1.8 strokes, currentColor. */

const stroke = {
  className: 'ico',
  'aria-hidden': true,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** A gentle wave across the icon at height y. */
const wave = (y: number) => `M3 ${y}q1.5-1.6 3 0t3 0t3 0t3 0t3 0t3 0`;

const svg = (...children: ReactNode[]) => (
  <svg viewBox="0 0 24 24" {...stroke}>
    {children}
  </svg>
);

const head = (cx: number, cy: number) => <circle key="head" cx={cx} cy={cy} r="1.9" />;
const p = (d: string, key = d) => <path key={key} d={d} />;

export const ActivityIcon: Record<ActivityKey, ReactNode> = {
  strength: svg(p('M7 12h10'), <rect key="l" x="4" y="7.5" width="3" height="9" rx="1" />, <rect key="r" x="17" y="7.5" width="3" height="9" rx="1" />, p('M2.5 10.5v3M21.5 10.5v3')),
  kettlebell: svg(p('M8.2 12.8V6.5A1.8 1.8 0 0 1 10 4.7h4a1.8 1.8 0 0 1 1.8 1.8v6.3'), p('M7.2 19.8a5.6 5.6 0 1 1 9.6 0z')),
  bodyweight: svg(head(5, 9.6), p('M7.4 11 20 14.2'), p('M9.2 11.6 8.6 17'), p('M20 14.2 19.4 17'), p('M3 19h18')),
  core: svg(<rect key="a" x="6.5" y="3.5" width="11" height="17" rx="4" />, p('M12 3.5v17M6.5 9h11M6.5 14.5h11')),
  hiit: svg(p('M13 3 5 13.5h6L10 21l8-10.5h-6z')),
  run: svg(head(15.5, 4.5), p('M8.5 10.5 11.5 8h3l2.5 3'), p('M14 8l-3 5'), p('M11 13l3 2.5-1 4.5'), p('M11 13l-2.5 3.5H5')),
  walk: svg(head(12.5, 4.4), p('M12.5 8v6'), p('M12.5 9.2l-3 3.3M12.5 9.2l2.8 3'), p('M12.5 14 10 20.5M12.5 14l2.7 3.2v3.3')),
  hike: svg(head(10.5, 4.4), p('M10.5 8 9.5 14'), p('M10 8.8 7 10v4.2'), p('M9.5 14l-2 6.5M9.5 14l3 2.6v3.9'), p('M10.5 9.5l5 1.6'), p('M16.5 8.5v12')),
  cycle: svg(<circle key="a" cx="6" cy="16" r="3.6" />, <circle key="b" cx="18" cy="16" r="3.6" />, p('M6 16l3.5-6.5h5.5M12 16 9.5 9.5M12 16l3.5-6.5L18 16M6 16h6'), p('M8 9.5h3M14 7.5h2.5')),
  swim: svg(head(17.5, 7.5), p('M4 12.5l5-3.2 3.2 2.6 3-1.4'), p(wave(16.5)), p(wave(20.5))),
  row: svg(head(11, 6.5), p('M11 9l1.6 5'), p('M11.5 10.5 16 11'), p('M5 9.5 19 17'), p('M3 15.5h18l-2.2 3.5H5.2z')),
  yoga: svg(head(12, 4.8), p('M12 8v5.5'), p('M12 9.6 8 12.4l-2-1.2M12 9.6l4 2.8 2-1.2'), p('M5 18.5c2-2.2 4.6-3.4 7-3.4s5 1.2 7 3.4'), p('M7.5 18.5h9')),
  mobility: svg(head(8, 5.6), p('M9 8.5c1.5 2 2.5 3.5 3 6'), p('M9.6 9.6C12 8 14.6 5.6 15.6 3.4'), p('M12 14.5l-3.2 6M12 14.5l4.2 6')),
  climb: svg(head(13, 7.5), p('M12.6 9.6 11.8 14'), p('M12.4 10.6 8.5 7M12.4 10.6l4.2-1.4'), p('M11.8 14l-2.6 2.2M11.8 14l3.4 3.4'), <circle key="h1" cx="7.5" cy="6" r="1" fill="currentColor" />, <circle key="h2" cx="18" cy="8.8" r="1" fill="currentColor" />, <circle key="h3" cx="8.2" cy="17.2" r="1" fill="currentColor" />, <circle key="h4" cx="16.2" cy="18.8" r="1" fill="currentColor" />),
  boxing: svg(p('M7 10a5 5 0 0 1 5-5h2a4 4 0 0 1 4 4v4a5 5 0 0 1-5 5H9a2 2 0 0 1-2-2z'), p('M8.5 18v3h7v-3'), p('M7 12.5h3a2 2 0 0 0 2-2')),
  racket: svg(<circle key="h" cx="10" cy="9" r="6" />, p('M14.3 13.3 20 19'), p('M5.5 9h9M10 4.5v9'), <circle key="b" cx="19" cy="5" r="1.4" />),
  team: svg(<circle key="b" cx="12" cy="12" r="8.5" />, p('M12 8.5l3 2.2-1.1 3.6h-3.8L9 10.7z'), p('M12 8.5V3.5M15 10.7l4.6-1.5M13.9 14.3l2.8 3.8M10.1 14.3l-2.8 3.8M9 10.7 4.4 9.2')),
  dance: svg(p('M9 17.5V6l10-2v11.5'), <circle key="a" cx="7" cy="17.5" r="2.2" />, <circle key="b" cx="17" cy="15.5" r="2.2" />, p('M9 9.5l10-2')),
  snow: svg(p('M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9'), p('M9.5 4.5 12 6.5l2.5-2M9.5 19.5l2.5-2 2.5 2')),
  skate: svg(p('M6 4h5v7l6.5 2.4a2.5 2.5 0 0 1 1.5 2.3V17H6z'), p('M4 20.5h16'), p('M8 17v3.5M16 17v3.5')),
  golf: svg(p('M8 20V3.5'), p('M8 3.5l8 3-8 3'), p('M4 20.5c0-1.1 1.8-1.8 4-1.8s4 .7 4 1.8'), <circle key="b" cx="17" cy="18.5" r="1.6" />),
  rest: svg(p('M19 14.5A7.5 7.5 0 1 1 9.5 5a6 6 0 0 0 9.5 9.5z')),
  other: svg(p('M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8z')),
};

export const SpaceIcon: Record<SpaceIconKey, ReactNode> = {
  home: svg(p('M4 11.5 12 4l8 7.5V20H4z'), p('M10 20v-5h4v5')),
  gym: svg(p('M4 20V9.5L12 4l8 5.5V20'), p('M8.5 14.5h7M8.5 12.5v4M15.5 12.5v4'), p('M3 20h18')),
  garage: svg(p('M3 9.5 12 4l9 5.5'), p('M5 20v-9h14v9'), p('M5 14h14M5 17h14'), p('M3 20h18')),
  studio: svg(<circle key="r" cx="17" cy="12.5" r="3.5" />, <circle key="c" cx="17" cy="12.5" r="1.1" />, p('M17 9H5.5A1.5 1.5 0 0 0 4 10.5v6A1.5 1.5 0 0 0 5.5 18h11.5')),
  pool: svg(p('M8 3.5v10M16 3.5v10M8 6.5h8M8 10h8'), p(wave(16.5)), p(wave(20.5))),
  outdoors: svg(p('M12 3 6.5 10.5h3L5 16.5h14l-4.5-6h3z'), p('M12 16.5V21')),
  park: svg(p('M4 11h16M4 14.5h16'), p('M5.5 11V7.5M18.5 11V7.5M4.5 7.5h15'), p('M6 14.5V19M18 14.5V19')),
  track: svg(<rect key="o" x="2.8" y="6" width="18.4" height="12" rx="6" />, <rect key="i" x="7" y="9.6" width="10" height="4.8" rx="2.4" />),
  hills: svg(p('M2.5 19.5 9 9l4 6 2.6-3.6 5.9 8.1z'), <circle key="s" cx="17.5" cy="5.5" r="1.9" />),
  beach: svg(p('M7 13a5 5 0 0 1 10 0'), p('M3 13h18'), p(wave(17)), p(wave(20.8))),
  court: svg(<rect key="c" x="3" y="5" width="18" height="14" rx="1.5" />, p('M12 5v14M3 12h4M17 12h4'), <circle key="m" cx="12" cy="12" r="2.4" />),
  travel: svg(<rect key="c" x="4" y="7.5" width="16" height="12" rx="2.5" />, p('M9 7.5V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5v2'), p('M8 7.5v12M16 7.5v12')),
};

export const ACTIVITY_OPTIONS = ACTIVITIES.map((a) => ({ ...a, icon: ActivityIcon[a.key] }));
export const SPACE_ICON_OPTIONS = SPACE_ICONS.map((a) => ({ ...a, icon: SpaceIcon[a.key] }));
