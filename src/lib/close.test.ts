import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, TABLES, type Routine, type SetEntry, type Workout } from '../db/schema';
import { closeStaleWorkouts } from './close';
import { changePlan, writeBack } from './logging';
import { parseIso } from './dates';

const TODAY = '2026-11-28';
const at = (iso: string, h: number, m = 0) => parseIso(iso).getTime() + (h * 60 + m) * 60000;

const workout = (id: string, date: string, over: Partial<Workout> = {}): Workout => ({
  id,
  date,
  startedAt: at(date, 18),
  spaceId: 's1',
  title: id,
  logStyle: 'sets',
  status: 'in_progress',
  items: [{ id: 'i1', exerciseId: 'press', sets: 3 }],
  ...over,
});

const set = (workoutId: string, date: string, setNo: number, when?: number): SetEntry => ({
  id: `${workoutId}-${setNo}`,
  workoutId,
  exerciseId: 'press',
  itemId: 'i1',
  date,
  setNo,
  weight: 16,
  reps: 8,
  ...(when ? { at: when } : {}),
});

beforeEach(async () => {
  for (const t of TABLES) await db.table(t).clear();
});

describe('closing sessions left open', () => {
  it('closes yesterday’s session with sets, estimating its time from the sets', async () => {
    await db.workouts.add(workout('y', '2026-11-27'));
    await db.sets.bulkAdd([set('y', '2026-11-27', 1, at('2026-11-27', 18, 5)), set('y', '2026-11-27', 2, at('2026-11-27', 18, 40))]);
    const r = await closeStaleWorkouts(db, TODAY);
    expect(r).toEqual({ closed: ['y'], removed: [] });
    const w = await db.workouts.get('y');
    expect(w).toMatchObject({ status: 'done', autoClosed: true, minutes: 40 });
  });

  it('keeps a time already entered, and leaves the time out when the sets cannot say', async () => {
    await db.workouts.bulkAdd([workout('kept', '2026-11-26', { minutes: 25 }), workout('old', '2026-11-26')]);
    await db.sets.bulkAdd([set('kept', '2026-11-26', 1, at('2026-11-26', 18, 50)), set('old', '2026-11-26', 1)]);
    await closeStaleWorkouts(db, TODAY);
    expect((await db.workouts.get('kept'))?.minutes).toBe(25);
    expect((await db.workouts.get('old'))?.minutes).toBeUndefined();
  });

  it('removes an empty one, so it ticks nothing', async () => {
    await db.workouts.add(workout('empty', '2026-11-27'));
    const r = await closeStaleWorkouts(db, TODAY);
    expect(r.removed).toEqual(['empty']);
    expect(await db.workouts.get('empty')).toBeUndefined();
  });

  it('closes a tick-off session with exercises ticked, though it has no sets', async () => {
    await db.workouts.add(workout('ticked', '2026-11-27', { logStyle: 'session', checked: ['i1'] }));
    await closeStaleWorkouts(db, TODAY);
    expect((await db.workouts.get('ticked'))?.status).toBe('done');
  });

  it('leaves today’s alone, and a past day’s session begun today', async () => {
    await db.workouts.bulkAdd([
      workout('today', TODAY),
      // Logging last Tuesday's session, started this morning.
      workout('retro', '2026-11-24', { startedAt: at(TODAY, 9) }),
    ]);
    const r = await closeStaleWorkouts(db, TODAY);
    expect(r).toEqual({ closed: [], removed: [] });
    expect((await db.workouts.toArray()).map((w) => w.status)).toEqual(['in_progress', 'in_progress']);
  });

  it('can run again, and on another device, without changing anything more', async () => {
    await db.workouts.bulkAdd([workout('y', '2026-11-27'), workout('empty', '2026-11-27'), workout('done', '2026-11-20', { status: 'done' })]);
    await db.sets.add(set('y', '2026-11-27', 1, at('2026-11-27', 18, 30)));
    await closeStaleWorkouts(db, TODAY);
    const once = await db.workouts.toArray();
    const again = await closeStaleWorkouts(db, TODAY);
    expect(again).toEqual({ closed: [], removed: [] });
    expect(await db.workouts.toArray()).toEqual(once);
  });
});

describe('a session’s changes carry into the routine', () => {
  const routine: Routine = {
    id: 'r1',
    spaceId: 's1',
    name: 'Strength',
    logStyle: 'sets',
    order: 0,
    items: [
      { id: 'i1', exerciseId: 'press', sets: 3, reps: '8', load: '16 kg', note: 'Brace' },
      { id: 'i2', exerciseId: 'squat', sets: 2 },
    ],
  };

  beforeEach(async () => {
    await db.routines.add(routine);
    await db.workouts.add(workout('w', TODAY, { routineId: 'r1', items: routine.items.map((i) => ({ ...i })) }));
  });

  it('writes sets, reps, load, rest and a ladder back to the matching item only', async () => {
    const saved = await changePlan('w', 'i1', (i) => ({ ...i, sets: 5, load: '20 kg', rest: 90, repsBySet: [1, 2, 3, 4, 5], note: undefined }));
    expect(saved).toBe(true);
    const r = await db.routines.get('r1');
    expect(r?.items[0]).toEqual({ id: 'i1', exerciseId: 'press', sets: 5, reps: '8', load: '20 kg', rest: 90, repsBySet: [1, 2, 3, 4, 5] });
    expect(r?.items[1]).toEqual(routine.items[1]);
    // The session's own copy changed too.
    expect((await db.workouts.get('w'))?.items[0].sets).toBe(5);
  });

  it('says so when there is no routine item to update', async () => {
    await db.workouts.add(workout('quick', TODAY, { items: [{ id: 'x', exerciseId: 'press' }] }));
    expect(await writeBack('quick', 'x')).toBe(false);
    expect(await changePlan('w', 'missing', (i) => i)).toBe(false);
  });
});
