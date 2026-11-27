import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { db, type Programme, type ProgrammeSlot, type Workout } from '../db/schema';
import {
  copyWeek,
  monthGrid,
  moveProgrammeDay,
  moveSlot,
  plannedSessions,
  programmeCopy,
  repeatWeeks,
  routineCopy,
  routineFromWorkout,
  shiftMonth,
  applyWeekSchedule,
  movedDay,
  routinesByDay,
  weekSchedule,
  withDay,
  withoutDay,
} from './planning';

const slots: ProgrammeSlot[] = [
  { week: 1, day: 0, title: 'A' },
  { week: 1, day: 2, title: 'B' },
  { week: 2, day: 0, title: 'C' },
  { week: 3, day: 4, title: 'Old' },
];
const titles = (list: ProgrammeSlot[], week: number) =>
  list
    .filter((s) => s.week === week)
    .sort((a, b) => a.day - b.day)
    .map((s) => `${s.day}:${s.title}`);

const programme: Programme = { id: 'p1', spaceId: 's1', name: 'Recon', startDate: '2026-11-23', weeks: 3, active: true, slots };

const workout = (over: Partial<Workout>): Workout => ({
  id: 'w1',
  date: '2026-11-23',
  startedAt: 1,
  spaceId: 's1',
  title: 'A',
  logStyle: 'sets',
  items: [],
  status: 'done',
  programmeId: 'p1',
  slotKey: '1-0',
  ...over,
});

describe('weeks', () => {
  it('copies a week over others, replacing what they held', () => {
    const out = copyWeek(slots, 1, [2, 3]);
    expect(titles(out, 2)).toEqual(['0:A', '2:B']);
    expect(titles(out, 3)).toEqual(['0:A', '2:B']);
    expect(titles(out, 1)).toEqual(['0:A', '2:B']);
    expect(copyWeek(slots, 1, [1])).toHaveLength(slots.length);
  });

  it('repeats a block of weeks to the end', () => {
    const out = repeatWeeks(slots, 2, 5);
    expect(titles(out, 3)).toEqual(['0:A', '2:B']);
    expect(titles(out, 4)).toEqual(['0:C']);
    expect(titles(out, 5)).toEqual(['0:A', '2:B']);
  });

  it('moves a day, swapping when the target is taken', () => {
    expect(titles(moveSlot(slots, { week: 1, day: 0 }, { week: 1, day: 5 }), 1)).toEqual(['2:B', '5:A']);
    expect(titles(moveSlot(slots, { week: 1, day: 0 }, { week: 1, day: 2 }), 1)).toEqual(['0:B', '2:A']);
  });

  it('takes a logged session along when its day moves', async () => {
    await db.programmes.put(programme);
    await db.workouts.put(workout({}));
    await moveProgrammeDay('p1', { week: 1, day: 0 }, { week: 1, day: 5 });
    expect((await db.workouts.get('w1'))?.slotKey).toBe('1-5');
    expect((await db.programmes.get('p1'))?.slots.find((s) => s.title === 'A')).toMatchObject({ week: 1, day: 5 });
  });
});

describe('copies', () => {
  it('gives a routine copy its own ids', () => {
    const r = { id: 'r1', spaceId: 's1', name: 'Upper', logStyle: 'sets' as const, order: 0, items: [{ id: 'i1', exerciseId: 'e1', sets: 3 }] };
    const c = routineCopy(r, 4);
    expect(c).toMatchObject({ name: 'Upper copy', order: 4 });
    expect(c.id).not.toBe('r1');
    expect(c.items[0]).toMatchObject({ exerciseId: 'e1', sets: 3 });
    expect(c.items[0].id).not.toBe('i1');
  });

  it('starts a programme copy afresh, off the Today screen', () => {
    const c = programmeCopy(programme, '2027-01-04');
    expect(c).toMatchObject({ name: 'Recon copy', startDate: '2027-01-04', active: false });
    expect(c.slots).toEqual(slots);
    expect(c.slots[0]).not.toBe(slots[0]);
  });

  it('makes a routine out of a finished session', () => {
    const r = routineFromWorkout(workout({ title: 'Garage day', items: [{ id: 'i9', exerciseId: 'e1', sets: 4 }] }), 2);
    expect(r).toMatchObject({ name: 'Garage day', spaceId: 's1', order: 2 });
    expect(r.items[0].id).not.toBe('i9');
  });
});

