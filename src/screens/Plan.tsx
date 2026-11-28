import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Routine, type Space } from '../db/schema';
import { programmeProgress } from '../db/queries';
import { repeatLabel } from '../lib/dates';
import { activityOf, spaceIconOf } from '../lib/activities';
import { movedDay, routinesByDay, withDay, withoutDay } from '../lib/planning';
import { newProgramme, newRoutine } from '../actions';
import { ActivityIcon, SpaceIcon } from '../icons';
import { Icon, Page, SectionTitle, Sheet, useFeedback } from '../ui';
import { SpacesSection } from './Spaces';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Pick the space something new belongs to. With only one space there is nothing to ask. */
function SpacePick({ title, spaces, onPick, onClose }: { title: string; spaces: Space[]; onPick: (id: string) => void; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose}>
      <p className="sub">Where does it happen?</p>
      <div className="card flush">
        {spaces.map((s) => (
          <button key={s.id} className="row" style={{ ['--space' as string]: s.color }} onClick={() => onPick(s.id)}>
            <span className="space-ico">{SpaceIcon[spaceIconOf(s)]}</span>
            <div className="grow">
              <div className="title">{s.name}</div>
            </div>
            {Icon.chevRight}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** One routine on one day of the week: open it, move it to another day, or take it off. */
function OnDaySheet({ routine, day, onClose }: { routine: Routine; day: number; onClose: () => void }) {
  const { toast } = useFeedback();
  const move = async (to: number) => {
    await db.routines.update(routine.id, { days: movedDay(routine.days, day, to) });
    toast(`${routine.name} moved to ${DAYS[to]}.`);
    onClose();
  };
  const takeOff = async () => {
    await db.routines.update(routine.id, { days: withoutDay(routine.days, day) });
    toast(`${routine.name} is off ${DAYS[day]}s.`);
    onClose();
  };
  return (
    <Sheet title={routine.name} onClose={onClose}>
      <p className="sub">On {repeatLabel(routine.days)}, every week.</p>
      <div className="field">
        <span>Move {DAYS[day]}'s to</span>
        <div className="chips days">
          {SHORT.map((label, d) => (
            <button
              key={d}
              type="button"
              className={`chip${d === day ? ' on' : ''}`}
              aria-label={d === day ? `${DAYS[d]}, where it is now` : `Move to ${DAYS[d]}`}
              disabled={d === day}
              onClick={() => move(d)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <Link to={`/routine/${routine.id}`} className="btn block">
        Open the routine
      </Link>
      <button className="btn ghost danger block" onClick={takeOff}>
        Take it off {DAYS[day]}s
      </button>
    </Sheet>
  );
}

/** Add a routine to a day: one already made, or a new one. */
function AddToDaySheet({
  day,
  routines,
  spaces,
  onNew,
  onClose,
}: {
  day: number;
  routines: Routine[];
  spaces: Space[];
  onNew: () => void;
  onClose: () => void;
}) {
  const spaceById = new Map(spaces.map((s) => [s.id, s]));
  const choices = routines.filter((r) => !r.days?.includes(day));
  const add = async (r: Routine) => {
    await db.routines.update(r.id, { days: withDay(r.days, day) });
    onClose();
  };
  return (
    <Sheet title={`Add to ${DAYS[day]}`} onClose={onClose}>
      <div className="card flush">
        {choices.map((r) => {
          const space = spaceById.get(r.spaceId);
          return (
            <button key={r.id} className="row" style={{ ['--space' as string]: space?.color }} onClick={() => add(r)}>
              <span className="space-ico">{ActivityIcon[activityOf(undefined, r, { space: space?.name })]}</span>
              <div className="grow">
                <div className="title">{r.name}</div>
                <div className="sub">{[repeatLabel(r.days) || 'Not on the week yet', space?.name].filter(Boolean).join(' · ')}</div>
              </div>
              {Icon.plus}
            </button>
          );
        })}
        {!choices.length && <div className="empty">{routines.length ? 'Every routine is on this day already.' : 'No routines yet.'}</div>}
      </div>
      <button className="btn block" onClick={onNew}>
        New routine on {DAYS[day]}s
      </button>
    </Sheet>
  );
}

type Making = { kind: 'routine'; day?: number } | { kind: 'programme' };

/** The Plan tab: the week that repeats, then the routines, spaces and programmes behind it. */
export default function PlanScreen({
  embedded,
}: {
  /** The left column of the wide workspace, beside the routine being edited. */
  embedded?: boolean;
} = {}) {
  const nav = useNavigate();
  // In the workspace, the routine open beside this list.
  const { id: openId } = useParams();
  const { toast } = useFeedback();
  const [onDay, setOnDay] = useState<{ routineId: string; day: number }>();
  const [adding, setAdding] = useState<number>();
  const [making, setMaking] = useState<Making>();

  const data = useLiveQuery(async () => {
    const [spaces, routines, programmes, workouts] = await Promise.all([
      db.spaces.orderBy('order').toArray(),
      db.routines.toArray(),
      db.programmes.toArray(),
      db.workouts.where('status').anyOf('done', 'skipped').toArray(),
    ]);
    return { spaces, routines, programmes, workouts };
  }, []);
  if (!data) return null;
  const { spaces, routines, programmes, workouts } = data;
  const spaceById = new Map(spaces.map((s) => [s.id, s]));
  const spaceOrder = new Map(spaces.map((s, i) => [s.id, i]));
  const byDay = routinesByDay(routines);
  const sortedRoutines = [...routines].sort(
    (a, b) => (spaceOrder.get(a.spaceId) ?? 99) - (spaceOrder.get(b.spaceId) ?? 99) || a.order - b.order || a.name.localeCompare(b.name),
  );
  const sortedProgrammes = [...programmes].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const icon = (r: Routine) => ActivityIcon[activityOf(undefined, r, { space: spaceById.get(r.spaceId)?.name })];
  const chosen = onDay && routines.find((r) => r.id === onDay.routineId);

  /** Make something new: ask which space only when there is a choice. */
  const make = (m: Making) => {
    if (!spaces.length) {
      toast('Add a space first, under Spaces below.');
      return;
    }
    if (spaces.length === 1) void create(m, spaces[0].id);
    else setMaking(m);
  };
  const create = async (m: Making, spaceId: string) => {
    setMaking(undefined);
    setAdding(undefined);
    if (m.kind === 'programme') nav(`/programme/${await newProgramme(spaceId)}`);
    else nav(`/routine/${await newRoutine(spaceId, m.day !== undefined ? [m.day] : undefined)}`);
  };

  const body = (
    <>
      <SectionTitle>Your week</SectionTitle>
      <p className="sub plan-lede">What the Week screen shows, every week. Tap a routine to move it, or + to add one.</p>
      <div className="card flush plan-week">
        {byDay.map((list, day) => (
          <div key={day} className="plan-day">
            <span className="plan-dayname">{SHORT[day]}</span>
            <div className="plan-chips">
              {list.map((r) => (
                <button
                  key={r.id}
                  className="plan-chip"
                  style={{ ['--space' as string]: spaceById.get(r.spaceId)?.color }}
                  onClick={() => setOnDay({ routineId: r.id, day })}
                >
                  {icon(r)}
                  <span>{r.name}</span>
                </button>
              ))}
              {!list.length && <span className="plan-rest">Rest</span>}
            </div>
            <button className="icon-btn" aria-label={`Add a routine to ${DAYS[day]}`} onClick={() => setAdding(day)}>
              {Icon.plus}
            </button>
          </div>
        ))}
      </div>

      <SectionTitle
        action={
          <button className="add" aria-label="New routine" onClick={() => make({ kind: 'routine' })}>
            {Icon.plus}
          </button>
        }
      >
        Routines
      </SectionTitle>
      <div className="card flush">
        {sortedRoutines.map((r) => {
          const space = spaceById.get(r.spaceId);
          return (
            <Link
              key={r.id}
              to={`/routine/${r.id}`}
              className={`row${embedded && r.id === openId ? ' selected' : ''}`}
              aria-current={embedded && r.id === openId ? 'page' : undefined}
              style={{ ['--space' as string]: space?.color }}
            >
              <span className="space-ico">{icon(r)}</span>
              <div className="grow">
                <div className="title">{r.name}</div>
                <div className="sub">{[repeatLabel(r.days) || 'Not on the week', space?.name].filter(Boolean).join(' · ')}</div>
              </div>
              {Icon.chevRight}
            </Link>
          );
        })}
        {!routines.length && <div className="empty">No routines yet. A routine is a session you repeat: its exercises, sets and rests.</div>}
      </div>

      <SpacesSection />

      <SectionTitle
        action={
          <button className="add" aria-label="New programme" onClick={() => make({ kind: 'programme' })}>
            {Icon.plus}
          </button>
        }
      >
        Programmes
      </SectionTitle>
      <div className="card flush">
        {sortedProgrammes.map((p) => {
          const prog = programmeProgress(p, workouts);
          return (
            <Link key={p.id} to={`/programme/${p.id}`} className="row" style={{ ['--space' as string]: spaceById.get(p.spaceId)?.color }}>
              <span className="dot" />
              <div className="grow">
                <div className="title">{p.name}</div>
                <div className="sub">
                  {p.weeks} weeks · {prog.done} of {prog.total} done
                </div>
              </div>
              {p.active && <span className="badge ok">Active</span>}
              {Icon.chevRight}
            </Link>
          );
        })}
        {!programmes.length && (
          <div className="empty">Optional: a plan that changes week by week. Its weeks can become your weekly schedule.</div>
        )}
      </div>


      {chosen && onDay && <OnDaySheet routine={chosen} day={onDay.day} onClose={() => setOnDay(undefined)} />}
      {adding !== undefined && (
        <AddToDaySheet
          day={adding}
          routines={sortedRoutines}
          spaces={spaces}
          onNew={() => {
            const day = adding;
            setAdding(undefined);
            make({ kind: 'routine', day });
          }}
          onClose={() => setAdding(undefined)}
        />
      )}
      {making && (
        <SpacePick
          title={making.kind === 'programme' ? 'New programme' : 'New routine'}
          spaces={spaces}
          onPick={(id) => void create(making, id)}
          onClose={() => setMaking(undefined)}
        />
      )}
    </>
  );

  return embedded ? (
    <aside className="ws-col ws-plan" aria-label="Plan">
      <div className="ws-head">
        <h2>Plan</h2>
      </div>
      <div className="content">{body}</div>
    </aside>
  ) : (
    <Page title="Plan" large>
      {body}
    </Page>
  );
}
