import type { AppDB, Workout } from '../db/schema';
import { hasValue } from '../db/queries';
import { parseIso } from './dates';

/**
 * Close sessions left open from an earlier day. One with sets logged becomes done (and so ticks
 * its card), with its time estimated from when the sets were logged; one with nothing logged is
 * removed. Sessions begun today are left alone even when they are for an earlier date, so logging
 * a past week's session is never cut short.
 *
 * Safe to run any number of times, on any number of devices: it only ever moves a session from
 * in progress to done, or removes one that has nothing in it.
 */
export async function closeStaleWorkouts(db: AppDB, today: string): Promise<{ closed: string[]; removed: string[] }> {
  const startOfToday = parseIso(today).getTime();
  return db.transaction('rw', db.workouts, db.sets, async () => {
    const open = await db.workouts.where('status').equals('in_progress').toArray();
    const stale = open.filter((w) => w.date < today && w.startedAt < startOfToday);
    const closed: string[] = [];
    const removed: string[] = [];
    for (const w of stale) {
      const sets = (await db.sets.where('workoutId').equals(w.id).toArray()).filter(hasValue);
      const ticked = (w.checked ?? []).length > 0;
      if (!sets.length && !ticked) {
        await db.sets.where('workoutId').equals(w.id).delete();
        await db.workouts.delete(w.id);
        removed.push(w.id);
        continue;
      }
      const changes: Partial<Workout> = { status: 'done', autoClosed: true };
      if (w.minutes == null) {
        const last = Math.max(0, ...sets.map((s) => s.at ?? 0));
        const minutes = Math.round((last - w.startedAt) / 60000);
        // Only a believable length: a set edited days later says nothing about the session.
        if (last && minutes >= 1 && minutes <= 240) changes.minutes = minutes;
      }
      await db.workouts.update(w.id, changes);
      closed.push(w.id);
    }
    return { closed, removed };
  });
}
