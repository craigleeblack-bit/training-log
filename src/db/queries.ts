import type { AppDB, ComplexPart, Exercise, Measure, Programme, ProgrammeSlot, Routine, SetEntry, Workout } from './schema';
import { addDays, daysBetween, parseIso } from '../lib/dates';

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

/** Tied to calendar dates. Programmes from before the choice existed are. */
export const isDated = (p: Programme): boolean => p.dated !== false;

/** Monday-first weekday of a date: 0 = Monday … 6 = Sunday. */
export const weekdayIndex = (iso: string): number => (parseIso(iso).getDay() + 6) % 7;

/**
 * The week the programme is up to: the first with a session still open. Missed days never hold
 * it back by the calendar; it moves on once every session in the week is done or skipped.
 * Once everything is closed it stays on the last week.
 */
export function currentWeek(p: Programme, closed: Map<string, Workout>): number {
  const open = sortedSlots(p).find((s) => !s.rest && s.week <= p.weeks && !closed.has(slotKey(s)));
  return open ? open.week : Math.max(1, p.weeks);
}

export type CellState = 'open' | 'done' | 'skipped' | 'resume';

/** One session on the week grid. */
export interface WeekCell {
  programme: Programme;
  slot: ProgrammeSlot;
  routine?: Routine;
  state: CellState;
  /** The session logged for it: finished, skipped or still going. */
  workout?: Workout;
}

export interface WeekShown {
  programme: Programme;
  week: number;
  /** Every session in the programme is done or skipped. */
  complete: boolean;
}

export interface WeekGrid {
  /** Monday to Sunday, each with the sessions that fall on it (rest days included). */
  days: WeekCell[][];
  shown: WeekShown[];
}

/**
 * The active programmes' current weeks laid over Monday to Sunday. `offset` looks back or ahead
 * from each programme's current week, staying inside the programme.
 */
export function weekGrid(programmes: Programme[], workouts: Workout[], routines: Routine[], offset = 0): WeekGrid {
  const days: WeekCell[][] = Array.from({ length: 7 }, () => []);
  const shown: WeekShown[] = [];
  const routineById = new Map(routines.map((r) => [r.id, r]));
  for (const p of programmes) {
    if (!p.active) continue;
    const closed = closedSlots(p, workouts);
    const now = currentWeek(p, closed);
    const week = Math.min(Math.max(1, now + offset), Math.max(1, p.weeks));
    shown.push({ programme: p, week, complete: !nextSlot(p, workouts) });
    for (const slot of p.slots) {
      if (slot.week !== week) continue;
      const key = slotKey(slot);
      const done = closed.get(key);
      const going = workouts.find((w) => w.programmeId === p.id && w.slotKey === key && w.status === 'in_progress');
      const state: CellState = done ? (done.status === 'done' ? 'done' : 'skipped') : going ? 'resume' : 'open';
      const column = isDated(p) ? weekdayIndex(slotDate(p, slot)) : slot.day;
      days[column].push({ programme: p, slot, routine: slot.routineId ? routineById.get(slot.routineId) : undefined, state, workout: done ?? going });
    }
  }
  return { days, shown };
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
  const logged = all.filter((s) => s.workoutId !== before?.workoutId && hasValue(s));
  if (!logged.length) return undefined;
  // Only finished sessions count: a skipped or half-done one is not a performance to beat.
  const started = new Map<string, number>();
  for (const id of new Set(logged.map((r) => r.workoutId))) {
    const w = await db.workouts.get(id);
    if (w?.status === 'done') started.set(id, w.startedAt);
  }
  const rows = logged.filter((r) => started.has(r.workoutId));
  if (!rows.length) return undefined;
  rows.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      (started.get(b.workoutId) ?? 0) - (started.get(a.workoutId) ?? 0),
  );
  const latest = rows[0];
  const sets = rows.filter((r) => r.workoutId === latest.workoutId).sort((a, b) => a.setNo - b.setNo);
  return { date: latest.date, workoutId: latest.workoutId, sets };
}

/** What was done in a session, one line per exercise. */
export interface SessionRecap {
  workout: Workout;
  lines: { exerciseId: string; name: string; summary: string }[];
}

/**
 * The last finished session of the same kind: the same routine, or else the same programme
 * session by title. `excludeWorkoutId` leaves out the one being logged.
 */
