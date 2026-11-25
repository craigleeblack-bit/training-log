import { TABLES, type AppDB, type Exercise, type TableName } from './schema';
import { guessCategory } from '../lib/categories';

export const BACKUP_APP = 'training-log';
/** 2 added timers, passes and tracks. Older files simply lack them. */
export const BACKUP_VERSION = 2;

export interface Backup {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  data: Record<TableName, unknown[]>;
}

export async function exportBackup(db: AppDB): Promise<Backup> {
  const data = {} as Record<TableName, unknown[]>;
  for (const t of TABLES) data[t] = await db.table(t).toArray();
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data };
}

export function validateBackup(raw: unknown): Backup {
  if (!raw || typeof raw !== 'object') throw new Error('That file is not a backup.');
  const b = raw as Partial<Backup>;
  if (b.app !== BACKUP_APP) throw new Error('That file is not a Training Log backup.');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) {
    throw new Error('That backup was made by a newer version of the app.');
  }
  if (!b.data || typeof b.data !== 'object') throw new Error('The backup has no data in it.');
  for (const t of TABLES) {
    const rows = (b.data as Record<string, unknown>)[t];
    if (rows !== undefined && !Array.isArray(rows)) throw new Error(`The backup's "${t}" section is damaged.`);
  }
  return b as Backup;
}

export type ImportMode = 'replace' | 'merge';

/**
 * replace: wipe everything and load the backup.
 * merge: add or overwrite rows by id, leaving anything not in the backup alone.
 *
 * A file from before a table existed says nothing about it, so replace leaves that table as it is:
 * restoring an old backup does not throw away your timers or passes.
 */
export async function importBackup(db: AppDB, raw: unknown, mode: ImportMode = 'replace'): Promise<number> {
  const backup = validateBackup(raw);
  let count = 0;
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      const rows = backup.data[t] ?? [];
      // Routes belong to sessions, so they never outlive a replaced set of sessions.
      if (mode === 'replace' && (backup.data[t] !== undefined || t === 'tracks')) await db.table(t).clear();
      if (rows.length) await db.table(t).bulkPut(rows);
      count += rows.length;
    }
    // Older files have no sections for the exercise list.
    await db.exercises
      .filter((e) => !e.category)
      .modify((e: Exercise) => {
        e.category = guessCategory(e.name, e.equipment);
      });
  });
  return count;
}

export function backupFilename(date: string): string {
  return `training-log-backup-${date}.json`;
}
