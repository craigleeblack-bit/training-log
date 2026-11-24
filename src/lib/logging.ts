import { db, type Exercise, type Measure, type RoutineItem, type SetEntry, type Workout } from '../db/schema';
import { formatSeconds, hasValue } from '../db/queries';

export type NumKey = 'weight' | 'reps' | 'seconds' | 'metres';
export type SetValues = Partial<Record<NumKey, number | undefined>>;

export interface Column {
  key: NumKey;
  unit: string;
  label: string;
  /** How much one tap of − or + changes the value. */
  step: number;
}

const WEIGHT: Column = { key: 'weight', unit: 'kg', label: 'Weight', step: 1 };

export const COLUMNS: Record<Measure, Column[]> = {
  weight_reps: [WEIGHT, { key: 'reps', unit: 'reps', label: 'Reps', step: 1 }],
  reps: [{ key: 'reps', unit: 'reps', label: 'Reps', step: 1 }],
  rounds: [{ key: 'reps', unit: 'rds', label: 'Rounds', step: 1 }, WEIGHT],
  time: [{ key: 'seconds', unit: 'sec', label: 'Time', step: 5 }],
  distance: [{ key: 'metres', unit: 'm', label: 'Distance', step: 5 }, WEIGHT],
};

export const BACK_OPTIONS = ['Fine', 'Aware of it', 'Sore', 'Flare-up'] as const;
export const RPE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/** Name of the timer a session starts between sets, so the session can show it in place. */
export const REST_TIMER = 'Rest';

export const entryId = (workoutId: string, itemId: string, setNo: number): string => `${workoutId}:${itemId}:${setNo}`;

export const fmtDuration = (n: number): string => (n >= 60 ? formatSeconds(n) : String(n));

const trim = (n: number): string => String(Math.round(n * 100) / 100);

/** Shortest readable form of one set, for the small set tiles: "16 × 8", "45 s", "30 m". */
export function compactSet(s: SetValues, measure: Measure): string {
  switch (measure) {
    case 'weight_reps':
      if (s.weight != null && s.reps != null) return `${trim(s.weight)} × ${s.reps}`;
      if (s.reps != null) return String(s.reps);
      return s.weight != null ? `${trim(s.weight)} kg` : '';
    case 'reps':
      return s.reps != null ? String(s.reps) : '';
    case 'rounds':
      return s.reps != null ? `${s.reps} rds` : '';
    case 'time':
      return s.seconds != null ? (s.seconds >= 60 ? formatSeconds(s.seconds) : `${s.seconds} s`) : '';
    case 'distance':
      return s.metres != null ? `${trim(s.metres)} m` : '';
  }
}

/**
 * Write one set. Merges against the stored row, not the rendered one: two fields committed in
 * quick succession would otherwise each start from a stale copy and the second would drop the first.
 */
export async function saveSet(
  workout: Workout,
  item: RoutineItem,
  exercise: Exercise,
  setNo: number,
  changes: SetValues,
): Promise<void> {
  const id = entryId(workout.id, item.id, setNo);
  await db.transaction('rw', db.sets, async () => {
    const current = await db.sets.get(id);
    const next: SetEntry = {
      id,
      workoutId: workout.id,
      exerciseId: exercise.id,
      itemId: item.id,
      date: workout.date,
      setNo,
      ...current,
      ...changes,
    };
    if (hasValue(next)) await db.sets.put(next);
    else await db.sets.delete(id);
  });
}
