import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { scheduleWeek } from '../db/queries';
import { addDays, isoDate, weekStart, weekdayIndex } from '../lib/dates';
import { activityOf, knownActivity } from '../lib/activities';
import { startWorkout } from '../actions';
import { Icon } from '../ui';
import { ExerciseFlow, RoutineList, useBack } from './SessionFlow';

/** For a screen whose session or routine has gone (deleted, or not synced yet). */
function Gone({ text }: { text: string }) {
  const back = useBack('/');
  return (
    <div className="session">
      <header className="s-head">
        <button className="icon-btn" aria-label="Back" onClick={back}>
          {Icon.back}
        </button>
      </header>
      <div className="s-body top">
        <div className="empty">{text}</div>
      </div>
    </div>
  );
}

/** Everything a session's screens need, kept live. */
function useSession(id: string) {
  return useLiveQuery(async () => {
    const workout = await db.workouts.get(id);
    if (!workout) return { workout: null };
    const [space, sets, exercises, routine] = await Promise.all([
      db.spaces.get(workout.spaceId),
      db.sets.where('workoutId').equals(id).toArray(),
      db.exercises.toArray(),
      workout.routineId ? db.routines.get(workout.routineId) : undefined,
    ]);
    return { workout, space, sets, exercises, routine };
  }, [id]);
}

/** A session, in progress or finished: its exercises as a list. `/workout/:id` */
export default function WorkoutScreen() {
  const { id = '' } = useParams();
  const data = useSession(id);
  if (!data) return null;
  if (!data.workout) return <Gone text="This session no longer exists." />;
  const { workout, space, sets = [], exercises = [], routine } = data;
  const activity = knownActivity(workout.activity) ?? activityOf(undefined, routine, { space: space?.name });
  return (
    <RoutineList
      workout={workout}
      routine={routine}
      title={workout.title}
      space={space}
      activity={activity}
      exercises={exercises}
      sets={sets}
    />
  );
}

/** One exercise of a session, with its inputs. `/workout/:id/exercise/:itemId` */
export function ExerciseScreen() {
  const { id = '', itemId = '' } = useParams();
  const data = useSession(id);
  if (!data) return null;
  if (!data.workout) return <Gone text="This session no longer exists." />;
  return <ExerciseFlow key={itemId} workout={data.workout} startId={itemId} space={data.space} sets={data.sets ?? []} exercises={data.exercises ?? []} />;
}

/**
 * A routine on one day of the week, from its note on the Week page. `/day/:date/:routineId`
 * Shows that day's session if there is one; otherwise the routine, and the session starts on the
 * first exercise tapped, so just looking never leaves an empty session behind.
 */
export function DayScreen() {
  const { date = '', routineId = '' } = useParams();
  const data = useLiveQuery(async () => {
    const routine = await db.routines.get(routineId);
    if (!routine) return { routine: null };
    const monday = weekStart(date);
    const [space, exercises, workouts] = await Promise.all([
      db.spaces.get(routine.spaceId),
      db.exercises.toArray(),
      db.workouts.where('date').between(monday, addDays(monday, 6), true, true).toArray(),
    ]);
    const cell = scheduleWeek([routine], workouts, monday)[weekdayIndex(date)]?.find((c) => c.routine.id === routineId);
    const workout = cell?.workout;
    const sets = workout ? await db.sets.where('workoutId').equals(workout.id).toArray() : [];
    return { routine, space, exercises, workout, sets };
  }, [date, routineId]);

  if (!data) return null;
  if (!data.routine) return <Gone text="This routine no longer exists." />;
  const { routine, space, exercises = [], workout, sets = [] } = data;
  const today = isoDate();
  const thisMonday = weekStart(today);
  const activity = activityOf(undefined, routine, { space: space?.name });
  return (
    <RoutineList
      workout={workout}
      routine={routine}
      title={routine.name}
      space={space}
      activity={activity}
      exercises={exercises}
      sets={sets}
      locked={!workout && date > today}
      onStart={() =>
        startWorkout({
          spaceId: routine.spaceId,
          routine,
          activity,
          scheduleDay: weekdayIndex(date),
          // A past week's session is logged on its own day, so it ticks that week.
          date: date < thisMonday ? date : undefined,
        })
      }
    />
  );
}