export async function lastRoutineSession(
  db: AppDB,
  match: { routineId?: string; programmeId?: string; title?: string },
  opts: { excludeWorkoutId?: string } = {},
): Promise<SessionRecap | undefined> {
  const candidates = match.routineId
    ? await db.workouts.where('routineId').equals(match.routineId).toArray()
    : match.programmeId
      ? (await db.workouts.where('programmeId').equals(match.programmeId).toArray()).filter((w) => w.title === match.title)
      : [];
  const workout = candidates
    .filter((w) => w.status === 'done' && w.id !== opts.excludeWorkoutId)
    .sort((a, b) => b.date.localeCompare(a.date) || b.startedAt - a.startedAt)[0];
  if (!workout) return undefined;
  const sets = (await db.sets.where('workoutId').equals(workout.id).toArray()).filter(hasValue);
  // In the order the session had them, then anything logged that was not in its plan.
  const order = [...new Set([...workout.items.map((i) => i.exerciseId), ...sets.map((s) => s.exerciseId)])];
  const exercises = new Map(
    (await db.exercises.bulkGet(order)).filter((e): e is Exercise => !!e).map((e) => [e.id, e]),
  );
  const lines = order.flatMap((exerciseId) => {
    const e = exercises.get(exerciseId);
    const mine = sets.filter((s) => s.exerciseId === exerciseId).sort((a, b) => a.setNo - b.setNo || (a.side ?? '').localeCompare(b.side ?? ''));
    if (!e || !mine.length) return [];
    return [{ exerciseId, name: e.name, summary: summariseSets(mine, e.measure) }];
  });
  return { workout, lines };
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

/** How many implements a load is per: "2 × 16 kg" → 2. Undefined for a single weight. */
export function loadCount(load?: string): number | undefined {
  const m = load?.match(/(\d+)\s*[×x]\s*\d/i);
  const n = m ? Number(m[1]) : undefined;
  return n && n > 1 && n <= 4 ? n : undefined;
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

/** "16 kg", or "2 × 16 kg" for a pair. */
export const formatWeight = (weight: number, count?: number): string =>
  `${count && count > 1 ? `${count} × ` : ''}${trim(weight)} kg`;

/** Load moved by one set: weight × implements × reps. Zero when it is not a weighted set. */
export const setVolume = (s: Pick<SetEntry, 'weight' | 'reps' | 'count'>): number =>
  (s.weight ?? 0) * (s.count ?? 1) * (s.reps ?? 0);

export function formatSet(s: SetEntry, measure: Measure): string {
  switch (measure) {
    case 'weight_reps':
      if (s.weight != null && s.reps != null) return `${formatWeight(s.weight, s.count)} × ${s.reps}`;
      if (s.reps != null) return `${s.reps} reps`;
      return s.weight != null ? formatWeight(s.weight, s.count) : '';
    case 'reps':
      return s.reps != null ? `${s.reps}` : '';
    case 'rounds':
      return s.reps != null ? `${s.reps} rounds${s.weight != null ? ` @ ${formatWeight(s.weight, s.count)}` : ''}` : '';
    case 'time':
      return s.seconds != null ? formatSeconds(s.seconds) : '';
    case 'distance':
      return [
        s.metres != null ? `${trim(s.metres)} m` : '',
        s.weight != null ? formatWeight(s.weight, s.count) : '',
        s.seconds != null ? formatSeconds(s.seconds) : '',
      ]
        .filter(Boolean)
        .join(' · ');
  }
}

/** "2 double clean, 1 double press, 3 front squat": what one round of a complex is. */
export const describeParts = (parts: ComplexPart[]): string => parts.map((p) => `${p.reps} ${p.name.toLowerCase()}`).join(', ');

/** What a number of rounds of a complex adds up to: "14 double clean, 7 double press, 21 front squat". */
export const complexTotals = (parts: ComplexPart[], rounds: number): string =>
  describeParts(parts.map((p) => ({ ...p, reps: p.reps * rounds })));

/** Total rounds logged for an exercise in a session. */
export const totalRounds = (sets: SetEntry[]): number => sets.reduce((a, s) => a + (s.reps ?? 0), 0);

/** Compact one-line summary: "60 kg × 8, 8, 7" when the weight is constant. */
export function summariseSets(sets: SetEntry[], measure: Measure): string {
  const rows = sets.filter(hasValue);
  if (!rows.length) return '';
  // Sides logged apart read as left/right pairs: "16 kg × 8/7, 8/8 (L/R)".
  if (rows.some((r) => r.side)) {
    const value = (r?: SetEntry) => (r ? String(r.reps ?? (r.seconds != null ? formatSeconds(r.seconds) : (r.metres ?? r.weight ?? ''))) : '–');
    const nos = [...new Set(rows.map((r) => r.setNo))].sort((a, b) => a - b);
    const pairs = nos.map((n) => `${value(rows.find((r) => r.setNo === n && r.side === 'L'))}/${value(rows.find((r) => r.setNo === n && r.side === 'R'))}`);
    const w = rows[0].weight;
    const sameWeight = w != null && rows.every((r) => r.weight === w && r.reps != null);
    return `${sameWeight ? `${formatWeight(w, rows[0].count)} × ` : ''}${pairs.join(', ')} (L/R)`;
  }
  if (measure === 'weight_reps') {
    const weights = new Set(rows.map((r) => `${r.count ?? 1}:${r.weight}`));
    if (weights.size === 1 && rows[0].weight != null && rows.every((r) => r.reps != null)) {
      return `${formatWeight(rows[0].weight, rows[0].count)} × ${rows.map((r) => r.reps).join(', ')}`;
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

/** Every finished session an exercise was logged in, newest first. */
export async function exerciseHistory(db: AppDB, exercise: Exercise): Promise<ExerciseSession[]> {
  const logged = (await db.sets.where('exerciseId').equals(exercise.id).toArray()).filter(hasValue);
  const ids = [...new Set(logged.map((r) => r.workoutId))];
  const done = new Set((await db.workouts.bulkGet(ids)).filter((w) => w?.status === 'done').map((w) => w!.id));
  const rows = logged.filter((r) => done.has(r.workoutId));
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
