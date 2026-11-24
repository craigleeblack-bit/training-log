import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, type Programme, type Routine } from '../db/schema';
import { programmeProgress } from '../db/queries';
import { isoDate, relativeDay } from '../lib/dates';
import { deleteSpace, startWorkout } from '../actions';
import { Icon, Page, SectionTitle, useFeedback } from '../ui';
import { SpaceForm } from './Home';

export default function SpaceScreen() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { confirm } = useFeedback();
  const [editing, setEditing] = useState(false);
  const today = isoDate();

  const data = useLiveQuery(async () => {
    const [space, routines, programmes, workouts] = await Promise.all([
      db.spaces.get(id),
      db.routines.where('spaceId').equals(id).sortBy('order'),
      db.programmes.where('spaceId').equals(id).toArray(),
      db.workouts.where('spaceId').equals(id).toArray(),
    ]);
    return { space, routines, programmes, workouts };
  }, [id]);

  if (!data) return null;
  const { space, routines, programmes, workouts } = data;
  if (!space) {
    return (
      <Page title="Space" back="/">
        <div className="empty">This space no longer exists.</div>
      </Page>
    );
  }

  const history = workouts
    .filter((w) => w.status !== 'in_progress')
    .sort((a, b) => b.date.localeCompare(a.date) || b.startedAt - a.startedAt)
    .slice(0, 12);

  const addRoutine = async () => {
    const r: Routine = { id: uid(), spaceId: id, name: 'New routine', logStyle: 'sets', items: [], order: routines.length };
    await db.routines.add(r);
    nav(`/routine/${r.id}`);
  };

  const addProgramme = async () => {
    const p: Programme = {
      id: uid(),
      spaceId: id,
      name: 'New programme',
      startDate: today,
      weeks: 4,
      slots: [],
      active: true,
    };
    await db.programmes.add(p);
    nav(`/programme/${p.id}`);
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${space.name}?`,
      body: `This removes its ${routines.length} routines, ${programmes.length} programmes and ${workouts.length} logged sessions. It cannot be undone.`,
      action: 'Delete space',
      danger: true,
    });
    if (ok) {
      await deleteSpace(id);
      nav('/');
    }
  };

  return (
    <div style={{ ['--space' as string]: space.color }}>
      <Page
        title={space.name}
        back="/"
        actions={
          <button className="icon-btn" aria-label="Edit space" onClick={() => setEditing(true)}>
            {Icon.pencil}
          </button>
        }
      >
        {programmes.length > 0 && (
          <>
            <SectionTitle action={<button onClick={addProgramme}>+ Add</button>}>Programmes</SectionTitle>
            <div className="card flush">
              {programmes.map((p) => {
                const prog = programmeProgress(p, workouts);
                return (
                  <Link key={p.id} to={`/programme/${p.id}`} className="row">
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
            </div>
          </>
        )}

        <SectionTitle action={<button onClick={addRoutine}>+ Add</button>}>Routines</SectionTitle>
        <div className="card flush">
          {routines.map((r) => (
            <div key={r.id} className="row">
              <Link to={`/routine/${r.id}`} className="grow">
                <div className="title">{r.name}</div>
                <div className="sub">
                  {r.items.length} exercise{r.items.length === 1 ? '' : 's'} ·{' '}
                  {r.logStyle === 'sets' ? 'set by set' : 'tick-off'}
                </div>
              </Link>
              <button
                className="btn small primary"
                onClick={async () => nav(`/workout/${await startWorkout({ spaceId: id, routine: r })}`)}
              >
                Start
              </button>
            </div>
          ))}
          {!routines.length && <div className="empty">No routines yet. Add one to start logging.</div>}
        </div>

        <div className="grid-2">
          <button
            className="btn"
            onClick={async () => nav(`/workout/${await startWorkout({ spaceId: id })}`)}
          >
            Quick session
          </button>
          {programmes.length === 0 ? (
            <button className="btn" onClick={addProgramme}>
              + Programme
            </button>
          ) : (
            <Link className="btn" to={`/history?space=${id}`}>
              All history
            </Link>
          )}
        </div>

        <SectionTitle>History</SectionTitle>
        <div className="card flush">
          {history.map((w) => (
            <Link key={w.id} to={`/workout/${w.id}`} className="row">
              <div className="grow">
                <div className="title">{w.title}</div>
                <div className="sub">
                  {relativeDay(w.date, today)}
                  {w.minutes != null ? ` · ${w.minutes} min` : ''}
                  {w.rpe != null ? ` · RPE ${w.rpe}` : ''}
                  {w.backResponse ? ` · back: ${w.backResponse}` : ''}
                </div>
              </div>
              {w.status === 'skipped' && <span className="badge">Skipped</span>}
              {Icon.chevRight}
            </Link>
          ))}
          {!history.length && <div className="empty">Nothing logged here yet.</div>}
        </div>

        <button className="btn ghost danger" onClick={remove}>
          Delete this space
        </button>

        {editing && <SpaceForm space={space} onClose={() => setEditing(false)} />}
      </Page>
    </div>
  );
}
