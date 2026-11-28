import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Exercise, type SetEntry, type Space } from '../db/schema';
import { lastRoutineSession, scheduleWeek, type WeekCell } from '../db/queries';
import { addDays, niceDate, parseIso, relativeDay, weekRangeLabel, weekStart, weekdayIndex } from '../lib/dates';
import { activityLabel, activityOf, spaceIconOf, type ActivityKey } from '../lib/activities';
import { runsOf, setCount, setsDone } from '../lib/logging';
import { startWorkout } from '../actions';
import { useToday } from '../useToday';
import { ActivityIcon, SpaceIcon } from '../icons';
import { Block, Icon, Page, Sheet } from '../ui';
import { itemSummary } from './RoutineEdit';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** How far the week in view is from this one, in words. */
function weekWord(offset: number): string {
  if (offset === 0) return 'this week';
  if (offset === 1) return 'next week';
  if (offset === -1) return 'last week';
  return offset > 0 ? `in ${offset} weeks` : `${-offset} weeks ago`;
}

/** The detail behind a routine's ⓘ: what you did last time, and the way to change it. */
function InfoSheet({
  cell,
  space,
  activity,
  today,
  onClose,
}: {
  cell: WeekCell;
  space?: Space;
  activity: ActivityKey;
  today: string;
  onClose: () => void;
}) {
  const { routine, date, workout } = cell;
  // Wrapped, so "nothing found" can be told apart from "still loading".
  const found = useLiveQuery(
    async () => ({ recap: await lastRoutineSession(db, routine.id, { excludeWorkoutId: workout?.id }) }),
    [routine.id, workout?.id],
  );
  const last = found?.recap;

  return (
    <Sheet title={routine.name} onClose={onClose}>
      <div className="day-meta" style={{ ['--space' as string]: space?.color }}>
        <span className="day-act">
          {ActivityIcon[activity]}
          {activityLabel(activity)}
        </span>
        {space && (
          <span className="day-act">
            {SpaceIcon[spaceIconOf(space)]}
            {space.name}
          </span>
        )}
        <span className="day-act plain">{niceDate(date, today)}</span>
      </div>

      {routine.description && <p className="prescription">{routine.description}</p>}

      <div className="lasttime">
        <small>Last time</small>
        {last ? (
          <>
            <b>
              {relativeDay(last.workout.date, today)}
              {last.workout.minutes != null ? `, ${last.workout.minutes} min` : ''}
              {last.workout.rpe != null ? `, RPE ${last.workout.rpe}` : ''}
            </b>
            {last.lines.map((l) => (
              <div key={l.itemId} className="line">
                <span>{l.name}</span>
                <span>{l.summary}</span>
              </div>
            ))}
            {!last.lines.length && <span className="sub">Done, with no sets logged.</span>}
          </>
        ) : (
          <span className="sub">{found ? 'Not done before.' : ' '}</span>
        )}
      </div>

      {workout && (
        <Link to={`/workout/${workout.id}`} className="btn block">
          This session in full
        </Link>
      )}
      <Link to={`/routine/${routine.id}`} className="btn ghost block">
        Edit the routine
      </Link>
    </Sheet>
  );
}

/** Things off the schedule: the gym pass, a tracked route, or a session in one of your spaces. */
function AddSheet({ spaces, onClose }: { spaces: Space[]; onClose: () => void }) {
  return (
    <Sheet title="Something else" onClose={onClose}>
      <div className="card flush">
        <Link to="/pass" className="row">
          {Icon.pass}
          <div className="grow">
            <div className="title">Gym pass</div>
            <div className="sub">Show a card or scan a code</div>
          </div>
          {Icon.chevRight}
        </Link>
        <Link to="/track/new" className="row">
          {Icon.route}
          <div className="grow">
            <div className="title">Track a run, walk or ride</div>
            <div className="sub">Records the route with GPS</div>
          </div>
          {Icon.chevRight}
        </Link>
        {spaces.map((s) => (
          <Link key={s.id} to={`/space/${s.id}`} className="row" style={{ ['--space' as string]: s.color }}>
            <span className="space-ico">{SpaceIcon[spaceIconOf(s)]}</span>
            <div className="grow">
              <div className="title">{s.name}</div>
              <div className="sub">A routine, or a quick session</div>
            </div>
            {Icon.chevRight}
          </Link>
        ))}
      </div>
    </Sheet>
  );
}

