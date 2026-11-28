import type { Exercise, Measure, SetEntry, Track, Workout } from '../db/schema';
import { formatSeconds, formatWeight, hasValue, setVolume } from '../db/queries';
import { addDays, daysBetween, parseIso } from './dates';

export interface StatsInput {
  workouts: Workout[];
  sets: SetEntry[];
  tracks: Track[];
}

export interface Filter {
  /** First date to count, inclusive. Leave out for everything. */
  since?: string;
  spaceId?: string;
}

/** The Monday of the week a date falls in. */
export function weekStart(iso: string): string {
  return addDays(iso, -((parseIso(iso).getDay() + 6) % 7));
}

/** Only finished sessions count, and only the sets logged in them. */
function scope(input: StatsInput, f: Filter) {
  const workouts = input.workouts.filter(
    (w) => w.status === 'done' && (!f.since || w.date >= f.since) && (!f.spaceId || w.spaceId === f.spaceId),
  );
  const ids = new Set(workouts.map((w) => w.id));
  return {
    workouts,
    sets: input.sets.filter((s) => ids.has(s.workoutId) && hasValue(s)),
    tracks: input.tracks.filter((t) => ids.has(t.workoutId) && t.endedAt),
  };
}

export interface Week {
  /** The Monday. */
  start: string;
  sessions: number;
  minutes: number;
  /** Kilograms moved: weight × implements × reps. */
  volume: number;
}

export interface Summary {
  sessions: number;
  minutes: number;
  avgRpe: number | undefined;
  volume: number;
  metres: number;
  /** Every week from the first in range to the current one, empty weeks included. */
  weeks: Week[];
  /** Weeks in a row with at least one session, counting back from this week (or last, if this one is still empty). */
  streak: number;
}

export function summarise(input: StatsInput, f: Filter, today: string): Summary {
  const { workouts, sets, tracks } = scope(input, f);
  const byWeek = new Map<string, Week>();
  const week = (date: string): Week => {
    const start = weekStart(date);
    let w = byWeek.get(start);
    if (!w) byWeek.set(start, (w = { start, sessions: 0, minutes: 0, volume: 0 }));
    return w;
  };
  const dateOf = new Map(workouts.map((w) => [w.id, w.date]));
  for (const w of workouts) {
    const k = week(w.date);
    k.sessions++;
    k.minutes += w.minutes ?? 0;
  }
  for (const s of sets) week(dateOf.get(s.workoutId) ?? s.date).volume += setVolume(s);

  const first = f.since ? weekStart(f.since) : [...byWeek.keys()].sort()[0];
  const weeks: Week[] = [];
  if (first) {
    for (let start = first; start <= weekStart(today); start = addDays(start, 7)) {
      weeks.push(byWeek.get(start) ?? { start, sessions: 0, minutes: 0, volume: 0 });
    }
  }

  // The streak looks at all time for this space, not just the range on screen.
  const trained = new Set(scope(input, { spaceId: f.spaceId }).workouts.map((w) => weekStart(w.date)));
  let at = weekStart(today);
  if (!trained.has(at)) at = addDays(at, -7);
  let streak = 0;
  while (trained.has(at)) {
    streak++;
    at = addDays(at, -7);
  }

  const rpes = workouts.map((w) => w.rpe).filter((r): r is number => r != null);
  return {
    sessions: workouts.length,
    minutes: workouts.reduce((a, w) => a + (w.minutes ?? 0), 0),
    avgRpe: rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : undefined,
    volume: sets.reduce((a, s) => a + setVolume(s), 0),
    metres: tracks.reduce((a, t) => a + t.metres, 0),
    weeks,
    streak,
  };
}

/** Estimated one-rep maximum (Epley). Only offered for sets of ten or fewer, where it is a fair guess. */
export function e1rm(s: Pick<SetEntry, 'weight' | 'reps' | 'count'>): number | undefined {
  if (s.weight == null || s.reps == null || s.reps < 1 || s.reps > 10) return undefined;
  const load = s.weight * (s.count ?? 1);
  return s.reps === 1 ? load : load * (1 + s.reps / 30);
}

export const REP_RANGES = [
  { label: '1–3 reps', min: 1, max: 3 },
  { label: '4–6 reps', min: 4, max: 6 },
  { label: '7–10 reps', min: 7, max: 10 },
  { label: '11+ reps', min: 11, max: Infinity },
] as const;

export interface Record_ {
  label: string;
  value: string;
  date: string;
  workoutId: string;
}

