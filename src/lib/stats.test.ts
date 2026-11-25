import { describe, expect, it } from 'vitest';
import type { Exercise, SetEntry, Workout } from '../db/schema';
import { e1rm, formatMinutes, formatVolume, metricValue, newRecords, records, sideGap, summarise, weeksAgo, weekStart } from './stats';

const workout = (id: string, date: string, over: Partial<Workout> = {}): Workout => ({
  id,
  date,
  startedAt: 1,
  spaceId: 's1',
  title: id,
  logStyle: 'sets',
  items: [],
  status: 'done',
  minutes: 30,
  ...over,
});

let n = 0;
const set = (workoutId: string, date: string, weight: number, reps: number, over: Partial<SetEntry> = {}): SetEntry => ({
  id: `s${++n}`,
  workoutId,
  exerciseId: 'press',
  date,
  setNo: 1,
  weight,
  reps,
  ...over,
});

const workouts = [
  workout('a', '2026-11-03', { rpe: 6 }),
  workout('b', '2026-11-10', { rpe: 8 }),
  workout('c', '2026-11-24'),
  workout('skipped', '2026-11-17', { status: 'skipped' }),
  workout('open', '2026-11-25', { status: 'in_progress' }),
  workout('other', '2026-11-24', { spaceId: 's2' }),
];
const sets = [
  set('a', '2026-11-03', 16, 5, { count: 2 }), // 160
  set('b', '2026-11-10', 20, 5), // 100
  set('c', '2026-11-24', 20, 8), // 160
  set('skipped', '2026-11-17', 99, 99),
  set('open', '2026-11-25', 99, 99),
];
const input = { workouts, sets, tracks: [] };
const today = '2026-11-25'; // a Wednesday

describe('summary', () => {
  it('counts finished sessions only, week by week, empty weeks included', () => {
    const s = summarise(input, { since: weeksAgo(today, 4), spaceId: 's1' }, today);
    expect(s).toMatchObject({ sessions: 3, minutes: 90, avgRpe: 7, volume: 420 });
    expect(s.weeks.map((w) => `${w.start}:${w.sessions}:${w.volume}`)).toEqual([
      '2026-11-02:1:160',
      '2026-11-09:1:100',
      '2026-11-16:0:0',
      '2026-11-23:1:160',
    ]);
  });

  it('counts the run of weeks trained, forgiving a current week not yet started', () => {
    expect(summarise(input, { spaceId: 's1' }, today).streak).toBe(1);
    expect(summarise(input, { spaceId: 's1' }, '2026-11-15').streak).toBe(2); // weeks of 2 and 9 Nov
    expect(summarise(input, { spaceId: 's1' }, '2026-11-16').streak).toBe(2); // Monday, nothing yet this week
    expect(weekStart('2026-11-29')).toBe('2026-11-23');
  });
});

describe('records', () => {
  it('estimates a one-rep max only for ten reps or fewer, and counts both bells', () => {
    expect(e1rm({ weight: 100, reps: 1 })).toBe(100);
    expect(e1rm({ weight: 60, reps: 10 })).toBeCloseTo(80);
    expect(e1rm({ weight: 16, reps: 5, count: 2 })).toBeCloseTo(37.33, 1);
    expect(e1rm({ weight: 60, reps: 12 })).toBeUndefined();
  });

  it('finds the heaviest in each rep range', () => {
    const done = sets.slice(0, 3);
    const r = records(done, 'weight_reps');
    expect(r.find((x) => x.label === 'Heaviest for 4–6 reps')).toMatchObject({ value: '2 × 16 kg × 5', workoutId: 'a' });
    expect(r.find((x) => x.label === 'Heaviest for 7–10 reps')).toMatchObject({ value: '20 kg × 8' });
    expect(r.find((x) => x.label === 'Heaviest for 1–3 reps')).toBeUndefined();
    expect(records([set('a', '2026-11-03', 0, 12, { weight: undefined })], 'reps')[0]).toMatchObject({ value: '12' });
  });

  it('charts a session by the chosen measure', () => {
    const session = [set('x', 'd', 20, 5), set('x', 'd', 22, 3)];
    expect(metricValue(session, 'top')).toBe(22);
    expect(metricValue(session, 'volume')).toBe(166);
    expect(metricValue(session, 'reps')).toBe(8);
    expect(metricValue([], 'top')).toBeUndefined();
  });

  it('names what a session beat, but not a first attempt', () => {
    const press: Exercise = { id: 'press', name: 'Press', measure: 'weight_reps', links: [] };
    const fresh: Exercise = { id: 'new', name: 'New', measure: 'weight_reps', links: [] };
    const more = { ...input, sets: [...sets, set('c', '2026-11-24', 40, 3), set('c', '2026-11-24', 10, 5, { exerciseId: 'new' })] };
    expect(newRecords(more, 'c', [press, fresh])).toEqual(['Press: heaviest yet, 40 kg × 3']);
    expect(newRecords(input, 'b', [press])).toEqual([]); // 20 kg does not beat a pair of 16s
  });

  it('measures the gap between sides', () => {
    const l = set('x', 'd', 10, 10, { side: 'L' });
    const r = set('x', 'd', 10, 8, { side: 'R' });
    expect(sideGap([l, r])).toEqual({ stronger: 'L', share: 0.25 });
    expect(sideGap([l])).toBeUndefined();
  });

  it('formats totals', () => {
    expect(formatVolume(4200)).toBe('4,200 kg');
    expect(formatVolume(12400)).toBe('12.4 t');
    expect(formatMinutes(750)).toBe('12 h 30 min');
    expect(formatMinutes(45)).toBe('45 min');
  });
});
