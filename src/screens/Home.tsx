import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Space } from '../db/schema';
import { isDated, lastRoutineSession, slotDate, weekdayIndex, weekGrid, type WeekCell } from '../db/queries';
import { addDays, isoDate, niceDate, parseIso, relativeDay } from '../lib/dates';
import { activityLabel, activityOf, spaceIconOf, type ActivityKey } from '../lib/activities';
import { startWorkout } from '../actions';
import { ActivityIcon, SpaceIcon } from '../icons';
import { Icon, Page, Sheet } from '../ui';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const cellKey = (c: WeekCell) => `${c.programme.id}:${c.slot.week}-${c.slot.day}`;

/** How far the week in view is from the current one, in words. */
function weekWord(offset: number): string {
  if (offset === 0) return 'This week';
  if (offset === 1) return 'Next week';
  if (offset === -1) return 'Last week';
  return offset > 0 ? `In ${offset} weeks` : `${-offset} weeks back`;
}

/** One programme day, opened from the week: what it asks for and what you did last time. */
function DaySheet({
  cell,
  space,
  activity,
  onClose,
}: {
  cell: WeekCell;
  space?: Space;
  activity: ActivityKey;
  onClose: () => void;
}) {
  const nav = useNavigate();
  const { programme: p, slot, routine, state, workout } = cell;
  // Wrapped, so "nothing found" can be told apart from "still loading".
  const found = useLiveQuery(
    async () => ({
      recap: await lastRoutineSession(
        db,
        { routineId: slot.routineId, programmeId: p.id, title: slot.title },
        { excludeWorkoutId: workout?.id },
      ),
    }),
    [slot.routineId, p.id, slot.title, workout?.id],
  );
  const previous = found?.recap;
  const today = isoDate();
  const targets = [slot.targetMinutes && `${slot.targetMinutes} min`, slot.targetRpe && `RPE ${slot.targetRpe}`].filter(Boolean).join(', ');

  const start = async () =>
    nav(`/workout/${await startWorkout({ spaceId: p.spaceId, routine, programme: p, slot, activity })}`);

  return (
    <Sheet title={slot.title} onClose={onClose}>
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
      </div>
      <p className="sub">
        {[p.name, `Week ${slot.week} of ${p.weeks}`, isDated(p) ? niceDate(slotDate(p, slot), today) : undefined, targets]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {slot.prescription && <p className="prescription">{slot.prescription}</p>}

      <div className="lasttime">
        <small>Last time</small>
        {previous ? (
          <>
            <b>
              {relativeDay(previous.workout.date, today)}
              {previous.workout.minutes != null ? `, ${previous.workout.minutes} min` : ''}
              {previous.workout.rpe != null ? `, RPE ${previous.workout.rpe}` : ''}
            </b>
            {previous.lines.map((l) => (
              <div key={l.exerciseId} className="line">
                <span>{l.name}</span>
                <span>{l.summary}</span>
              </div>
            ))}
            {!previous.lines.length && <span className="sub">No sets were logged.</span>}
          </>
        ) : (
          <span className="sub">{found ? 'Not done before.' : ' '}</span>
        )}
      </div>

      {state === 'open' && (
        <button className="btn primary big block" onClick={start}>
          Start session
          {Icon.arrow}
        </button>
      )}
      {state === 'resume' && workout && (
        <Link to={`/workout/${workout.id}`} className="btn primary big block">
          Resume session
          {Icon.arrow}
        </Link>
      )}
      {(state === 'done' || state === 'skipped') && workout && (
        <>
          <p className="sub">
            {state === 'done' ? 'Done' : 'Skipped'} {relativeDay(workout.date, today).toLowerCase()}.
          </p>
          <Link to={`/workout/${workout.id}`} className="btn block">
            View session
          </Link>
        </>
      )}
      <Link to={`/programme/${p.id}`} className="btn ghost block">
        Open the programme
      </Link>
    </Sheet>
  );
}

/** Start something that is not on the plan: a route, or a session in one of your spaces. */
function AddSheet({ spaces, onClose }: { spaces: Space[]; onClose: () => void }) {
  return (
    <Sheet title="Something else" onClose={onClose}>
      <div className="card flush">
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

/** The front page: Monday to Sunday of the programme week, one icon per session. */
export default function Home() {
  const today = isoDate();
  const [offset, setOffset] = useState(0);
  const [openKey, setOpenKey] = useState<string>();
  const [adding, setAdding] = useState(false);

  const data = useLiveQuery(async () => {
    const [spaces, routines, programmes, workouts] = await Promise.all([
      db.spaces.orderBy('order').toArray(),
      db.routines.toArray(),
      db.programmes.toArray(),
      db.workouts.toArray(),
    ]);
    return { spaces, routines, programmes, workouts };
  }, []);

  if (!data) return null;
  const { spaces, routines, programmes, workouts } = data;
  const spaceById = new Map(spaces.map((s) => [s.id, s]));
  const grid = weekGrid(programmes, workouts, routines, offset);
  const single = grid.shown.length === 1 ? grid.shown[0] : undefined;
  const activity = (c: WeekCell) =>
    activityOf(c.slot, c.routine, { programme: c.programme.name, space: spaceById.get(c.programme.spaceId)?.name });

  // Looking back or ahead stops at the edges of the programmes on show.
  const canBack = grid.shown.some((s) => s.week > 1);
  const canAhead = grid.shown.some((s) => s.week < s.programme.weeks);
  const todayColumn = offset === 0 ? weekdayIndex(today) : -1;
  // Dates go under the day names when one dated programme is on show.
  const dateOf = (column: number): string | undefined => {
    if (!single || !isDated(single.programme)) return undefined;
    // A programme week can start on any weekday, so Monday may belong to the next calendar week.
    const start = slotDate(single.programme, { week: single.week, day: 0 });
    return addDays(start, (column - weekdayIndex(start) + 7) % 7);
  };

  const resume = workouts.filter((w) => w.status === 'in_progress').sort((a, b) => b.startedAt - a.startedAt)[0];
  const opened = grid.days.flat().find((c) => cellKey(c) === openKey);
  const doneCount = grid.days.flat().filter((c) => !c.slot.rest && c.state === 'done').length;
  const totalCount = grid.days.flat().filter((c) => !c.slot.rest).length;

  const kicker = single
    ? single.complete && offset === 0
      ? 'Programme complete'
      : `Week ${single.week} of ${single.programme.weeks}`
    : grid.shown.length > 1
      ? `${grid.shown.length} programmes`
      : undefined;

  return (
    <Page
      title="Week"
      kicker={kicker}
      large
      actions={
        <>
          <button className="icon-btn boxed" aria-label="Start something else" onClick={() => setAdding(true)}>
            {Icon.plus}
          </button>
          <Link to="/pass" className="icon-btn boxed" aria-label="Gym passes and scanner">
            {Icon.pass}
          </Link>
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

      {grid.shown.length > 0 ? (
        <>
          <div className="week-nav">
            <button className="icon-btn" aria-label="Previous week" disabled={!canBack} onClick={() => setOffset((o) => o - 1)}>
              {Icon.back}
            </button>
            <button className="label" disabled={offset === 0} onClick={() => setOffset(0)}>
              <b>{weekWord(offset)}</b>
              <small>
                {doneCount} of {totalCount} done
              </small>
            </button>
            <button className="icon-btn" aria-label="Next week" disabled={!canAhead} onClick={() => setOffset((o) => o + 1)}>
              {Icon.chevRight}
            </button>
          </div>

          <div className="week">
            {grid.days.map((cells, column) => {
              const date = dateOf(column);
              const training = cells.filter((c) => !c.slot.rest);
              return (
                <div key={column} className={`wk-day${column === todayColumn ? ' today' : ''}`}>
                  <span className="wk-name">
                    {DAY_NAMES[column]}
                    {date && <small>{parseIso(date).getDate()}</small>}
                  </span>
                  {training.length ? (
                    training.map((c) => {
                      const a = activity(c);
                      const space = spaceById.get(c.programme.spaceId);
                      return (
                        <button
                          key={cellKey(c)}
                          className={`wk-card ${c.state}`}
                          style={{ ['--space' as string]: space?.color }}
                          aria-label={`${DAY_NAMES[column]}: ${c.slot.title}, ${activityLabel(a)}${c.state === 'open' ? '' : `, ${c.state === 'resume' ? 'in progress' : c.state}`}`}
                          onClick={() => setOpenKey(cellKey(c))}
                        >
                          {ActivityIcon[a]}
                          {c.state === 'done' && <span className="wk-badge done">{Icon.check}</span>}
                          {c.state === 'skipped' && <span className="wk-badge skipped">{Icon.dash}</span>}
                          {c.state === 'resume' && <span className="wk-badge live" />}
                        </button>
                      );
                    })
                  ) : (
                    <span className="wk-card rest" aria-label={`${DAY_NAMES[column]}: rest`}>
                      <span className="wk-dash" />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="empty-line">
          Nothing planned. Set up a programme in{' '}
          <Link className="link" to="/plan">
            Plan
          </Link>
          {spaces.length ? '' : ', or load a starter file in '}
          {!spaces.length && (
            <Link className="link" to="/settings">
              Settings
            </Link>
          )}
          .
        </p>
      )}

      {opened && (
        <DaySheet
          cell={opened}
          space={spaceById.get(opened.programme.spaceId)}
          activity={activity(opened)}
          onClose={() => setOpenKey(undefined)}
        />
      )}
      {adding && <AddSheet spaces={spaces} onClose={() => setAdding(false)} />}
    </Page>
  );
}
