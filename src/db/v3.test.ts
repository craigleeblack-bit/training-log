import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { AppDB } from './schema';
import { exportBackup, importBackup } from './backup';

let n = 0;
const name = () => `v3-test-${++n}`;

/** A database as version 2 of the app left it. */
async function versionTwo(dbName: string) {
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
  old.version(2).stores({
    exercises: 'id, name, category',
    timers: 'id, order',
    passes: 'id, order',
    tracks: 'id, workoutId, date',
  });
  return old;
}

describe('version 3 database', () => {
  it('upgrades a version 2 database: icons for spaces, activities for routines, data kept', async () => {
    const dbName = name();
    const old = await versionTwo(dbName);
    await old.table('spaces').bulkAdd([
      { id: 'home', name: 'Home', color: '#000', order: 0 },
      { id: 'swim', name: 'Swim', color: '#111', order: 1 },
      { id: 'mob', name: 'Mobility', color: '#222', order: 2 },
    ]);
    await old.table('routines').bulkAdd([
      { id: 'r1', spaceId: 'home', name: 'Kettlebell menu', logStyle: 'sets', items: [], order: 0 },
      { id: 'r2', spaceId: 'swim', name: 'Session', logStyle: 'session', items: [], order: 0 },
      { id: 'r3', spaceId: 'mob', name: 'Evening routine', logStyle: 'session', items: [], order: 0 },
      { id: 'r4', spaceId: 'home', name: 'Already set', activity: 'dance', logStyle: 'sets', items: [], order: 1 },
    ]);
    await old.table('programmes').add({ id: 'p1', spaceId: 'home', name: 'Recon', startDate: '2026-11-23', weeks: 4, slots: [], active: true });
    await old.table('workouts').add({ id: 'w1', date: '2026-11-23', startedAt: 1, spaceId: 'home', title: 'A', status: 'done', logStyle: 'sets', items: [] });
    old.close();

    const db = new AppDB(dbName);
    expect((await db.spaces.orderBy('order').toArray()).map((s) => s.icon)).toEqual(['home', 'pool', 'studio']);
    expect((await db.routines.get('r1'))?.activity).toBe('kettlebell');
    expect((await db.routines.get('r2'))?.activity).toBe('swim');
    expect((await db.routines.get('r3'))?.activity).toBe('mobility');
    expect((await db.routines.get('r4'))?.activity).toBe('dance');
    // A programme from before the choice existed stays on calendar dates.
    expect((await db.programmes.get('p1'))?.dated).toBeUndefined();
    expect((await db.workouts.get('w1'))?.title).toBe('A');
  });

  it('fills in icons and activities when an older backup is restored', async () => {
    const a = new AppDB(name());
    await a.spaces.add({ id: 's1', name: 'Gym', color: '#000', order: 0 });
    await a.routines.add({ id: 'r1', spaceId: 's1', name: 'Upper A', logStyle: 'sets', items: [], order: 0 });
    const file = JSON.parse(JSON.stringify(await exportBackup(a)));
    const b = new AppDB(name());
    await importBackup(b, file, 'replace');
    expect((await b.spaces.get('s1'))?.icon).toBe('gym');
    expect((await b.routines.get('r1'))?.activity).toBe('strength');
  });
});
