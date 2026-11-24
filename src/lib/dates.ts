/** Local-time ISO date (YYYY-MM-DD). Never use toISOString() for this: it is UTC. */
export function isoDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Whole days from a to b (b - a), immune to DST shifts. */
export function daysBetween(aIso: string, bIso: string): number {
  const a = parseIso(aIso);
  const b = parseIso(bIso);
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / 86400000);
}

export function addDays(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "Tuesday 24 November". */
export function longDate(iso: string): string {
  const d = parseIso(iso);
  return `${DAY_LONG[d.getDay()]} ${d.getDate()} ${MONTH_LONG[d.getMonth()]}`;
}

/** How to name a day that is still to come: "tomorrow", "Thursday", or "Tue 8 Dec" beyond a week. */
export function upcomingDay(iso: string, today: string = isoDate()): string {
  const diff = daysBetween(today, iso);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff < 7) return DAY_LONG[parseIso(iso).getDay()];
  return niceDate(iso, today);
}

export function dayName(iso: string): string {
  return DAY[parseIso(iso).getDay()];
}

/** "Tue 24 Nov", with the year added when it is not the current one. */
export function niceDate(iso: string, today: string = isoDate()): string {
  const d = parseIso(iso);
  const base = `${DAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
  return iso.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${d.getFullYear()}`;
}

export function relativeDay(iso: string, today: string = isoDate()): string {
  const diff = daysBetween(iso, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return `${diff} days ago`;
  return niceDate(iso, today);
}