const best = <T,>(list: T[], score: (x: T) => number | undefined): T | undefined => {
  let top: T | undefined;
  let high = -Infinity;
  for (const x of list) {
    const v = score(x);
    if (v != null && v > high) {
      high = v;
      top = x;
    }
  }
  return top;
};

const load = (s: SetEntry): number | undefined => (s.weight != null ? s.weight * (s.count ?? 1) : undefined);

/** The bests for one exercise, from sets in finished sessions (pass those in). */
export function records(sets: SetEntry[], measure: Measure): Record_[] {
  const out: Record_[] = [];
  const add = (label: string, s: SetEntry | undefined, value: (s: SetEntry) => string) => {
    if (s) out.push({ label, value: value(s), date: s.date, workoutId: s.workoutId });
  };
  if (measure === 'weight_reps') {
    for (const r of REP_RANGES) {
      add(
        `Heaviest for ${r.label}`,
        best(
          sets.filter((s) => s.reps != null && s.reps >= r.min && s.reps <= r.max),
          load,
        ),
        (s) => `${formatWeight(s.weight!, s.count)} × ${s.reps}`,
      );
    }
    add('Best estimated 1RM', best(sets, e1rm), (s) => `${Math.round(e1rm(s)!)} kg, from ${formatWeight(s.weight!, s.count)} × ${s.reps}`);
  }
  if (measure === 'reps' || measure === 'rounds') {
    add(measure === 'reps' ? 'Most reps in a set' : 'Most rounds in a set', best(sets, (s) => s.reps), (s) => String(s.reps));
  }
  if (measure === 'time') add('Longest hold', best(sets, (s) => s.seconds), (s) => formatSeconds(s.seconds!));
  if (measure === 'distance') add('Farthest', best(sets, (s) => s.metres), (s) => `${s.metres} m`);
  return out;
}

export type Metric = 'top' | 'volume' | 'bodyload' | 'e1rm' | 'reps' | 'time' | 'hold' | 'distance' | 'pace';

export const METRIC_LABEL: Record<Metric, string> = {
  top: 'Top weight',
  volume: 'Workload',
  bodyload: 'Workload (approx.)',
  e1rm: 'Est. 1RM',
  reps: 'Reps',
  time: 'Total time',
  hold: 'Longest hold',
  distance: 'Distance',
  pace: 'Pace',
};

export const METRIC_UNIT: Record<Metric, string> = {
  top: 'kg',
  volume: 'kg',
  bodyload: 'kg',
  e1rm: 'kg',
  reps: 'reps',
  time: 's',
  hold: 's',
  distance: 'm',
  pace: 's/km',
};

/** The Setting row holding your body weight, in kg. */
export const BODY_WEIGHT_KEY = 'body-weight';

/** What a metric needs beyond the sets themselves. */
export interface MetricContext {
  /** The body weight in Settings, in kg: makes a workload for bodyweight exercises. */
  bodyWeight?: number;
}

/**
 * The ways an exercise's progress can be charted, most telling first. A bodyweight exercise only
 * has a workload once a body weight is set; a distance only has a pace once times are logged.
 */
export function metricsFor(measure: Measure, ctx: MetricContext & { timed?: boolean } = {}): Metric[] {
  switch (measure) {
    case 'weight_reps':
      return ['top', 'reps', 'volume', 'e1rm'];
    case 'reps':
      return ctx.bodyWeight ? ['reps', 'bodyload'] : ['reps'];
    case 'rounds':
      return ['reps'];
    case 'time':
      return ['time', 'hold'];
    case 'distance':
      return ctx.timed ? ['distance', 'pace'] : ['distance'];
  }
}

/**
 * A session's workload: the weight moved, summed over every set (weight × reps). For a bodyweight
 * exercise it counts the body weight plus anything added, so it needs the body weight to mean anything.
 */
export function workload(sets: SetEntry[], measure: Measure, ctx: MetricContext = {}): number | undefined {
  if (measure === 'weight_reps') return sum(sets.map((s) => setVolume(s) || undefined));
  if (measure === 'reps' && ctx.bodyWeight) {
    return sum(sets.map((s) => (s.reps != null ? (ctx.bodyWeight! + (load(s) ?? 0)) * s.reps : undefined)));
  }
  return undefined;
}

