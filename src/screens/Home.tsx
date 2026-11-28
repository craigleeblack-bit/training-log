import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Space } from '../db/schema';
import { scheduleWeek, type WeekCell } from '../db/queries';
import { addDays, parseIso, weekRangeLabel, weekStart, weekdayIndex } from '../lib/dates';
import { activityLabel, activityOf, spaceIconOf } from '../lib/activities';
import { useToday } from '../useToday';
import { ActivityIcon, SpaceIcon } from '../icons';
import { Icon, Page, Sheet } from '../ui';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** How far the week in view is from this one, in words. */
function weekWord(offset: number): string {
  if (offset === 0) return 'this week';
  if (offset === 1) return 'next week';
  if (offset === -1) return 'last week';
  return offset > 0 ? `in ${offset} weeks` : `${-offset} weeks ago`;
}

/** A slight tilt for a note, between about −1.2° and 1.2°: different for each, the same every time. */
function tiltOf(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 25) - 12) / 10;
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

const STATE_WORD: Record<WeekCell['state'], string> = { open: '', done: ', done', skipped: ', skipped', resume: ', in progress' };

/** The front page: Monday to Sunday of the real week, one post-it note per routine on each day. */
export default function Home() {
  const today = useToday();
  const [offset, setOffset] = useState(0);
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
  const todayIndex = offset === 0 ? weekdayIndex(today) : -1;
  const anything = routines.some((r) => r.days?.length);
  const scheduled = new Set(week.flat().flatMap((c) => (c.workout ? [c.workout.id] : [])));
  // A session started from somewhere other than a note (a space, a programme) can still be resumed.
  const resume = workouts.filter((w) => w.status === 'in_progress' && !scheduled.has(w.id)).sort((a, b) => b.startedAt - a.startedAt)[0];

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
        <div className="week-notes">
          {week.map((cells, day) => {
            const date = addDays(monday, day);
            return (
              <section key={day} className={`wk-day${day === todayIndex ? ' today' : ''}`} aria-label={`${DAY_NAMES[day]} ${parseIso(date).getDate()}`}>
                <h2 className="wk-day-head">
                  <span>{DAY_NAMES[day].slice(0, 3)}</span>
                  <small>{parseIso(date).getDate()}</small>
                  {day === todayIndex && <em>Today</em>}
                </h2>
                <div className="wk-notes">
                  {cells.length ? (
                    cells.map((c) => {
                      const space = spaceById.get(c.routine.spaceId);
                      const a = activityOf(undefined, c.routine, { space: space?.name });
                      return (
                        <Link
                          key={c.routine.id}
                          to={`/day/${date}/${c.routine.id}`}
                          className={`postit ${c.state}`}
                          style={{ ['--space' as string]: space?.color, ['--tilt' as string]: `${tiltOf(c.routine.id + date)}deg` }}
                          aria-label={`${c.routine.name}, ${activityLabel(a)}${STATE_WORD[c.state]}`}
                        >
                          <span className="pi-ico">{ActivityIcon[a]}</span>
                          <b>{c.routine.name}</b>
                          {c.state === 'done' && <span className="pi-stamp">{Icon.check}</span>}
                          {c.state === 'skipped' && <span className="pi-stamp skipped">{Icon.dash}</span>}
                          {c.state === 'resume' && <span className="live" />}
                        </Link>
                      );
                    })
                  ) : (
                    <span className="wk-dash" aria-label="Nothing planned" />
                  )}
                </div>
              </section>
            );
          })}
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

      {adding && <AddSheet spaces={spaces} onClose={() => setAdding(false)} />}
    </Page>
  );
}
