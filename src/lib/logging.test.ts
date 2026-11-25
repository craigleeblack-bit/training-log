import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, TABLES, type Exercise, type RoutineItem, type Workout } from '../db/schema';
import { exerciseHistory, lastTime, loadCount, setVolume, summariseSets } from '../db/queries';
import { workoutLines } from './claude';
import { addSet, moveItem, removeItem, removeSet, saveSet, swapItem } from './logging';

const press: Exercise = { id: 'press', name: 'Press', measure: 'weight_reps', links: [] };
const squat: Exercise = { id: 'squat', name: 'Squat', measure: 'weight_reps', links: [] };
const item: RoutineItem = { id: 'i1', exerciseId: 'press', sets: 3, load: '2 × 16 kg' };
const other: RoutineItem = { id: 'i2', exerciseId: 'squat', sets: 2 };

const workout = (over: Partial<Workout> = {}): Workout => ({
  id: 'w1',
  date: '2026-11-24',
  startedAt: 1,
  spaceId: 's1',
  title: 'Strength',
  logStyle: 'sets',
  status: 'in_progress',
  items: [item, other],
  ...over,
});

const reps = async () => (await db.sets.where('workoutId').equals('w1').sortBy('setNo')).map((s) => [s.setNo, s.reps]);

beforeEach(async () => {
  for (const t of TABLES) await db.table(t).clear();
  await db.exercises.bulkAdd([press, squat]);
  await db.workouts.add(workout());
});

describe('sets in a session', () => {
  it('keeps the bell count beside the per-bell weight', async () => {
    await saveSet(workout(), item, press, 1, { weight: 16, reps: 5 });
    const [s] = await db.sets.toArray();
    expect(s).toMatchObject({ weight: 16, count: 2, reps: 5 });
    expect(setVolume(s)).toBe(160);
    expect(summariseSets([s], 'weight_reps')).toBe('2 × 16 kg × 5');
    expect(loadCount('60 kg')).toBeUndefined();
    expect(loadCount('3 x 10')).toBe(3);
  });

  it('removes a middle set and moves the later ones up', async () => {
    for (const n of [1, 2, 3]) await saveSet(workout(), item, press, n, { weight: 16, reps: n * 10 });
    await removeSet('w1', 'i1', 2);
    expect(await reps()).toEqual([
      [1, 10],
      [2, 30],
    ]);
    expect((await db.sets.toArray()).map((s) => s.id).sort()).toEqual(['w1:i1:1', 'w1:i1:2']);
    expect((await db.workouts.get('w1'))?.items[0].sets).toBe(2);
  });

  it('never drops below one set, and adds from however many are showing', async () => {
    await db.workouts.update('w1', { items: [{ ...item, sets: 1 }, other] });
    await removeSet('w1', 'i1', 1);
    expect((await db.workouts.get('w1'))?.items[0].sets).toBe(1);
    await saveSet(workout(), item, press, 4, { weight: 16, reps: 5 }); // logged past the plan
    await addSet('w1', 'i1');
    expect((await db.workouts.get('w1'))?.items[0].sets).toBe(5);
  });

  it('removes, swaps and reorders exercises without touching the others', async () => {
    await saveSet(workout(), item, press, 1, { weight: 16, reps: 5 });
    await saveSet(workout(), other, squat, 1, { weight: 40, reps: 8 });
    await moveItem('w1', 'i2', -1);
    expect((await db.workouts.get('w1'))?.items.map((i) => i.id)).toEqual(['i2', 'i1']);
    await swapItem('w1', 'i1', 'squat');
    expect((await db.workouts.get('w1'))?.items[1].exerciseId).toBe('squat');
    expect((await db.sets.toArray()).map((s) => s.itemId)).toEqual(['i2']);
    await removeItem('w1', 'i2');
    expect((await db.workouts.get('w1'))?.items.map((i) => i.id)).toEqual(['i1']);
    expect(await db.sets.count()).toBe(0);
  });
});

describe('history', () => {
  it('only counts finished sessions', async () => {
    await db.workouts.bulkAdd([
      workout({ id: 'done', date: '2026-11-10', status: 'done' }),
      workout({ id: 'skipped', date: '2026-11-17', status: 'skipped' }),
      workout({ id: 'open', date: '2026-11-20' }),
    ]);
    const set = (workoutId: string, date: string, n: number) => ({
      id: workoutId,
      workoutId,
      exerciseId: 'press',
      date,
      setNo: 1,
      reps: n,
      weight: 16,
    });
    await db.sets.bulkAdd([set('done', '2026-11-10', 5), set('skipped', '2026-11-17', 6), set('open', '2026-11-20', 7)]);
    expect((await lastTime(db, 'press', { workoutId: 'w1' }))?.workoutId).toBe('done');
    expect((await exerciseHistory(db, press)).map((h) => h.workoutId)).toEqual(['done']);
  });
});

describe('Claude export', () => {
  it('says which exercises of a tick-off session were done', async () => {
    const w = workout({ logStyle: 'session', status: 'done', checked: ['i2'] });
    const lines = await workoutLines(db, w);
    expect(lines).toContain('- [ ] Press');
    expect(lines).toContain('- [x] Squat');
  });
});