/** One routine on the chosen day: its exercises as blocks, and one way in. */
function DayRoutine({
  cell,
  space,
  activity,
  exercises,
  sets,
  today,
  onInfo,
}: {
  cell: WeekCell;
  space?: Space;
  activity: ActivityKey;
  exercises: Map<string, Exercise>;
  sets: SetEntry[];
  today: string;
  onInfo: () => void;
}) {
  const nav = useNavigate();
  const { routine, day, date, state, workout } = cell;
  const thisMonday = weekStart(today);
  const pastWeek = date < thisMonday;
  const futureWeek = date >= addDays(thisMonday, 7);
  // Once a session exists it is what was (or is being) done; until then, the routine's plan.
  const items = (workout?.items ?? routine.items).filter((i) => exercises.has(i.exerciseId));
  const bySets = (workout?.logStyle ?? routine.logStyle) === 'sets';
  const checked = new Set(workout?.checked ?? []);

  const start = async () =>
    nav(
      `/workout/${await startWorkout({
        spaceId: routine.spaceId,
        routine,
        activity,
        scheduleDay: day,
        // A past week's session is logged on its own day, so it ticks that week.
        date: pastWeek ? date : undefined,
      })}`,
    );

  return (
    <section className="day-routine" style={{ ['--space' as string]: space?.color }}>
      <div className="dr-head">
        {ActivityIcon[activity]}
        <b>{routine.name}</b>
        {state === 'done' && (
          <span className="block-mark" aria-label="Done">
            {Icon.check}
          </span>
        )}
        <button className="icon-btn" aria-label={`About ${routine.name}`} onClick={onInfo}>
          {Icon.info}
        </button>
      </div>

      <div className="blocks">
        {items.length ? (
          runsOf(items).map((run) => {
            const blocks = run.map((item) => {
              const entries = workout ? sets.filter((s) => s.itemId === item.id) : [];
              const of = setCount(item, entries);
              const done = setsDone(item, entries);
              return (
                <Block
                  key={item.id}
                  title={exercises.get(item.exerciseId)!.name}
                  sub={itemSummary(item) || undefined}
                  done={workout ? (bySets ? done >= of && done > 0 : checked.has(item.id)) : false}
                  progress={workout && bySets ? { done, of } : undefined}
                />
              );
            });
            // A superset or circuit sits together, as it does in the session.
            return run.length > 1 ? (
              <div key={run[0].id} className="block-group">
                {blocks}
              </div>
            ) : (
              blocks[0]
            );
          })
        ) : (
          // No exercises listed: the plan's first sentence says what to do.
          <Block
            title={routine.description?.split(/\n|(?<=\.)\s/).find((l) => l.trim())?.replace(/\.$/, '') ?? activityLabel(activity)}
            done={state === 'done'}
          />
        )}
      </div>

      {state === 'open' && !futureWeek && (
        <button className="btn primary big block" onClick={start}>
          {pastWeek ? `Log it for ${niceDate(date, today)}` : 'Start'}
          {Icon.arrow}
        </button>
      )}
      {state === 'resume' && workout && (
        <Link to={`/workout/${workout.id}`} className="btn primary big block">
          Resume
          {Icon.arrow}
        </Link>
      )}
      {state === 'skipped' && <p className="sub">Skipped</p>}
    </section>
  );
}

