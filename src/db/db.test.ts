import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { AppDB, type Programme, type Routine, type Workout } from './schema';
import { exportBackup, importBackup, validateBackup } from './backup';
import {
  closedSlots,
  currentWeek,
  lastRoutineSession,
  lastTime,
  loadNumber,
  nextSlot,
  programmeProgress,
  repsNumber,
  slotDate,
  slotForDate,
  scheduleWeek,
  setsLine,
  summariseSets,
  type WeekCell,
} from './queries';
import { emomPhases, intervalPhases, positionAt, totalSeconds } from '../lib/timer';
import { normaliseClaudeUrl } from '../lib/claude';
import { addDays, daysBetween, inWeek, repeatLabel, weekDates, weekdayIndex, weekRangeLabel, weekStart } from '../lib/dates';

let n = 0;
const freshDb = () => new AppDB(`test-${++n}`);

const programme: Programme = {
  id: 'p1',
  spaceId: 's1',
  name: 'Recon',
  startDate: '2026-11-23',
  weeks: 2,
  active: true,
  slots: [
    { week: 1, day: 0, title: 'Strength A' },
    { week: 1, day: 1, title: 'Easy aerobic' },
    { week: 1, day: 6, title: 'Rest', rest: true },
    { week: 2, day: 0, title: 'Strength B' },
  ],
};

const workout = (over: Partial<Workout>): Workout => ({
  id: 'w' + ++n,
  date: '2026-11-23',
  startedAt: n,
  spaceId: 's1',
  title: 't',
  logStyle: 'sets',
  items: [],
  status: 'done',
  ...over,
});

describe('dates', () => {
  it('counts whole days across a DST change', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
  });
});

describe('programme resolution', () => {
  it('maps a calendar date to its week and day', () => {
    expect(slotForDate(programme, '2026-11-23')?.title).toBe('Strength A');
    expect(slotForDate(programme, '2026-11-24')?.title).toBe('Easy aerobic');
    expect(slotForDate(programme, '2026-11-30')?.title).toBe('Strength B');
  });

  it('returns nothing outside the programme or on an unscheduled day', () => {
    expect(slotForDate(programme, '2026-11-22')).toBeUndefined();
    expect(slotForDate(programme, '2026-12-07')).toBeUndefined();
    expect(slotForDate(programme, '2026-11-25')).toBeUndefined();
  });

  it('gives each slot its calendar date', () => {
    expect(slotDate(programme, { week: 2, day: 0 })).toBe('2026-11-30');
  });

  it('picks the first undone training slot and skips rest days', () => {
    expect(nextSlot(programme, [])?.title).toBe('Strength A');
    const done = [
      workout({ programmeId: 'p1', slotKey: '1-0' }),
      workout({ programmeId: 'p1', slotKey: '1-1', status: 'skipped' }),
    ];
    expect(nextSlot(programme, done)?.title).toBe('Strength B');
    expect(programmeProgress(programme, done)).toEqual({ done: 1, total: 3 });
  });

  it('does not count an in-progress workout as finished', () => {
    const w = [workout({ programmeId: 'p1', slotKey: '1-0', status: 'in_progress' })];
    expect(nextSlot(programme, w)?.title).toBe('Strength A');
  });
});

describe('programme week', () => {
  it('is the first week with a session still open, ignoring rest days', () => {
    expect(currentWeek(programme, closedSlots(programme, []))).toBe(1);
    const week1 = [
      workout({ programmeId: 'p1', slotKey: '1-0' }),
      workout({ programmeId: 'p1', slotKey: '1-1', status: 'skipped' }),
    ];
    expect(currentWeek(programme, closedSlots(programme, week1))).toBe(2);
    const all = [...week1, workout({ programmeId: 'p1', slotKey: '2-0' })];
    // Everything done: it stays on the last week.
    expect(currentWeek(programme, closedSlots(programme, all))).toBe(2);
  });
});