describe('calendar', () => {
  it('lays a month out Monday first', () => {
    const nov = monthGrid('2026-11'); // 1 November 2026 is a Sunday
    expect(nov[0][0]).toBe('2026-10-26');
    expect(nov[0][6]).toBe('2026-11-01');
    expect(nov.at(-1)![0]).toBe('2026-11-30');
    expect(nov).toHaveLength(6);
    expect(monthGrid('2027-02')).toHaveLength(4); // 1 February 2027 is a Monday
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('lists what is still to do, skipping rest days and finished sessions', () => {
    const p = { ...programme, slots: [...slots, { week: 2, day: 6, title: 'Rest', rest: true }] };
    const planned = plannedSessions([p, { ...p, id: 'p2', active: false }], [workout({})]);
    expect(planned.map((x) => `${x.date} ${x.slot.title}`)).toEqual(['2026-11-25 B', '2026-11-30 C', '2026-12-11 Old']);
  });

  it('leaves out a programme without calendar dates', () => {
    expect(plannedSessions([{ ...programme, dated: false }], [])).toEqual([]);
    expect(plannedSessions([{ ...programme, dated: true }], [])).toHaveLength(4);
  });

  it('keeps a copy on or off calendar dates as the original was', () => {
    expect(programmeCopy({ ...programme, dated: false }).dated).toBe(false);
  });
});

describe('editing the weekly schedule', () => {
  it('adds, takes off and moves days, keeping them sorted and unique', () => {
    expect(withDay(undefined, 3)).toEqual([3]);
    expect(withDay([4, 0], 2)).toEqual([0, 2, 4]);
    expect(withDay([0, 2], 2)).toEqual([0, 2]);
    expect(withoutDay([0, 2], 2)).toEqual([0]);
    // The last day off leaves no schedule at all, not an empty list.
    expect(withoutDay([2], 2)).toBeUndefined();
    expect(movedDay([0, 2, 4], 0, 1)).toEqual([1, 2, 4]);
    // Onto a day it already has: the two become one.
    expect(movedDay([0, 2, 4], 0, 2)).toEqual([2, 4]);
  });

  it('lists each day’s routines in their own order', () => {
    const r = (name: string, order: number, days?: number[]) => ({ name, order, days });
    const byDay = routinesByDay([r('B', 1, [0, 3]), r('A', 0, [0]), r('Off', 2)]);
    expect(byDay.map((d) => d.map((x) => x.name))).toEqual([['A', 'B'], [], [], ['B'], [], [], []]);
  });
});

describe('a programme week as the weekly schedule', () => {
  const week: ProgrammeSlot[] = [
    { week: 1, day: 0, title: 'A', routineId: 'ra' },
    { week: 1, day: 2, title: 'B', routineId: 'rb' },
    { week: 1, day: 4, title: 'A again', routineId: 'ra' },
    { week: 1, day: 5, title: 'Walk' },
    { week: 1, day: 6, title: 'Rest', rest: true, routineId: 'rb' },
    { week: 2, day: 1, title: 'C', routineId: 'rc' },
  ];

  it('collects the days each routine falls on, leaving out rest days and sessions with no routine', () => {
    const undated = { ...programme, dated: false, slots: week };
    expect([...weekSchedule(undated, 1)]).toEqual([
      ['ra', [0, 4]],
      ['rb', [2]],
    ]);
    // Dated, a day is the weekday of its date: this programme starts on a Wednesday.
    const dated = { ...programme, startDate: '2026-11-25', slots: week };
    expect(weekSchedule(dated, 1).get('ra')).toEqual([2, 6]);
  });

  it('writes the days onto the routines, replacing what they had', async () => {
    await db.routines.bulkPut([
      { id: 'ra', spaceId: 's1', name: 'A', logStyle: 'sets', items: [], order: 0, days: [6] },
      { id: 'rb', spaceId: 's1', name: 'B', logStyle: 'sets', items: [], order: 1 },
      { id: 'rc', spaceId: 's1', name: 'C', logStyle: 'sets', items: [], order: 2, days: [3] },
    ]);
    expect(await applyWeekSchedule({ ...programme, dated: false, slots: week }, 1)).toBe(2);
    expect((await db.routines.get('ra'))?.days).toEqual([0, 4]);
    expect((await db.routines.get('rb'))?.days).toEqual([2]);
    expect((await db.routines.get('rc'))?.days).toEqual([3]);
  });
});
