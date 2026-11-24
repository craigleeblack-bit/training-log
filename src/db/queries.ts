import type { AppDB, Exercise, Measure, Programme, ProgrammeSlot, SetEntry, Workout } from './schema';
import { addDays, daysBetween } from '../lib/dates';

export const slotKey = (s: Pick<ProgrammeSlot, 'week' | 'day'>): string => `${s.week}-${s.day}`;

export function sortedSlots(p: Programme): ProgrammeSlot[] {
  return [...p.slots].sort((a, b) => a.week - b.week || a.day - b.day);
}

/** Calendar date a slot falls on. */
export function slotDate(p: Programme, s: Pick<ProgrammeSlot, 'week' | 'day'>): string {
  return addDays(p.startDate, (s.week - 1) * 7 + s.day);
}

/** The slot scheduled for a calendar date, or undefined outside the programme. */
export function slotForDate(p: Programme, date: string): ProgrammeSlot | undefined {
  const offset = daysBetween(p.startDate, date);
  if (offset < 0 || offset >= p.weeks * 7) return undefined;
  const week = Math.floor(offset / 7) + 1;
  const day = offset % 7;
  return p.slots.find((s) => s.week === week && s.day === day);
}

/** Slot keys that have been completed or deliberately skipped. */
export function closedSlots(p: Programme, workouts: Workout[]): Map<string, Workout> {
  const m = new Map<string, Workout>();
  for (const w of workouts) {
    if (w.programmeId !== p.id || !w.slotKey) continue;
    if (w.status === 'in_progress') continue;
    const prev = m.get(w.slotKey);
    if (!prev || (prev.status === 'skipped' && w.status === 'done')) m.set(w.slotKey, w);
  }
  return m;
}

/** First training slot (in order) that has not been done or skipped. Forgiving of missed days. */
export function nextSlot(p: Programme, workouts: Workout[]): ProgrammeSlot | undefined {
  const closed = closedSlots(p, workouts);
  return sortedSlots(p).find((s) => !s.rest && !closed.has(slotKey(s)));
}

export function programmeProgress(p: Programme, workouts: Workout[]): { done: number; total: number } {
  const closed = closedSlots(p, workouts);
  const training = p.slots.filter((s) => !s.rest);
  const done = training.filter((s) => closed.get(slotKey(s))?.status === 'done').length;
  return { done, total: training.length };
}

export interface LastTime {
  date: string;
  workoutId: string;
  sets: SetEntry[];
}

/**
 * The most recent earlier workout in which an exercise was logged.
 * `before` excludes the workout currently being logged.
 */
export async function lastTime(
  db: AppDB,
  exerciseId: string,
  before?: { workoutId: string },
): Promise<LastTime | undefined> {
  const all = await db.sets.where('exerciseId').equals(exerciseId).toArray();
  const rows = all.filter((s) => s.workoutId !== before?.workoutId && hasValue(s));
  if (!rows.length) return undefined;
  const started = new Map<string, number>();
  for (const id of new Set(rows.map((r) => r.workoutId))) {
    started.set(id, (await db.workouts.get(id))?.startedAt ?? 0);
  }
  rows.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      (started.get(b.workoutId) ?? 0) - (started.get(a.workoutId) ?? 0),
  );
  const latest = rows[0];
  const sets = rows.filter((r) => r.workoutId === latest.workoutId).sort((a, b) => a.setNo - b.setNo);
  return { date: latest.date, workoutId: latest.workoutId, sets };
}

export function hasValue(s: SetEntry): boolean {
  return [s.reps, s.weight, s.seconds, s.metres].some((v) => typeof v === 'number' && !Number.isNaN(v));
}

/** First number in a free-text load such as "2 × 16 kg" → 16 (the per-bell weight), "60 kg" → 60. */
export function loadNumber(load?: string): number | undefined {
  if (!load) return undefined;
  const double = load.match(/\d+\s*[×x]\s*(\d+(?:\.\d+)?)/i);
  if (double) return Number(double[1]);
  const m = load.match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : undefined;
}

