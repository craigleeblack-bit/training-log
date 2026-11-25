import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { AppDB } from './schema';
import { exportBackup, importBackup } from './backup';
import { guessCategory } from '../lib/categories';
import {
  adjustRounds,
  buildPhases,
  DEFAULT_TIMERS,
  describeSpec,
  intervalPhases,
  positionAt,
  skipTo,
  totalSeconds,
  type TimerSpec,
} from '../lib/timer';

let n = 0;
const name = () => `v2-test-${++n}`;

describe('version 2 database', () => {
  it('gives a new database the starter timers', async () => {
    const db = new AppDB(name());
    expect((await db.timers.orderBy('order').toArray()).map((t) => t.id)).toEqual(DEFAULT_TIMERS.map((t) => t.id));
  });

  it('upgrades a version 1 database: sections for exercises, starter timers, data kept', async () => {
    const dbName = name();
    const old = new Dexie(dbName);
    old.version(1).stores({
      spaces: 'id, order',
      exercises: 'id, name',
      routines: 'id, spaceId, order',
      programmes: 'id, spaceId',
      workouts: 'id, date, spaceId, routineId, programmeId, status',
      sets: 'id, workoutId, exerciseId, date',
      notes: 'id, kind, order',
      settings: 'key',
    });
    await old.table('exercises').bulkAdd([
      { id: 'e1', name: 'Leg press', measure: 'weight_reps', links: [] },
      { id: 'e2', name: 'Goblet squat', measure: 'weight_reps', equipment: '16–24 kg KB', links: [] },
    ]);
    old.close();

    const db = new AppDB(dbName);
    expect((await db.exercises.get('e1'))?.category).toBe('machine');
    expect((await db.exercises.get('e2'))?.category).toBe('kettlebell');
    expect(await db.timers.count()).toBe(DEFAULT_TIMERS.length);
  });
});

describe('backup, version 2', () => {
  it('round-trips timers, passes and tracks', async () => {
    const a = new AppDB(name());
    await a.passes.add({ id: 'p1', name: 'Gym', kind: 'code', format: 'qr_code', text: 'ABC', order: 0 });
    await a.tracks.add({
      id: 't1',
      workoutId: 'w1',
      date: '2026-11-24',
      activity: 'run',
      startedAt: 1,
      segments: [[[1, 51.5, -0.1]]],
      metres: 0,
      seconds: 0,
      source: 'gps',
    });
    const file = JSON.parse(JSON.stringify(await exportBackup(a)));
    const b = new AppDB(name());
    await importBackup(b, file, 'replace');
    expect(await b.passes.get('p1')).toMatchObject({ text: 'ABC' });
    expect((await b.tracks.get('t1'))?.segments[0][0]).toEqual([1, 51.5, -0.1]);
  });

  it('restoring a version 1 file keeps timers and passes, and sorts exercises into sections', async () => {
    const db = new AppDB(name());
    await db.passes.add({ id: 'p1', name: 'Gym', kind: 'code', text: 'ABC', order: 0 });
    await db.tracks.add({
      id: 't1',
      workoutId: 'gone',
      date: '2026-11-24',
      activity: 'run',
      startedAt: 1,
      segments: [],
      metres: 0,
      seconds: 0,
      source: 'gps',
    });
    const v1 = {
      app: 'training-log',
      version: 1,
      exportedAt: '2026-11-24T10:00:00.000Z',
      data: { exercises: [{ id: 'e1', name: 'Pull-ups', measure: 'reps', links: [] }], workouts: [] },
    };
    await importBackup(db, v1, 'replace');
    expect(await db.passes.count()).toBe(1);
    expect(await db.timers.count()).toBe(DEFAULT_TIMERS.length);
    expect(await db.tracks.count()).toBe(0);
    expect((await db.exercises.get('e1'))?.category).toBe('bodyweight');
  });
});

