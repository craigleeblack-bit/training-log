import { db, type Exercise, type Measure, type RoutineItem, type SetEntry, type Side, type Workout } from '../db/schema';
import { formatSeconds, hasValue, loadCount } from '../db/queries';

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

export const entryId = (workoutId: string, itemId: string, setNo: number, side?: Side): string =>
  `${workoutId}:${itemId}:${setNo}${side ? `:${side}` : ''}`;

/** How many sets an exercise shows: the plan, or more if more were logged. */
export const setCount = (item: RoutineItem, entries: SetEntry[]): number =>
  Math.max(item.sets ?? 1, entries.filter(hasValue).reduce((m, e) => Math.max(m, e.setNo), 0));

export const SIDES: readonly Side[] = ['L', 'R'];

/** The sides a set of this exercise is logged for: left and right, or just the one entry. */
export const sidesOf = (item: Pick<RoutineItem, 'eachSide'>): (Side | undefined)[] => (item.eachSide ? ['L', 'R'] : [undefined]);

/** How many sets are fully logged: both sides, where sides are logged apart. */
export function setsDone(item: RoutineItem, entries: SetEntry[]): number {
  const logged = entries.filter(hasValue);
  const sides = sidesOf(item);
  let n = 0;
  for (let setNo = 1; setNo <= setCount(item, entries); setNo++) {
    if (sides.every((side) => logged.some((e) => e.setNo === setNo && e.side === side))) n++;
  }
  return n;
}

/**
 * Keep supersets honest after exercises are moved, added or removed: a group is a run of
 * neighbouring exercises, and an exercise left on its own is no longer in one.
 */
export function normaliseGroups(items: RoutineItem[]): RoutineItem[] {
  const out = items.map((i) => ({ ...i }));
  let run = 0;
  for (let k = 0; k < out.length; k++) {
    const joinsPrev = k > 0 && !!items[k].group && items[k].group === items[k - 1].group;
    if (!joinsPrev) run = k;
    const joinsNext = k + 1 < out.length && !!items[k].group && items[k].group === items[k + 1].group;
    // Name each run after where it starts, so two runs that once shared an id come apart.
    if (joinsPrev || joinsNext) out[k].group = `g${run}`;
    else delete out[k].group;
  }
  return out;
}

/** Make an exercise a superset with the one above it, or split it off again. */
export function linkAbove(items: RoutineItem[], index: number, on: boolean): RoutineItem[] {
  if (index <= 0 || index >= items.length) return items;
  const out = items.map((i) => ({ ...i }));
  if (on) {
    const g = out[index - 1].group ?? `new${index}`;
    out[index - 1].group = g;
    // Bring along anything already grouped with this exercise below it.
    const old = out[index].group;
    for (let k = index; k < out.length && (k === index || (!!old && out[k].group === old)); k++) out[k].group = g;
  } else {
    const old = out[index].group;
    for (let k = index; k < out.length && out[k].group === old; k++) out[k].group = `split${index}`;
  }
  return normaliseGroups(out);
}

/** "1, 2, 3, 4, 5" → [1, 2, 3, 4, 5]. Anything that is not a list of numbers gives undefined. */
export function parseLadder(text: string): number[] | undefined {
  const nums = text
    .split(/[\s,/\-–]+/)
    .filter(Boolean)
    .map(Number);
  return nums.length > 1 && nums.every((n) => Number.isFinite(n) && n > 0) ? nums : undefined;
}

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
  side?: Side,
): Promise<void> {
  const id = entryId(workout.id, item.id, setNo, side);
  await db.transaction('rw', db.sets, async () => {
    const current = await db.sets.get(id);
    const next: SetEntry = {
      id,
      workoutId: workout.id,
      exerciseId: exercise.id,
      itemId: item.id,
      date: workout.date,
      setNo,
      ...(side ? { side } : {}),
      ...current,
      ...changes,
    };
    // A pair of bells is twice the load: keep the count beside the per-bell weight.
    const count = loadCount(item.load);
    if (next.weight != null && count) next.count = count;
    else delete next.count;
    if (hasValue(next)) await db.sets.put(next);
    else await db.sets.delete(id);
  });
}

const itemEntries = (workoutId: string, itemId: string) =>
  db.sets.where('workoutId').equals(workoutId).filter((s) => s.itemId === itemId);

const patchItem = async (workoutId: string, itemId: string, change: (i: RoutineItem) => RoutineItem): Promise<void> => {
  const w = await db.workouts.get(workoutId);
  if (w) await db.workouts.update(workoutId, { items: w.items.map((i) => (i.id === itemId ? change(i) : i)) });
};

/** Give an exercise one more set in this session. */
export async function addSet(workoutId: string, itemId: string): Promise<void> {
  await db.transaction('rw', db.workouts, db.sets, async () => {
    const entries = await itemEntries(workoutId, itemId).toArray();
    await patchItem(workoutId, itemId, (i) => ({ ...i, sets: setCount(i, entries) + 1 }));
  });
}

/**
 * Take a set out of this session: whatever was logged for it goes, and later sets move up one.
 * An exercise always keeps at least one set.
 */
export async function removeSet(workoutId: string, itemId: string, setNo: number): Promise<void> {
  await db.transaction('rw', db.workouts, db.sets, async () => {
    const entries = await itemEntries(workoutId, itemId).toArray();
    const w = await db.workouts.get(workoutId);
    const item = w?.items.find((i) => i.id === itemId);
    if (!item) return;
    const rows = setCount(item, entries);
    await db.sets.bulkDelete(entries.filter((e) => e.setNo >= setNo).map((e) => e.id));
    await db.sets.bulkPut(
      entries
        .filter((e) => e.setNo > setNo)
        .map((e) => ({ ...e, setNo: e.setNo - 1, id: entryId(workoutId, itemId, e.setNo - 1, e.side) })),
    );
    await patchItem(workoutId, itemId, (i) => ({
      ...i,
      sets: Math.max(1, rows - 1),
      repsBySet: i.repsBySet?.filter((_, n) => n !== setNo - 1),
    }));
  });
}

/** Take an exercise out of a session, along with anything logged for it. */
export async function removeItem(workoutId: string, itemId: string): Promise<void> {
  await db.transaction('rw', db.workouts, db.sets, async () => {
    await itemEntries(workoutId, itemId).delete();
    const w = await db.workouts.get(workoutId);
    if (!w) return;
    await db.workouts.update(workoutId, {
      items: normaliseGroups(w.items.filter((i) => i.id !== itemId)),
      checked: (w.checked ?? []).filter((id) => id !== itemId),
    });
  });
}

/** Do a different exercise in this slot. Sets logged for the old one do not carry over. */
export async function swapItem(workoutId: string, itemId: string, exerciseId: string): Promise<void> {
  await db.transaction('rw', db.workouts, db.sets, async () => {
    await itemEntries(workoutId, itemId).delete();
    await patchItem(workoutId, itemId, (i) => ({ ...i, exerciseId, note: undefined }));
  });
}

/** Move an exercise earlier (-1) or later (+1) in this session. */
export async function moveItem(workoutId: string, itemId: string, by: 1 | -1): Promise<void> {
  await db.transaction('rw', db.workouts, async () => {
    const w = await db.workouts.get(workoutId);
    if (!w) return;
    const items = [...w.items];
    const from = items.findIndex((i) => i.id === itemId);
    const to = from + by;
    if (from < 0 || to < 0 || to >= items.length) return;
    [items[from], items[to]] = [items[to], items[from]];
    await db.workouts.update(workoutId, { items: normaliseGroups(items) });
  });
}