const sum = (vals: (number | undefined)[]): number | undefined => {
  const nums = vals.filter((v): v is number => v != null);
  return nums.length ? nums.reduce((a, b) => a + b, 0) : undefined;
};
const max = (vals: (number | undefined)[]): number | undefined => {
  const nums = vals.filter((v): v is number => v != null);
  return nums.length ? Math.max(...nums) : undefined;
};

/** One number for a session's sets of an exercise, by the chosen measure of progress. */
export function metricValue(sets: SetEntry[], metric: Metric, ctx: MetricContext = {}): number | undefined {
  switch (metric) {
    case 'top':
      return max(sets.map(load));
    case 'volume':
      return workload(sets, 'weight_reps');
    case 'bodyload':
      return workload(sets, 'reps', ctx);
    case 'hold':
      return max(sets.map((s) => s.seconds));
    case 'pace': {
      const timed = sets.filter((s) => s.seconds != null && s.metres);
      const metres = sum(timed.map((s) => s.metres));
      const seconds = sum(timed.map((s) => s.seconds));
      return metres && seconds ? (seconds / metres) * 1000 : undefined;
    }
    case 'e1rm':
      return max(sets.map(e1rm));
    case 'reps':
      return sum(sets.map((s) => s.reps));
    case 'time':
      return sum(sets.map((s) => s.seconds));
    case 'distance':
      return sum(sets.map((s) => s.metres));
  }
}

/** How uneven the two sides were, as a share: 0.1 means one side did 10% more. Undefined without both sides. */
export function sideGap(sets: SetEntry[]): { stronger: 'L' | 'R'; share: number } | undefined {
  const total = (side: 'L' | 'R') => sets.filter((s) => s.side === side).reduce((a, s) => a + (setVolume(s) || s.reps || s.seconds || 0), 0);
  const l = total('L');
  const r = total('R');
  if (!l || !r || l === r) return undefined;
  return { stronger: l > r ? 'L' : 'R', share: Math.abs(l - r) / Math.min(l, r) };
}

/**
 * What this session beat: for each exercise in it, a line when it set a new heaviest weight,
 * best estimated 1RM, or most reps, time or distance in a set, against every earlier finished session.
 */
export function newRecords(input: StatsInput, workoutId: string, exercises: Exercise[]): string[] {
  const here = input.sets.filter((s) => s.workoutId === workoutId && hasValue(s));
  const done = new Set(input.workouts.filter((w) => w.status === 'done' && w.id !== workoutId).map((w) => w.id));
  const out: string[] = [];
  for (const ex of exercises) {
    const mine = here.filter((s) => s.exerciseId === ex.id);
    const before = input.sets.filter((s) => s.exerciseId === ex.id && done.has(s.workoutId) && hasValue(s));
    if (!mine.length || !before.length) continue; // a first go is a start, not a record
    const beat = (score: (s: SetEntry) => number | undefined): SetEntry | undefined => {
      const top = best(mine, score);
      const old = max(before.map(score));
      return top && old != null && score(top)! > old ? top : undefined;
    };
    if (ex.measure === 'weight_reps') {
      const heavy = beat(load);
      const strong = beat(e1rm);
      if (heavy) out.push(`${ex.name}: heaviest yet, ${formatWeight(heavy.weight!, heavy.count)} × ${heavy.reps ?? '?'}`);
      else if (strong) out.push(`${ex.name}: best estimated 1RM, ${Math.round(e1rm(strong)!)} kg`);
    } else if (ex.measure === 'time') {
      const s = beat((x) => x.seconds);
      if (s) out.push(`${ex.name}: longest yet, ${formatSeconds(s.seconds!)}`);
    } else if (ex.measure === 'distance') {
      const s = beat((x) => x.metres);
      if (s) out.push(`${ex.name}: farthest yet, ${s.metres} m`);
    } else {
      const s = beat((x) => x.reps);
      if (s) out.push(`${ex.name}: most in a set yet, ${s.reps}`);
    }
  }
  return out;
}

/** "4,200 kg", or tonnes once the number gets long. */
export function formatVolume(kg: number): string {
  return kg >= 10000 ? `${(kg / 1000).toFixed(1)} t` : `${Math.round(kg).toLocaleString('en-GB')} kg`;
}

/** "12 h 30 min", or just minutes under an hour. */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

/** The first date of a look-back of so many weeks, ending this week. */
export const weeksAgo = (today: string, weeks: number): string => addDays(weekStart(today), -7 * (weeks - 1));

export const daysSince = (iso: string, today: string): number => daysBetween(iso, today);