describe('exercise sections', () => {
  it('guesses from the name and the equipment', () => {
    expect(guessCategory('Lat pulldown')).toBe('machine');
    expect(guessCategory('Face pull')).toBe('cable');
    expect(guessCategory('Double front squat', '2 × 16 kg')).toBe('kettlebell');
    expect(guessCategory('Shield casts', 'One 6 kg club')).toBe('club');
    expect(guessCategory('Open books')).toBe('mobility');
    expect(guessCategory('Romanian deadlift')).toBe('free_weights');
    expect(guessCategory('Dead bugs')).toBe('bodyweight');
    expect(guessCategory('Something new')).toBe('other');
  });
});

describe('timer recipes', () => {
  const tabata: TimerSpec = { mode: 'intervals', work: 20, rest: 10, rounds: 8 };

  it('builds Tabata as 8 work and 7 rest, with a get-ready first when asked', () => {
    const phases = buildPhases(tabata, 10);
    expect(phases[0]).toMatchObject({ kind: 'prep', seconds: 10 });
    expect(phases.filter((p) => p.kind === 'work')).toHaveLength(8);
    expect(phases.filter((p) => p.kind === 'rest')).toHaveLength(7);
    expect(totalSeconds(phases)).toBe(10 + 8 * 20 + 7 * 10);
    expect(describeSpec(tabata)).toBe('8 × (0:20 work, 0:10 rest)');
  });

  it('repeats rounds in sets with a longer rest between sets', () => {
    const phases = intervalPhases({ work: 30, rest: 15, rounds: 3, sets: 2, setRest: 60 });
    expect(phases.map((p) => p.seconds)).toEqual([30, 15, 30, 15, 30, 60, 30, 15, 30, 15, 30]);
    expect(phases[5]).toMatchObject({ label: 'Set rest', set: 1, sets: 2 });
    expect(phases[6]).toMatchObject({ kind: 'work', round: 1, set: 2 });
  });

  it('keeps the last rest only when asked', () => {
    expect(intervalPhases({ work: 30, rest: 15, rounds: 2 }).at(-1)?.kind).toBe('work');
    expect(intervalPhases({ work: 30, rest: 15, rounds: 2, endWithRest: true }).at(-1)?.kind).toBe('rest');
  });

  it('skips forward to the next phase and back to the start of this one', () => {
    const phases = buildPhases(tabata);
    expect(skipTo(phases, 5, 1)).toBe(20);
    expect(skipTo(phases, 25, -1)).toBe(20); // 5 s into the rest: restart it
    expect(skipTo(phases, 21, -1)).toBe(0); // just started: go back one
  });

  it('adds a round mid-timer without moving the clock', () => {
    const phases = buildPhases(tabata);
    const out = adjustRounds(tabata, phases, 35, 1); // 5 s into round 2's work
    expect(out?.phases.filter((p) => p.kind === 'work')).toHaveLength(9);
    const pos = positionAt(out!.phases, out!.elapsed);
    expect(pos.phase).toMatchObject({ kind: 'work', round: 2 });
    expect(pos.remaining).toBe(15);
  });

  it('adds a round from the final round, which then gains its rest', () => {
    const spec: TimerSpec = { mode: 'intervals', work: 20, rest: 10, rounds: 2 };
    const out = adjustRounds(spec, buildPhases(spec), 35, 1); // in round 2, the last
    expect(out?.phases.map((p) => p.kind)).toEqual(['work', 'rest', 'work', 'rest', 'work']);
    expect(positionAt(out!.phases, out!.elapsed).remaining).toBe(15);
  });

  it('will not remove the round in progress, or go below one', () => {
    const spec: TimerSpec = { mode: 'emom', every: 60, rounds: 3 };
    const phases = buildPhases(spec);
    expect(adjustRounds(spec, phases, 130, -1)).toBeUndefined(); // already in minute 3
    expect(adjustRounds(spec, phases, 10, -1)?.phases).toHaveLength(2);
    expect(adjustRounds({ mode: 'emom', every: 60, rounds: 1 }, buildPhases({ mode: 'emom', every: 60, rounds: 1 }), 0, -1)).toBeUndefined();
    expect(adjustRounds({ mode: 'countdown', seconds: 60 }, [], 0, 1)).toBeUndefined();
  });
});
