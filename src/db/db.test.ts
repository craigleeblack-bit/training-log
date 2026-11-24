import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { AppDB, type Programme, type Workout } from './schema';
import { exportBackup, importBackup, validateBackup } from './backup';
import {
  lastTime,
  loadNumber,
  nextSlot,
  programmeProgress,
  repsNumber,
  slotDate,
  slotForDate,
  summariseSets,
} from './queries';
import { emomPhases, intervalPhases, positionAt, totalSeconds } from '../lib/timer';
import { normaliseClaudeUrl } from '../lib/claude';
import { addDays, daysBetween } from '../lib/dates';

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
    expect(await b.spaces.toArray()).toEqual([{ id: 's1', name: 'Home', color: '#000', order: 0 }]);
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
