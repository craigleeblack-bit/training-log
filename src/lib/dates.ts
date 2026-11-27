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

/** Monday-first weekday of a date: 0 = Monday … 6 = Sunday. */
export const weekdayIndex = (iso: string): number => (parseIso(iso).getDay() + 6) % 7;

/** The Monday of the week a date is in. */
export const weekStart = (iso: string): string => addDays(iso, -weekdayIndex(iso));

/** Monday to Sunday of the week starting `monday`. */
export const weekDates = (monday: string): string[] => Array.from({ length: 7 }, (_, d) => addDays(monday, d));

/** Whether a date falls in the Monday-to-Sunday week starting `monday`. */
export const inWeek = (iso: string, monday: string): boolean => {
  const d = daysBetween(monday, iso);
  return d >= 0 && d < 7;
};

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

/** "24–30 Nov", or "30 Nov–6 Dec" across a month. */
export function weekRangeLabel(monday: string): string {
  const a = parseIso(monday);
  const b = parseIso(addDays(monday, 6));
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${b.getDate()} ${MONTH[b.getMonth()]}`
    : `${a.getDate()} ${MONTH[a.getMonth()]}–${b.getDate()} ${MONTH[b.getMonth()]}`;
}

const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** How a set of repeating weekdays reads: "Mon, Wed, Fri", "Every day", "Weekdays". */
export function repeatLabel(days: number[] | undefined): string {
  const set = [...new Set(days ?? [])].sort((a, b) => a - b);
  if (!set.length) return '';
  if (set.length === 7) return 'Every day';
  if (set.join() === '0,1,2,3,4') return 'Weekdays';
  if (set.join() === '5,6') return 'Weekends';
  return set.map((d) => SHORT_DAYS[d]).join(', ');
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
