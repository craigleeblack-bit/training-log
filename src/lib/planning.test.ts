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
