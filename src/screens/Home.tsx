import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, SPACE_COLORS, uid, type Space } from '../db/schema';
import { nextSlot, programmeProgress, slotDate, slotForDate, closedSlots, slotKey } from '../db/queries';
import { isoDate, niceDate, relativeDay } from '../lib/dates';
import { startWorkout } from '../actions';
import { Field, Page, SectionTitle, Sheet } from '../ui';

export function SpaceForm({ space, onClose }: { space?: Space; onClose: () => void }) {
  const count = useLiveQuery(() => db.spaces.count(), []) ?? 0;
  const [name, setName] = useState(space?.name ?? '');
  const [color, setColor] = useState(space?.color ?? SPACE_COLORS[count % SPACE_COLORS.length]);
  const save = async () => {
    const n = name.trim();
    if (!n) return;
    if (space) await db.spaces.update(space.id, { name: n, color });
    else await db.spaces.add({ id: uid(), name: n, color, order: count });
    onClose();
  };
  return (
    <Sheet title={space ? 'Edit space' : 'New space'} onClose={onClose}>
      <Field label="Name">
        <input value={name} autoFocus placeholder="Home, Gym, Outdoors…" onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="field">
        <span>Colour</span>
        <div className="swatches">
          {SPACE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              className={`swatch${c === color ? ' on' : ''}`}
              style={{ ['--c' as string]: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </div>
      <button className="btn primary block" disabled={!name.trim()} onClick={save}>
        Save
      </button>
    </Sheet>
  );
}

export default function Home() {
  const nav = useNavigate();
  const today = isoDate();
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
  const open = workouts.filter((w) => w.status === 'in_progress').sort((a, b) => b.startedAt - a.startedAt);
  const recent = workouts
    .filter((w) => w.status !== 'in_progress')
    .sort((a, b) => b.date.localeCompare(a.date) || b.startedAt - a.startedAt)
    .slice(0, 5);

  const upNext = programmes
    .filter((p) => p.active)
    .map((p) => {
      const closed = closedSlots(p, workouts);
      const scheduled = slotForDate(p, today);
      // Today's slot if it is still open, otherwise the earliest unfinished session.
      const slot =
        scheduled && !scheduled.rest && !closed.has(slotKey(scheduled)) ? scheduled : nextSlot(p, workouts);
      return { p, slot, scheduled, progress: programmeProgress(p, workouts) };
    });

  return (
    <Page title="Today" large>
      <p className="muted" style={{ marginTop: -10 }}>
        {niceDate(today)}
      </p>

      {open.map((w) => (
        <Link key={w.id} to={`/workout/${w.id}`} className="card today" style={{ ['--space' as string]: spaceById.get(w.spaceId)?.color }}>
          <span className="kicker">In progress · {spaceById.get(w.spaceId)?.name}</span>
          <div className="spread">
            <h2>{w.title}</h2>
            <span className="btn small primary">Resume</span>
          </div>
        </Link>
      ))}

      {upNext.map(({ p, slot, scheduled, progress }) => {
        const space = spaceById.get(p.spaceId);
        const restToday = scheduled?.rest && slot && slotDate(p, slot) > today;
        return (
          <div key={p.id} className="card today" style={{ ['--space' as string]: space?.color }}>
            <div className="spread">
              <span className="kicker">
                {space?.name} · {p.name}
              </span>
              <Link to={`/programme/${p.id}`} className="sub link">
                Plan
              </Link>
            </div>
            {slot ? (
              <>
                <div>
                  <h2>{restToday ? 'Rest day' : slot.title}</h2>
                  <p className="sub">
                    {restToday ? `Next: ${slot.title} · ` : ''}Week {slot.week} · {niceDate(slotDate(p, slot))}
                    {slot.targetMinutes ? ` · ${slot.targetMinutes} min` : ''}
                    {slot.targetRpe ? ` · RPE ${slot.targetRpe}` : ''}
                  </p>
                </div>
                {!restToday && slot.prescription && <p className="prescription">{slot.prescription}</p>}
                <button
                  className={`btn block ${restToday ? '' : 'primary'}`}
                  onClick={async () => {
                    const routine = routines.find((r) => r.id === slot.routineId);
                    nav(`/workout/${await startWorkout({ spaceId: p.spaceId, routine, programme: p, slot })}`);
                  }}
                >
                  {restToday ? 'Start it anyway' : 'Start session'}
                </button>
              </>
            ) : (
              <h2>Programme complete</h2>
            )}
            <div className="progress" aria-label={`${progress.done} of ${progress.total} sessions done`}>
              <i style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
            <span className="sub">
              {progress.done} of {progress.total} sessions done
            </span>
          </div>
        );
      })}

      <SectionTitle>Spaces</SectionTitle>
      <div className="spaces">
        {spaces.map((s) => {
          const n = routines.filter((r) => r.spaceId === s.id).length;
          const last = workouts
            .filter((w) => w.spaceId === s.id && w.status === 'done')
            .sort((a, b) => b.date.localeCompare(a.date))[0];
          return (
            <Link key={s.id} to={`/space/${s.id}`} className="space-card" style={{ ['--space' as string]: s.color }}>
              <span className="dot" />
              <div>
                <div className="name">{s.name}</div>
                <div className="sub">{last ? relativeDay(last.date, today) : `${n} routine${n === 1 ? '' : 's'}`}</div>
              </div>
            </Link>
          );
        })}
        <button className="space-card add" onClick={() => setAdding(true)}>
          + New space
        </button>
      </div>

      {!spaces.length && (
        <div className="card stack">
          <p>
            Spaces keep each kind of training separate — one for home, one for the gym, one for outdoors, and so on.
          </p>
          <p className="sub">
            Have a starter or backup file? Load it from <Link className="link" to="/settings">Settings</Link>.
          </p>
        </div>
      )}

      {recent.length > 0 && (
        <>
          <SectionTitle action={<Link to="/history">All</Link>}>Recent</SectionTitle>
          <div className="card flush">
            {recent.map((w) => (
              <Link key={w.id} to={`/workout/${w.id}`} className="row">
                <span className="dot" style={{ ['--space' as string]: spaceById.get(w.spaceId)?.color }} />
                <div className="grow">
                  <div className="title">{w.title}</div>
                  <div className="sub">
                    {relativeDay(w.date, today)}
                    {w.minutes != null ? ` · ${w.minutes} min` : ''}
                    {w.rpe != null ? ` · RPE ${w.rpe}` : ''}
                  </div>
                </div>
                {w.status === 'skipped' && <span className="badge">Skipped</span>}
                <span className="chev">›</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {adding && <SpaceForm onClose={() => setAdding(false)} />}
    </Page>
  );
}
