import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, uid, type Programme, type ProgrammeSlot, type Routine, type Workout } from './db/schema';
import { slotKey } from './db/queries';
import { isoDate } from './lib/dates';
import { activityOf, type ActivityKey } from './lib/activities';
import { CLAUDE_URL_KEY, copyText, normaliseClaudeUrl } from './lib/claude';
import { useFeedback } from './ui';

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await db.settings.get(key))?.value as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

interface StartArgs {
  spaceId: string;
  routine?: Routine;
  programme?: Programme;
  slot?: ProgrammeSlot;
  /** What to call a session that comes from neither a routine nor a programme. */
  title?: string;
  /** The kind of exercise, when the caller has already worked it out. */
  activity?: ActivityKey;
}

/** Start a workout, or resume the unfinished one for the same routine or programme slot. */
export async function startWorkout({ spaceId, routine, programme, slot, title, activity }: StartArgs): Promise<string> {
  const key = slot ? slotKey(slot) : undefined;
  const open = await db.workouts.where('status').equals('in_progress').toArray();
  const existing = open.find((w) =>
    programme && key
      ? w.programmeId === programme.id && w.slotKey === key
      : !w.programmeId && !!routine && w.routineId === routine.id,
  );
  if (existing) return existing.id;

  const target = [slot?.targetMinutes && `${slot.targetMinutes} min`, slot?.targetRpe && `RPE ${slot.targetRpe}`]
    .filter(Boolean)
    .join(' · ');

  const workout: Workout = {
    id: uid(),
    date: isoDate(),
    startedAt: Date.now(),
    spaceId,
    routineId: routine?.id,
    programmeId: programme?.id,
    slotKey: key,
    title: slot?.title ?? routine?.name ?? title ?? 'Quick session',
    activity: activity ?? (slot || routine ? activityOf(slot ?? { title: '' }, routine, { programme: programme?.name }) : undefined),
    prescription:
      [slot?.prescription ?? routine?.description, target && `Target: ${target}`].filter(Boolean).join('\n\n') ||
      undefined,
    status: 'in_progress',
    logStyle: routine?.logStyle ?? 'session',
    items: routine ? routine.items.map((i) => ({ ...i })) : [],
    checked: [],
  };
  await db.workouts.add(workout);
  return workout.id;
}

export async function deleteWorkout(id: string): Promise<void> {
  await db.transaction('rw', db.workouts, db.sets, async () => {
    await db.sets.where('workoutId').equals(id).delete();
    await db.workouts.delete(id);
  });
}

export async function deleteSpace(id: string): Promise<void> {
  await db.transaction('rw', [db.spaces, db.routines, db.programmes, db.workouts, db.sets], async () => {
    const workouts = await db.workouts.where('spaceId').equals(id).primaryKeys();
    await db.sets.where('workoutId').anyOf(workouts).delete();
    await db.workouts.bulkDelete(workouts);
    await db.routines.where('spaceId').equals(id).delete();
    await db.programmes.where('spaceId').equals(id).delete();
    await db.spaces.delete(id);
  });
}

/**
 * Copies a context block to the clipboard and opens the user's Claude Project.
 * `build` runs inside the tap handler so the copy and the new tab count as user-initiated.
 */
export function useAskClaude() {
  const { toast } = useFeedback();
  const nav = useNavigate();
  return useCallback(
    async (build: () => Promise<string> | string) => {
      const [text, saved] = await Promise.all([build(), getSetting<string>(CLAUDE_URL_KEY)]);
      const url = saved ? normaliseClaudeUrl(saved) : undefined;
      const copied = await copyText(text);
      if (!url) {
        toast(copied ? 'Copied. Add your Claude Project link in Settings.' : 'Add your Claude Project link in Settings.');
        nav('/settings');
        return;
      }
      toast(copied ? 'Context copied — paste it into Claude.' : 'Opening Claude (could not copy the context).');
      window.open(url, '_blank', 'noopener');
    },
    [toast, nav],
  );
}