/** Lower bound of a rep range such as "8–12" or "8/12" → 8. */
export function repsNumber(reps?: string): number | undefined {
  const m = reps?.match(/\d+/);
  return m ? Number(m[0]) : undefined;
}

export function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const trim = (n: number): string => String(Math.round(n * 100) / 100);

export function formatSet(s: SetEntry, measure: Measure): string {
  switch (measure) {
    case 'weight_reps':
      if (s.weight != null && s.reps != null) return `${trim(s.weight)} kg × ${s.reps}`;
      if (s.reps != null) return `${s.reps} reps`;
      return s.weight != null ? `${trim(s.weight)} kg` : '';
    case 'reps':
      return s.reps != null ? `${s.reps}` : '';
    case 'rounds':
      return s.reps != null ? `${s.reps} rounds${s.weight != null ? ` @ ${trim(s.weight)} kg` : ''}` : '';
    case 'time':
      return s.seconds != null ? formatSeconds(s.seconds) : '';
    case 'distance':
      return [
        s.metres != null ? `${trim(s.metres)} m` : '',
        s.weight != null ? `${trim(s.weight)} kg` : '',
        s.seconds != null ? formatSeconds(s.seconds) : '',
      ]
        .filter(Boolean)
        .join(' · ');
  }
}

/** Compact one-line summary: "60 kg × 8, 8, 7" when the weight is constant. */
export function summariseSets(sets: SetEntry[], measure: Measure): string {
  const rows = sets.filter(hasValue);
  if (!rows.length) return '';
  if (measure === 'weight_reps') {
    const weights = new Set(rows.map((r) => r.weight));
    if (weights.size === 1 && rows[0].weight != null && rows.every((r) => r.reps != null)) {
      return `${trim(rows[0].weight)} kg × ${rows.map((r) => r.reps).join(', ')}`;
    }
  }
  return rows.map((r) => formatSet(r, measure)).join(', ');
}

/** One number per session for the progression chart. */
export function chartValue(sets: SetEntry[], measure: Measure): number | undefined {
  const pick = (f: (s: SetEntry) => number | undefined): number | undefined => {
    const vals = sets.map(f).filter((v): v is number => typeof v === 'number');
    return vals.length ? Math.max(...vals) : undefined;
  };
  const sum = (f: (s: SetEntry) => number | undefined): number | undefined => {
    const vals = sets.map(f).filter((v): v is number => typeof v === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) : undefined;
  };
  switch (measure) {
    case 'weight_reps':
      return pick((s) => s.weight) ?? sum((s) => s.reps);
    case 'reps':
    case 'rounds':
      return sum((s) => s.reps);
    case 'time':
      return sum((s) => s.seconds);
    case 'distance':
      return sum((s) => s.metres);
  }
}

export const CHART_LABEL: Record<Measure, string> = {
  weight_reps: 'Top weight (kg)',
  reps: 'Total reps',
  rounds: 'Total rounds',
  time: 'Total time (s)',
  distance: 'Total distance (m)',
};

export interface ExerciseSession {
  date: string;
  workoutId: string;
  sets: SetEntry[];
}

export async function exerciseHistory(db: AppDB, exercise: Exercise): Promise<ExerciseSession[]> {
  const rows = (await db.sets.where('exerciseId').equals(exercise.id).toArray()).filter(hasValue);
  const byWorkout = new Map<string, ExerciseSession>();
  for (const r of rows) {
    const s = byWorkout.get(r.workoutId) ?? { date: r.date, workoutId: r.workoutId, sets: [] };
    s.sets.push(r);
    byWorkout.set(r.workoutId, s);
  }
  const out = [...byWorkout.values()];
  out.forEach((s) => s.sets.sort((a, b) => a.setNo - b.setNo));
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
