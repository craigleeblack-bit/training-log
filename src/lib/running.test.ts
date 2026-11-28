import { describe, expect, it } from 'vitest';
import type { SetEntry, Track, TrackPoint } from '../db/schema';
import { bestEffort, personalBests, trackPace, weeklyDistance } from './running';
import { metricsFor, metricValue, workload } from './stats';

/** Points due north from 51°N, one every `every` metres at `speed` m/s, from t = 0. */
function line(n: number, every: number, speed: number, from = 0, t0 = 0): TrackPoint[] {
  const perMetre = 1 / 111195; // degrees of latitude per metre, on the haversine earth
  return Array.from({ length: n }, (_, k) => [t0 + ((k * every) / speed) * 1000, 51 + (from + k * every) * perMetre, 0] as TrackPoint);
}

const track = (over: Partial<Track>): Track => ({
  id: 't',
  workoutId: 'w',
  date: '2026-11-20',
  activity: 'run',
  startedAt: 0,
  segments: [],
  metres: 0,
  seconds: 0,
  source: 'gps',
  ...over,
});

describe('fastest stretches of a run', () => {
  it('times a steady run exactly', () => {
    // 3 km at 4 m/s: any 1 km takes 250 s.
    const seg = line(31, 100, 4);
    expect(bestEffort([seg], 1000)).toBeCloseTo(250, 0);
    expect(bestEffort([seg], 5000)).toBeUndefined();
  });

  it('finds the fast kilometre inside a slower run, starting part way along a leg', () => {
    // 1 km at 2.5 m/s, then 1 km at 5 m/s, then 1 km at 2.5 m/s, points every 300 m.
    const slow1 = line(4, 300, 2.5); // 0–900 m
    const t1 = slow1[3][0];
    const pts: TrackPoint[] = [...slow1];
    // Carry on from 900 m: 100 m more slow, then fast for 1000 m, then slow.
    const at = (m: number): number => (m <= 1000 ? (m / 2.5) * 1000 : m <= 2000 ? t1 + (100 / 2.5) * 1000 + ((m - 1000) / 5) * 1000 : at(2000) + ((m - 2000) / 2.5) * 1000);
    for (let m = 1000; m <= 3000; m += 250) pts.push([at(m), 51 + m / 111195, 0]);
    expect(bestEffort([pts], 1000)).toBeCloseTo(200, 0);
  });

  it('never runs a stretch across a pause', () => {
    const a = line(6, 100, 4); // 500 m
    const b = line(6, 100, 4, 500, 10 * 60 * 1000); // another 500 m, ten minutes later
    expect(bestEffort([a, b], 1000)).toBeUndefined();
    expect(bestEffort([[...a, ...b.slice(1)]], 1000)).toBeGreaterThan(600);
  });

  it('keeps the fastest 1, 5 and 10 km across runs, and a typed-in 5 km only near 5 km', () => {
    const fast = track({ id: 'a', workoutId: 'wa', segments: [line(61, 100, 4)], metres: 6000, seconds: 1500 });
    const typed = track({ id: 'b', workoutId: 'wb', date: '2026-11-22', metres: 5100, seconds: 1200 });
    const tooFar = track({ id: 'c', workoutId: 'wc', metres: 5600, seconds: 1000 });
    const walk = track({ id: 'd', activity: 'walk', segments: [line(61, 100, 10)] });
    const bests = personalBests([fast, typed, tooFar, walk]);
    expect(bests.map((b) => [b.label, Math.round(b.seconds), b.workoutId])).toEqual([
      ['1 km', 250, 'wa'],
      ['5 km', 1200, 'wb'],
    ]);
  });

  it('gives a pace per kilometre and distance per week', () => {
    expect(trackPace({ metres: 5000, seconds: 1500 })).toBe(300);
    expect(trackPace({ metres: 50, seconds: 30 })).toBeUndefined();
    const weeks = weeklyDistance([
      track({ date: '2026-11-03', metres: 5000 }),
      track({ date: '2026-11-05', metres: 3000, activity: 'walk' }),
      track({ date: '2026-11-18', metres: 4000 }),
      track({ date: '2026-11-18', metres: 9000, activity: 'ride' }),
    ]);
    expect(weeks).toEqual([
      { week: '2026-11-02', metres: 8000 },
      { week: '2026-11-09', metres: 0 },
      { week: '2026-11-16', metres: 4000 },
    ]);
  });
});

describe('workload', () => {
  const s = (over: Partial<SetEntry>): SetEntry => ({ id: 'x', workoutId: 'w', exerciseId: 'e', date: '2026-11-20', setNo: 1, ...over });

  it('adds up weight × reps over every set, counting a pair of bells twice', () => {
    const sets = [s({ weight: 16, reps: 10 }), s({ weight: 16, reps: 8, count: 2 }), s({ weight: 20 })];
    expect(workload(sets, 'weight_reps')).toBe(160 + 256);
    expect(metricValue(sets, 'volume')).toBe(416);
  });

  it('counts body weight for bodyweight work only once it is known', () => {
    const sets = [s({ reps: 10 }), s({ reps: 8, weight: 10 })];
    expect(workload(sets, 'reps')).toBeUndefined();
    expect(workload(sets, 'reps', { bodyWeight: 80 })).toBe(80 * 10 + 90 * 8);
    expect(metricsFor('reps')).toEqual(['reps']);
    expect(metricsFor('reps', { bodyWeight: 80 })).toEqual(['reps', 'bodyload']);
    expect(metricValue(sets, 'bodyload', { bodyWeight: 80 })).toBe(1520);
  });

  it('charts holds and paces too', () => {
    expect(metricsFor('time')).toEqual(['time', 'hold']);
    expect(metricValue([s({ seconds: 30 }), s({ seconds: 45 })], 'hold')).toBe(45);
    expect(metricsFor('distance')).toEqual(['distance']);
    expect(metricsFor('distance', { timed: true })).toEqual(['distance', 'pace']);
    expect(metricValue([s({ metres: 400, seconds: 100 }), s({ metres: 100 })], 'pace')).toBe(250);
  });
});
