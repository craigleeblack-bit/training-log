import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, TABLES, type Exercise, type RoutineItem, type Workout } from '../db/schema';
import { complexTotals, describeParts, exerciseHistory, lastTime, loadCount, setVolume, summariseSets } from '../db/queries';
import { workoutLines } from './claude';
import {
  addSet,
  groupItems,
  insertItemAt,
  linkAbove,
  moveItemTo,
  moveItem,
  normaliseGroups,
  parseLadder,
  removeItem,
  removeSet,
  saveSet,
  setsDone,
  swapItem,
  ungroupItems,
} from './logging';

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

describe('workout structures', () => {
  const items = (groups: (string | undefined)[]): RoutineItem[] =>
    groups.map((group, n) => ({ id: `i${n}`, exerciseId: 'press', ...(group ? { group } : {}) }));
  const groupsOf = (list: RoutineItem[]) => list.map((i) => i.group);

  it('keeps a superset to neighbours, and drops a group of one', () => {
    expect(groupsOf(normaliseGroups(items(['a', 'a', undefined, 'a'])))).toEqual(['g0', 'g0', undefined, undefined]);
    expect(groupsOf(normaliseGroups(items(['a', 'b', 'b'])))).toEqual([undefined, 'g1', 'g1']);
  });

  it('links an exercise to the one above and splits it off again', () => {
    const linked = linkAbove(items([undefined, undefined, undefined]), 1, true);
    expect(groupsOf(linked)).toEqual(['g0', 'g0', undefined]);
    const three = linkAbove(linked, 2, true);
    expect(groupsOf(three)).toEqual(['g0', 'g0', 'g0']);
    expect(groupsOf(linkAbove(three, 1, false))).toEqual([undefined, 'g1', 'g1']);
    expect(groupsOf(linkAbove(linked, 1, false))).toEqual([undefined, undefined, undefined]);
  });

  it('makes chosen rows one superset, pulling scattered ones together', () => {
    const ids = (list: RoutineItem[]) => list.map((i) => i.id);
    const next = groupItems(items([undefined, undefined, undefined]), ['i0', 'i1']);
    expect(groupsOf(next)).toEqual(['g0', 'g0', undefined]);
    const scattered = groupItems(items([undefined, undefined, undefined, undefined]), ['i1', 'i3']);
    expect(ids(scattered)).toEqual(['i0', 'i1', 'i3', 'i2']);
    expect(groupsOf(scattered)).toEqual([undefined, 'g1', 'g1', undefined]);
    // One row alone is not a superset.
    expect(groupItems(items([undefined, undefined]), ['i1'])).toEqual(items([undefined, undefined]));
  });

  it('joins a row onto an existing superset, bringing the whole superset', () => {
    const list = items(['a', 'a', undefined, undefined]);
    const next = groupItems(list, ['i1', 'i3']);
    expect(next.map((i) => i.id)).toEqual(['i0', 'i1', 'i3', 'i2']);
    expect(groupsOf(next)).toEqual(['g0', 'g0', 'g0', undefined]);
  });

  it('moves a row to a gap, joining a superset it lands inside', () => {
    const ids = (list: RoutineItem[]) => list.map((i) => i.id);
    const plain = items([undefined, undefined, undefined]);
    expect(ids(moveItemTo(plain, 'i0', 3))).toEqual(['i1', 'i2', 'i0']);
    expect(ids(moveItemTo(plain, 'i2', 0))).toEqual(['i2', 'i0', 'i1']);
    expect(ids(moveItemTo(plain, 'i1', 1))).toEqual(['i0', 'i1', 'i2']);
    // Into the middle of a superset: it joins.
    const into = moveItemTo(items([undefined, 'a', 'a']), 'i0', 2);
    expect(ids(into)).toEqual(['i1', 'i0', 'i2']);
    expect(groupsOf(into)).toEqual(['g0', 'g0', 'g0']);
    // Reordered within its own superset, it stays in it; dragged away, it leaves.
    expect(groupsOf(moveItemTo(items(['a', 'a', undefined]), 'i1', 0))).toEqual(['g0', 'g0', undefined]);
    expect(groupsOf(moveItemTo(items(['a', 'a', 'a', undefined]), 'i0', 4))).toEqual(['g0', 'g0', undefined, undefined]);
    // A new exercise dropped between two of a superset joins it too.
    const added = insertItemAt(items(['a', 'a']), { id: 'new', exerciseId: 'press' }, 1);
    expect(groupsOf(added)).toEqual(['g0', 'g0', 'g0']);
  });

  it('splits rows out, keeping the rest of the group together', () => {
    const circuit = items(['a', 'a', 'a', undefined]);
    const split = ungroupItems(circuit, ['i1']);
    expect(split.map((i) => i.id)).toEqual(['i0', 'i2', 'i1', 'i3']);
    expect(groupsOf(split)).toEqual(['g0', 'g0', undefined, undefined]);
    expect(groupsOf(ungroupItems(items(['a', 'a']), ['i0']))).toEqual([undefined, undefined]);
  });

  it('reads a ladder, and nothing else as one', () => {
    expect(parseLadder('1, 2, 3, 4, 5')).toEqual([1, 2, 3, 4, 5]);
    expect(parseLadder('5-3-2')).toEqual([5, 3, 2]);
    expect(parseLadder('8')).toBeUndefined();
    expect(parseLadder('light, heavy')).toBeUndefined();
  });

  it('counts a set as done only when both sides are, and summarises left / right', async () => {
    const sided: RoutineItem = { ...item, load: '16 kg', eachSide: true, sets: 2 };
    await saveSet(workout(), sided, press, 1, { weight: 16, reps: 8 }, 'L');
    let entries = await db.sets.toArray();
    expect(setsDone(sided, entries)).toBe(0);
    await saveSet(workout(), sided, press, 1, { weight: 16, reps: 7 }, 'R');
    await saveSet(workout(), sided, press, 2, { weight: 16, reps: 8 }, 'L');
    entries = await db.sets.toArray();
    expect(setsDone(sided, entries)).toBe(1);
    expect(entries.map((e) => e.id).sort()).toEqual(['w1:i1:1:L', 'w1:i1:1:R', 'w1:i1:2:L']);
    expect(summariseSets(entries, 'weight_reps')).toBe('16 kg × 8/7, 8/– (L/R)');
  });

  it('adds up what the rounds of a complex come to', () => {
    const parts = [
      { name: 'Double clean', reps: 2 },
      { name: 'Double press', reps: 1 },
      { name: 'Front squat', reps: 3 },
    ];
    expect(describeParts(parts)).toBe('2 double clean, 1 double press, 3 front squat');
    expect(complexTotals(parts, 7)).toBe('14 double clean, 7 double press, 21 front squat');
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