describe('weeks of the calendar', () => {
  it('starts every week on Monday, across the Sunday-to-Monday boundary', () => {
    // Sunday 29 November 2026 still belongs to the week of Monday 23rd; Monday 30th starts the next.
    expect(weekStart('2026-11-29')).toBe('2026-11-23');
    expect(weekStart('2026-11-30')).toBe('2026-11-30');
    expect(weekStart('2026-11-23')).toBe('2026-11-23');
    expect(weekStart('2027-01-01')).toBe('2026-12-28'); // across a year
    expect(weekStart('2026-03-29')).toBe('2026-03-23'); // the Sunday the clocks go forward
    expect(weekStart('2026-10-25')).toBe('2026-10-19'); // and back
    expect(weekdayIndex('2026-11-29')).toBe(6);
    expect(weekdayIndex('2026-11-30')).toBe(0);
  });

  it('lists the seven days and tells which week a date is in', () => {
    expect(weekDates('2026-11-23')).toEqual([
      '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29',
    ]);
    expect(inWeek('2026-11-29', '2026-11-23')).toBe(true);
    expect(inWeek('2026-11-30', '2026-11-23')).toBe(false);
    expect(inWeek('2026-11-22', '2026-11-23')).toBe(false);
  });

  it('names a week and a set of repeating days', () => {
    expect(weekRangeLabel('2026-11-23')).toBe('23–29 Nov');
    expect(weekRangeLabel('2026-11-30')).toBe('30 Nov–6 Dec');
    expect(repeatLabel([4, 0, 2])).toBe('Mon, Wed, Fri');
    expect(repeatLabel([0, 1, 2, 3, 4])).toBe('Weekdays');
    expect(repeatLabel([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(repeatLabel(undefined)).toBe('');
  });
});

describe('the week from routine schedules', () => {
  const strength: Routine = { id: 'str', spaceId: 's1', name: 'Strength', logStyle: 'sets', items: [], order: 0, days: [0, 2, 4] };
  const swim: Routine = { id: 'swim', spaceId: 's1', name: 'Swim', logStyle: 'session', items: [], order: 1, days: [2] };
  const unscheduled: Routine = { id: 'x', spaceId: 's1', name: 'Odd one', logStyle: 'sets', items: [], order: 2 };
  const routines = [strength, swim, unscheduled];
  const mon = '2026-11-23';
  const states = (cells: WeekCell[][]) => cells.map((d) => d.map((c) => `${c.routine.id}:${c.state}`));

  it('puts each routine on its days, stacking several on one day', () => {
    expect(states(scheduleWeek(routines, [], mon))).toEqual([
      ['str:open'], [], ['str:open', 'swim:open'], [], ['str:open'], [], [],
    ]);
    expect(scheduleWeek(routines, [], mon)[6]).toEqual([]);
    expect(scheduleWeek(routines, [], mon)[2][0].date).toBe('2026-11-25');
  });

  it('a routine on Mon, Wed and Fri ticks only the day its session was for', () => {
    const wed = workout({ routineId: 'str', scheduleDay: 2, date: '2026-11-25' });
    expect(states(scheduleWeek(routines, [wed], mon))).toEqual([
      ['str:open'], [], ['str:done', 'swim:open'], [], ['str:open'], [], [],
    ]);
    // Wednesday's session done late on Thursday still ticks Wednesday.
    const late = workout({ routineId: 'str', scheduleDay: 2, date: '2026-11-26' });
    expect(scheduleWeek(routines, [late], mon)[2][0].state).toBe('done');
    expect(scheduleWeek(routines, [late], mon)[3]).toEqual([]);
  });

  it('starts a new week clear, and an earlier week still shows its ticks', () => {
    const done = [
      workout({ routineId: 'str', scheduleDay: 0, date: '2026-11-23' }),
      workout({ routineId: 'swim', scheduleDay: 2, date: '2026-11-25' }),
    ];
    expect(scheduleWeek(routines, done, '2026-11-30').flat().every((c) => c.state === 'open')).toBe(true);
    expect(scheduleWeek(routines, done, mon)[0][0].state).toBe('done');
    // A session on the Sunday belongs to that week, not the next.
    const sunday = workout({ routineId: 'str', scheduleDay: 4, date: '2026-11-29' });
    expect(scheduleWeek(routines, [sunday], mon)[4][0].state).toBe('done');
    expect(scheduleWeek(routines, [sunday], '2026-11-30')[4][0].state).toBe('open');
  });

  it('shows skipped and in-progress sessions, with a finished one winning', () => {
    const skipped = workout({ routineId: 'str', scheduleDay: 0, date: mon, status: 'skipped' });
    const going = workout({ routineId: 'str', scheduleDay: 2, date: '2026-11-25', status: 'in_progress' });
    expect(states(scheduleWeek([strength], [skipped, going], mon))).toEqual([
      ['str:skipped'], [], ['str:resume'], [], ['str:open'], [], [],
    ]);
    const redone = workout({ routineId: 'str', scheduleDay: 0, date: mon });
    expect(scheduleWeek([strength], [redone, skipped], mon)[0][0]).toMatchObject({ state: 'done', workout: redone });
  });

  it('counts a session started outside the week view on the weekday it was done', () => {
    // Started from the routine's space, with no day card: Friday's session ticks Friday.
    const friday = workout({ routineId: 'str', date: '2026-11-27' });
    expect(scheduleWeek([strength], [friday], mon)[4][0].state).toBe('done');
    // On a day the routine is not scheduled, it ticks nothing.
    const tuesday = workout({ routineId: 'str', date: '2026-11-24' });
    expect(scheduleWeek([strength], [tuesday], mon).flat().every((c) => c.state === 'open')).toBe(true);
  });
});

describe('last session of a routine', () => {
  it('gives the latest finished session, one line per item in the session order', async () => {
    const db = freshDb();
    await db.exercises.bulkAdd([
      { id: 'squat', name: 'Goblet squat', measure: 'weight_reps', links: [] },
      { id: 'plank', name: 'Plank', measure: 'time', links: [] },
    ]);
    const items = [
      { id: 'i1', exerciseId: 'squat' },
      { id: 'i2', exerciseId: 'plank' },
    ];
    await db.workouts.bulkAdd([
      workout({ id: 'old', date: '2026-11-10', routineId: 'r1', items }),
      workout({ id: 'new', date: '2026-11-17', routineId: 'r1', items }),
      workout({ id: 'skip', date: '2026-11-20', routineId: 'r1', status: 'skipped', items }),
      workout({ id: 'now', date: '2026-11-24', routineId: 'r1', status: 'in_progress', items }),
      workout({ id: 'other', date: '2026-11-21', routineId: 'r2', items }),
    ]);
    await db.sets.bulkAdd([
      { id: '1', workoutId: 'new', exerciseId: 'plank', itemId: 'i2', date: '2026-11-17', setNo: 1, seconds: 45 },
      { id: '2', workoutId: 'new', exerciseId: 'squat', itemId: 'i1', date: '2026-11-17', setNo: 2, reps: 10, weight: 16 },
      { id: '3', workoutId: 'new', exerciseId: 'squat', itemId: 'i1', date: '2026-11-17', setNo: 1, reps: 10, weight: 16 },
      { id: '5', workoutId: 'new', exerciseId: 'squat', itemId: 'i1', date: '2026-11-17', setNo: 3, reps: 10, weight: 16 },
      { id: '4', workoutId: 'old', exerciseId: 'squat', itemId: 'i1', date: '2026-11-10', setNo: 1, reps: 8, weight: 12 },
    ]);
    const recap = await lastRoutineSession(db, 'r1', { excludeWorkoutId: 'now' });
    expect(recap?.workout.id).toBe('new');
    expect(recap?.lines).toEqual([
      { itemId: 'i1', exerciseId: 'squat', name: 'Goblet squat', summary: '3 × 10 @ 16 kg' },
      { itemId: 'i2', exerciseId: 'plank', name: 'Plank', summary: '0:45' },
    ]);
    expect((await lastRoutineSession(db, 'r1', { excludeWorkoutId: 'new' }))?.workout.id).toBe('old');
    expect(await lastRoutineSession(db, 'nothing')).toBeUndefined();
  });

  it('keeps the same exercise twice in a routine apart, by item', async () => {
    const db = freshDb();
    await db.exercises.add({ id: 'swing', name: 'Swing', measure: 'weight_reps', links: [] });
    await db.workouts.add(
      workout({ id: 'w', routineId: 'r1', items: [{ id: 'a', exerciseId: 'swing' }, { id: 'b', exerciseId: 'swing' }] }),
    );
    await db.sets.bulkAdd([
      { id: '1', workoutId: 'w', exerciseId: 'swing', itemId: 'a', date: '2026-11-23', setNo: 1, reps: 10, weight: 24 },
      { id: '2', workoutId: 'w', exerciseId: 'swing', itemId: 'b', date: '2026-11-23', setNo: 1, reps: 20, weight: 16 },
    ]);
    expect((await lastRoutineSession(db, 'r1'))?.lines.map((l) => l.summary)).toEqual(['24 kg × 10', '16 kg × 20']);
  });

  it('writes identical sets compactly and varied ones in full', () => {
    const s = (setNo: number, reps: number, weight?: number) => ({ id: String(setNo), workoutId: 'w', exerciseId: 'e', date: '2026-11-23', setNo, reps, weight });
    expect(setsLine([s(1, 10, 16), s(2, 10, 16), s(3, 10, 16)], 'weight_reps')).toBe('3 × 10 @ 16 kg');
    expect(setsLine([s(1, 10, 16), s(2, 8, 16)], 'weight_reps')).toBe('16 kg × 10, 8');
    expect(setsLine([s(1, 12), s(2, 12)], 'reps')).toBe('2 × 12');
    expect(setsLine([s(1, 10, 16)], 'weight_reps')).toBe('16 kg × 10');
  });
});

describe('last time', () => {
  it('returns the most recent earlier session for an exercise', async () => {
    const db = freshDb();
    await db.workouts.bulkAdd([
      workout({ id: 'a', date: '2026-11-10' }),
      workout({ id: 'b', date: '2026-11-17' }),
      workout({ id: 'c', date: '2026-11-24', status: 'in_progress' }),
    ]);
    await db.sets.bulkAdd([
      { id: '1', workoutId: 'a', exerciseId: 'press', date: '2026-11-10', setNo: 1, reps: 8, weight: 55 },
      { id: '2', workoutId: 'b', exerciseId: 'press', date: '2026-11-17', setNo: 2, reps: 7, weight: 60 },
      { id: '3', workoutId: 'b', exerciseId: 'press', date: '2026-11-17', setNo: 1, reps: 8, weight: 60 },
      { id: '4', workoutId: 'c', exerciseId: 'press', date: '2026-11-24', setNo: 1, reps: 9, weight: 60 },
      { id: '5', workoutId: 'b', exerciseId: 'row', date: '2026-11-17', setNo: 1, reps: 12, weight: 12 },
    ]);
    const last = await lastTime(db, 'press', { workoutId: 'c' });
    expect(last?.date).toBe('2026-11-17');
    expect(last?.sets.map((s) => s.reps)).toEqual([8, 7]);
    expect(summariseSets(last!.sets, 'weight_reps')).toBe('60 kg × 8, 7');
  });

  it('ignores empty rows and returns undefined when nothing is logged', async () => {
    const db = freshDb();
    await db.sets.add({ id: '1', workoutId: 'a', exerciseId: 'press', date: '2026-11-10', setNo: 1 });
    expect(await lastTime(db, 'press')).toBeUndefined();
  });
});

describe('prescription parsing', () => {
  it('reads the per-bell weight from a double load', () => {
    expect(loadNumber('2 × 16 kg')).toBe(16);
    expect(loadNumber('60 kg')).toBe(60);
    expect(loadNumber('12.5')).toBe(12.5);
    expect(loadNumber('BW')).toBeUndefined();
  });
  it('reads the low end of a rep range', () => {
    expect(repsNumber('8–12')).toBe(8);
    expect(repsNumber(undefined)).toBeUndefined();
  });
});

describe('backup', () => {
  it('round-trips every table', async () => {
    const a = freshDb();
    await a.spaces.add({ id: 's1', name: 'Home', color: '#000', order: 0 });
    await a.workouts.add(workout({ id: 'w1', notes: 'felt fine' }));
    await a.sets.add({ id: 'x', workoutId: 'w1', exerciseId: 'e', date: '2026-11-23', setNo: 1, reps: 5 });
    await a.settings.put({ key: 'claudeProjectUrl', value: 'https://claude.ai/project/abc' });
    const file = JSON.parse(JSON.stringify(await exportBackup(a)));

    const b = freshDb();
    await b.spaces.add({ id: 'old', name: 'Old', color: '#fff', order: 0 });
    await importBackup(b, file, 'replace');
    // A space saved without an icon gets one guessed from its name on the way in.
    expect(await b.spaces.toArray()).toEqual([{ id: 's1', name: 'Home', color: '#000', icon: 'home', order: 0 }]);
    expect((await b.workouts.get('w1'))?.notes).toBe('felt fine');
    expect(await b.sets.count()).toBe(1);
    expect((await b.settings.get('claudeProjectUrl'))?.value).toBe('https://claude.ai/project/abc');
  });

  it('merge keeps rows that are not in the file', async () => {
    const a = freshDb();
    await a.spaces.add({ id: 's1', name: 'Home', color: '#000', order: 0 });
    const file = await exportBackup(a);
    const b = freshDb();
    await b.spaces.add({ id: 'mine', name: 'Mine', color: '#fff', order: 1 });
    await importBackup(b, file, 'merge');
    expect((await b.spaces.toArray()).map((s) => s.id).sort()).toEqual(['mine', 's1']);
  });

  it('rejects files that are not backups and leaves data alone', async () => {
    const b = freshDb();
    await b.spaces.add({ id: 'mine', name: 'Mine', color: '#fff', order: 1 });
    expect(() => validateBackup({ hello: 1 })).toThrow();
    await expect(importBackup(b, { app: 'training-log', version: 1, data: { spaces: 'x' } })).rejects.toThrow();
    expect(await b.spaces.count()).toBe(1);
  });
});

describe('timer', () => {
  const fourByFour = intervalPhases({ warmup: 600, work: 240, rest: 180, rounds: 4, cooldown: 300 });

  it('builds the 4×4 without a trailing recovery', () => {
    expect(fourByFour.map((p) => p.kind)).toEqual([
      'warmup', 'work', 'rest', 'work', 'rest', 'work', 'rest', 'work', 'cooldown',
    ]);
    expect(totalSeconds(fourByFour)).toBe(600 + 4 * 240 + 3 * 180 + 300);
  });

  it('finds the phase at an elapsed time', () => {
    expect(positionAt(fourByFour, 0).phase?.kind).toBe('warmup');
    const p = positionAt(fourByFour, 600 + 10);
    expect(p.phase?.label).toBe('Round 1 of 4');
    expect(p.remaining).toBe(230);
    expect(positionAt(fourByFour, 99999).done).toBe(true);
  });

  it('EMOM has one phase per minute', () => {
    const e = emomPhases(10);
    expect(e).toHaveLength(10);
    expect(positionAt(e, 61).index).toBe(1);
  });
});

describe('claude link', () => {
  it('accepts only claude.ai addresses', () => {
    expect(normaliseClaudeUrl('claude.ai/project/abc')).toBe('https://claude.ai/project/abc');
    expect(normaliseClaudeUrl('https://example.com/claude.ai')).toBeUndefined();
    expect(normaliseClaudeUrl('https://notclaude.ai/x')).toBeUndefined();
    expect(normaliseClaudeUrl('')).toBeUndefined();
  });
});
