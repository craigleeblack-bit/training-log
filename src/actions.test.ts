import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { db, type Routine } from './db/schema';
import { scheduleWeek } from './db/queries';
import { setItemRest } from './lib/logging';
import { startWorkout } from './actions';

const routine: Routine = {
  id: 'r-mwf',
  spaceId: 's1',
  name: 'Strength',
  logStyle: 'sets',
  order: 0,
  days: [0, 2, 4],
  items: [{ id: 'i1', exerciseId: 'e1', sets: 3, rest: 90 }],
};

describe('starting from a day card', () => {
  it('records the day, and resumes only that day’s unfinished session', async () => {
    await db.routines.put(routine);
    const mon = await startWorkout({ spaceId: 's1', routine, scheduleDay: 0, date: '2026-11-23' });
    expect((await db.workouts.get(mon))?.scheduleDay).toBe(0);
    // The same routine on Wednesday is its own session, not Monday's resumed.
    const wed = await startWorkout({ spaceId: 's1', routine, scheduleDay: 2, date: '2026-11-25' });
    expect(wed).not.toBe(mon);
    expect(await startWorkout({ spaceId: 's1', routine, scheduleDay: 0, date: '2026-11-24' })).toBe(mon);
    // Monday of the next week starts afresh, even with last week's left open.
    expect(await startWorkout({ spaceId: 's1', routine, scheduleDay: 0, date: '2026-11-30' })).not.toBe(mon);

    // Finishing Monday's ticks Monday's card, and only that one.
    await db.workouts.update(mon, { status: 'done' });
    const week = scheduleWeek([routine], await db.workouts.toArray(), '2026-11-23');
    expect(week.map((d) => d.map((c) => c.state))).toEqual([['done'], [], ['resume'], [], ['open'], [], []]);
  });

  it('saves a rest change for this session and for next time', async () => {
    await db.routines.put(routine);
    const id = await startWorkout({ spaceId: 's1', routine, scheduleDay: 4, date: '2026-11-27' });
    expect(await setItemRest(id, 'i1', 105)).toBe(true);
    expect((await db.workouts.get(id))?.items[0].rest).toBe(105);
    expect((await db.routines.get(routine.id))?.items[0].rest).toBe(105);
    // An exercise that is only in this session has no routine item to save to.
    await db.workouts.update(id, { items: [...(await db.workouts.get(id))!.items, { id: 'extra', exerciseId: 'e2' }] });
    expect(await setItemRest(id, 'extra', 60)).toBe(false);
  });
});
