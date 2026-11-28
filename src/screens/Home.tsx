import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Space } from '../db/schema';
import { lastRoutineSession, scheduleWeek, type WeekCell } from '../db/queries';
import { addDays, niceDate, parseIso, relativeDay, weekRangeLabel, weekStart, weekdayIndex } from '../lib/dates';
import { activityLabel, activityOf, spaceIconOf, type ActivityKey } from '../lib/activities';
import { startWorkout } from '../actions';
import { useToday } from '../useToday';
import { ActivityIcon, SpaceIcon } from '../icons';
import { Icon, Page, Sheet } from '../ui';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const STATE_WORD: Record<WeekCell['state'], string> = {
  open: '',
  done: 'Done',
  skipped: 'Skipped',
  resume: 'In progress',
};

/** How far the week in view is from this one, in words. */
function weekWord(offset: number): string {
  if (offset === 0) return 'this week';
  if (offset === 1) return 'next week';
  if (offset === -1) return 'last week';
  return offset > 0 ? `in ${offset} weeks` : `${-offset} weeks ago`;
}

/** One routine on one day: what you did last time, and the way into the session. */
function DaySheet({
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
  const nav = useNavigate();
  const { routine, day, date, state, workout } = cell;
  // Wrapped, so "nothing found" can be told apart from "still loading".
  const found = useLiveQuery(
    async () => ({ recap: await lastRoutineSession(db, routine.id, { excludeWorkoutId: workout?.id }) }),
    [routine.id, workout?.id],
  );
  const last = found?.recap;
  const thisMonday = weekStart(today);
  const pastWeek = date < thisMonday;
  const futureWeek = date >= addDays(thisMonday, 7);

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

      {state === 'open' &&
        (futureWeek ? (
          <p className="sub">Coming up {niceDate(date, today)}.</p>
        ) : (
          <button className="btn primary big block" onClick={start}>
            {pastWeek ? `Log it for ${niceDate(date, today)}` : 'Start'}
            {Icon.arrow}
          </button>
        ))}
      {state === 'resume' && workout && (
        <Link to={`/workout/${workout.id}`} className="btn primary big block">
          Resume
          {Icon.arrow}
        </Link>
      )}
      {(state === 'done' || state === 'skipped') && workout && (
        <Link to={`/workout/${workout.id}`} className="btn block">
          {state === 'done' ? 'Done' : 'Skipped'} {relativeDay(workout.date, today).toLowerCase()}: view
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

/** The front page: Monday to Sunday of the real week, one icon per routine that repeats on each day. */
export default function Home() {
  const today = useToday();
  const [offset, setOffset] = useState(0);
  const [openKey, setOpenKey] = useState<string>();
  const [adding, setAdding] = useState(false);

  const data = useLiveQuery(async () => {
    const [spaces, routines, workouts] = await Promise.all([
      db.spaces.orderBy('order').toArray(),
      db.routines.toArray(),
      db.workouts.toArray(),
    ]);
    return { spaces, routines, workouts };
  }, []);

  if (!data) return null;
  const { spaces, routines, workouts } = data;
  const spaceById = new Map(spaces.map((s) => [s.id, s]));
  const monday = addDays(weekStart(today), offset * 7);
  const week = scheduleWeek(routines, workouts, monday);
  const keyOf = (c: WeekCell) => `${c.routine.id}:${c.day}`;
  const activity = (c: WeekCell) => activityOf(undefined, c.routine, { space: spaceById.get(c.routine.spaceId)?.name });
  const todayColumn = offset === 0 ? weekdayIndex(today) : -1;
  const anything = routines.some((r) => r.days?.length);
  const opened = week.flat().find((c) => keyOf(c) === openKey);
  const resume = workouts.filter((w) => w.status === 'in_progress').sort((a, b) => b.startedAt - a.startedAt)[0];

  const range = weekRangeLabel(monday);
  return (
    <Page
      title="Week"
      kicker={offset === 0 ? range : `${range} · ${weekWord(offset)}`}
      large
      actions={
        <>
          <button className="icon-btn narrow" aria-label="Previous week" onClick={() => setOffset((o) => o - 1)}>
            {Icon.back}
          </button>
          <button className="icon-btn narrow" aria-label="Next week" onClick={() => setOffset((o) => o + 1)}>
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
      {resume && (
        <Link to={`/workout/${resume.id}`} className="resume-bar" style={{ ['--space' as string]: spaceById.get(resume.spaceId)?.color }}>
          <span className="live" />
          <span className="grow">
            Resume <b>{resume.title}</b>
          </span>
          {Icon.chevRight}
        </Link>
      )}

      {anything ? (
        <div className="card flush week-list">
          {week.map((cells, day) => (
            <div key={day} className={`wk-row${day === todayColumn ? ' today' : ''}`}>
              <span className="wk-when">
                <b>{DAY_NAMES[day]}</b>
                <small>{parseIso(addDays(monday, day)).getDate()}</small>
              </span>
              <div className="wk-items">
                {cells.length ? (
                  cells.map((c) => {
                    const a = activity(c);
                    const space = spaceById.get(c.routine.spaceId);
                    return (
                      <button
                        key={keyOf(c)}
                        className={`wk-item ${c.state}`}
                        style={{ ['--space' as string]: space?.color }}
                        aria-label={`${DAY_NAMES[day]}: ${c.routine.name}, ${activityLabel(a)}${c.state === 'open' ? '' : `, ${STATE_WORD[c.state].toLowerCase()}`}`}
                        onClick={() => setOpenKey(keyOf(c))}
                      >
                        <span className="wk-ico">{ActivityIcon[a]}</span>
                        <span className="wk-text">
                          <b>{c.routine.name}</b>
                          <small>{STATE_WORD[c.state] || space?.name}</small>
                        </span>
                        {c.state === 'done' && <span className="wk-mark done">{Icon.check}</span>}
                        {c.state === 'skipped' && <span className="wk-mark skipped">{Icon.dash}</span>}
                        {c.state === 'resume' && <span className="live" />}
                      </button>
                    );
                  })
                ) : (
                  <span className="wk-rest">Rest</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-line">
          Nothing repeats yet. Open a routine in{' '}
          <Link className="link" to="/plan">
            Plan
          </Link>{' '}
          and choose the days it repeats on.
        </p>
      )}

      {opened && (
        <DaySheet
          cell={opened}
          space={spaceById.get(opened.routine.spaceId)}
          activity={activity(opened)}
          today={today}
          onClose={() => setOpenKey(undefined)}
        />
      )}
      {adding && <AddSheet spaces={spaces} onClose={() => setAdding(false)} />}
    </Page>
  );
}