/** The front page: a strip of the week's days, and the chosen day's exercises as blocks. */
export default function Home() {
  const today = useToday();
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState<number>();
  const [infoKey, setInfoKey] = useState<string>();
  const [adding, setAdding] = useState(false);
  const monday = addDays(weekStart(today), offset * 7);

  const data = useLiveQuery(async () => {
    const [spaces, routines, workouts, exercises] = await Promise.all([
      db.spaces.orderBy('order').toArray(),
      db.routines.toArray(),
      db.workouts.toArray(),
      db.exercises.toArray(),
    ]);
    // Only the sets of this week's scheduled sessions: enough to tick their blocks.
    const ids = scheduleWeek(routines, workouts, monday)
      .flat()
      .flatMap((c) => (c.workout ? [c.workout.id] : []));
    const sets = ids.length ? await db.sets.where('workoutId').anyOf(ids).toArray() : [];
    return { spaces, routines, workouts, exercises, sets };
  }, [monday]);

  if (!data) return null;
  const { spaces, routines, workouts, sets } = data;
  const exercises = new Map(data.exercises.map((e) => [e.id, e]));
  const spaceById = new Map(spaces.map((s) => [s.id, s]));
  const week = scheduleWeek(routines, workouts, monday);
  const keyOf = (c: WeekCell) => `${c.routine.id}:${c.day}`;
  const activity = (c: WeekCell) => activityOf(undefined, c.routine, { space: spaceById.get(c.routine.spaceId)?.name });
  const todayIndex = offset === 0 ? weekdayIndex(today) : -1;
  // This week opens on today; any other week on its Monday.
  const selected = picked ?? (offset === 0 ? todayIndex : 0);
  const anything = routines.some((r) => r.days?.length);
  const info = week.flat().find((c) => keyOf(c) === infoKey);
  const resume = workouts.filter((w) => w.status === 'in_progress').sort((a, b) => b.startedAt - a.startedAt)[0];
  const scheduledResume = week.flat().some((c) => c.workout?.id === resume?.id);
  const goWeek = (by: number) => {
    setOffset((o) => o + by);
    setPicked(undefined);
  };

  const range = weekRangeLabel(monday);
  const cells = week[selected] ?? [];
  return (
    <Page
      title="Week"
      kicker={offset === 0 ? range : `${range} · ${weekWord(offset)}`}
      large
      actions={
        <>
          <button className="icon-btn narrow" aria-label="Previous week" onClick={() => goWeek(-1)}>
            {Icon.back}
          </button>
          <button className="icon-btn narrow" aria-label="Next week" onClick={() => goWeek(1)}>
            {Icon.chevRight}
          </button>
          <button className="icon-btn boxed" aria-label="Something else: gym pass, route, quick session" onClick={() => setAdding(true)}>
            {Icon.plus}
          </button>
          <Link to="/settings" className="icon-btn boxed" aria-label="Settings">
            {Icon.settings}
          </Link>
        </>
      }
    >
      {resume && !scheduledResume && (
        <Link to={`/workout/${resume.id}`} className="resume-bar" style={{ ['--space' as string]: spaceById.get(resume.spaceId)?.color }}>
          <span className="live" />
          <span className="grow">
            Resume <b>{resume.title}</b>
          </span>
          {Icon.chevRight}
        </Link>
      )}

      {anything ? (
        <>
          <div className="day-strip" role="tablist" aria-label="Days of the week">
            {week.map((dayCells, day) => {
              const finished = dayCells.length > 0 && dayCells.every((c) => c.state === 'done' || c.state === 'skipped');
              return (
                <button
                  key={day}
                  role="tab"
                  aria-selected={day === selected}
                  aria-label={`${DAY_NAMES[day]}${dayCells.length ? `, ${dayCells.length} planned${finished ? ', done' : ''}` : ', rest'}`}
                  className={[day === selected ? 'on' : '', day === todayIndex ? 'today' : ''].filter(Boolean).join(' ')}
                  onClick={() => setPicked(day)}
                >
                  <span className="d">{DAY_NAMES[day][0]}</span>
                  <span className="n">{parseIso(addDays(monday, day)).getDate()}</span>
                  <span className={`m${dayCells.length && !finished ? ' planned' : ''}`}>{finished && Icon.check}</span>
                </button>
              );
            })}
          </div>

          {cells.length ? (
            cells.map((c) => (
              <DayRoutine
                key={keyOf(c)}
                cell={c}
                space={spaceById.get(c.routine.spaceId)}
                activity={activity(c)}
                exercises={exercises}
                sets={sets.filter((s) => s.workoutId === c.workout?.id)}
                today={today}
                onInfo={() => setInfoKey(keyOf(c))}
              />
            ))
          ) : (
            <div className="block rest-day">Rest</div>
          )}
        </>
      ) : (
        <p className="empty-line">
          Nothing repeats yet. Open a routine in{' '}
          <Link className="link" to="/plan">
            Plan
          </Link>{' '}
          and choose the days it repeats on.
        </p>
      )}

      {info && (
        <InfoSheet
          cell={info}
          space={spaceById.get(info.routine.spaceId)}
          activity={activity(info)}
          today={today}
          onClose={() => setInfoKey(undefined)}
        />
      )}
      {adding && <AddSheet spaces={spaces} onClose={() => setAdding(false)} />}
    </Page>
  );
}
