import type { Activity, Track, TrackPoint } from '../db/schema';
import { haversine } from './track';
import { addDays, weekStart } from './dates';

/** The distances a fastest time is kept for. */
export const EFFORTS = [
  { metres: 1000, label: '1 km' },
  { metres: 5000, label: '5 km' },
  { metres: 10000, label: '10 km' },
] as const;

/** Runs and walks: what the Running section counts. */
export const ON_FOOT: readonly Activity[] = ['run', 'walk'];

/**
 * The fastest time, in seconds, over any unbroken stretch of a route that covers `metres`.
 * A pause starts a new segment, and a stretch never spans one. The start of the stretch is placed
 * exactly, part of the way along a leg, so the time is for the distance and no more.
 */
export function bestEffort(segments: TrackPoint[][], metres: number): number | undefined {
  let best: number | undefined;
  for (const seg of segments) {
    if (seg.length < 2) continue;
    const cum = [0];
    for (let k = 1; k < seg.length; k++) cum.push(cum[k - 1] + haversine(seg[k - 1], seg[k]));
    let i = 0;
    for (let j = 1; j < seg.length; j++) {
      if (cum[j] < metres) continue;
      // The latest start that still leaves the whole distance before point j.
      while (i + 1 < j && cum[j] - cum[i + 1] >= metres) i++;
      const over = cum[j] - cum[i] - metres;
      const legMetres = cum[i + 1] - cum[i];
      const legMs = seg[i + 1][0] - seg[i][0];
      const start = seg[i][0] + (legMetres > 0 ? (over / legMetres) * legMs : 0);
      const seconds = (seg[j][0] - start) / 1000;
      if (seconds > 0 && (best == null || seconds < best)) best = seconds;
    }
  }
  return best;
}

export interface Effort {
  label: string;
  metres: number;
  seconds: number;
  date: string;
  workoutId: string;
}

/**
 * The fastest 1 km, 5 km and 10 km among recorded runs. A run with no points (typed in, or an
 * imported total) only counts towards the 5 km, and only when it was within 5% of that distance.
 */
export function personalBests(tracks: Track[]): Effort[] {
  const out: Effort[] = [];
  for (const e of EFFORTS) {
    let top: Effort | undefined;
    for (const t of tracks) {
      if (t.activity !== 'run') continue;
      const hasPoints = t.segments.some((s) => s.length > 1);
      let seconds: number | undefined;
      if (hasPoints) seconds = bestEffort(t.segments, e.metres);
      else if (e.metres === 5000 && t.seconds > 0 && Math.abs(t.metres - 5000) <= 250) seconds = t.seconds;
      if (seconds != null && (!top || seconds < top.seconds)) {
        top = { label: e.label, metres: e.metres, seconds, date: t.date, workoutId: t.workoutId };
      }
    }
    if (top) out.push(top);
  }
  return out;
}

/** Seconds per kilometre over a whole route, or undefined for one too short to say. */
export const trackPace = (t: Pick<Track, 'metres' | 'seconds'>): number | undefined =>
  t.metres >= 200 && t.seconds > 0 ? (t.seconds / t.metres) * 1000 : undefined;

/** Distance on foot per week, Monday to Sunday, oldest first, with empty weeks filled in. */
export function weeklyDistance(tracks: Track[], since?: string): { week: string; metres: number }[] {
  const byWeek = new Map<string, number>();
  for (const t of tracks) {
    if (!ON_FOOT.includes(t.activity) || (since && t.date < since)) continue;
    const w = weekStart(t.date);
    byWeek.set(w, (byWeek.get(w) ?? 0) + t.metres);
  }
  const weeks = [...byWeek.keys()].sort();
  if (!weeks.length) return [];
  const out: { week: string; metres: number }[] = [];
  for (let w = since ? weekStart(since) : weeks[0]; w <= weeks[weeks.length - 1]; w = addDays(w, 7)) {
    out.push({ week: w, metres: byWeek.get(w) ?? 0 });
  }
  return out;
}
