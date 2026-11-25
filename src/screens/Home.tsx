import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  db,
  SPACE_COLORS,
  uid,
  type Programme,
  type ProgrammeSlot,
  type Routine,
  type Space,
  type Workout,
} from '../db/schema';
import { closedSlots, nextSlot, slotDate, slotForDate, slotKey } from '../db/queries';
import { addDays, dayName, daysBetween, isoDate, longDate, niceDate, relativeDay, upcomingDay } from '../lib/dates';
import { startWorkout } from '../actions';
import { Field, Icon, Page, SectionTitle, Sheet } from '../ui';

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

/** One active programme and the session it wants next. */
interface Upcoming {
  p: Programme;
  slot: ProgrammeSlot;
  /** Calendar date the session is planned for. */
  when: string;
  routine?: Routine;
  /** Today is marked as a rest day in this programme. */
  restToday: boolean;
}

interface TileData {
  icon?: ReactNode;
  value: string;
  label: string;
}

function Tiles({ tiles }: { tiles: TileData[] }) {
  if (!tiles.length) return null;
  return (
    <div className="tiles">
      {tiles.map((t) => (
        <div key={t.label} className="tile">
          {t.icon}
          <div>
            <b>{t.value}</b>
            <small>{t.label}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

function SpaceChip({ space }: { space?: Space }) {
  return (
    <span className="space-chip">
      <span className="dot" />
      {space?.name ?? 'Session'}
    </span>
  );
}

/** The seven days of the programme week that contains today, as marks. */
function WeekStrip({ p, workouts, today }: { p: Programme; workouts: Workout[]; today: string }) {
  const offset = daysBetween(p.startDate, today);
  if (offset < 0 || offset >= p.weeks * 7) return null;
  const week = Math.floor(offset / 7) + 1;
  const closed = closedSlots(p, workouts);
  const days = Array.from({ length: 7 }, (_, day) => {
    const date = addDays(p.startDate, (week - 1) * 7 + day);
    const slot = p.slots.find((s) => s.week === week && s.day === day);
    const training = !!slot && !slot.rest;
    const status = slot ? closed.get(slotKey(slot))?.status : undefined;
    const isToday = date === today;
    const mark =
      status === 'done' ? 'done' : status === 'skipped' ? 'skipped' : isToday ? 'today today-dot' : training ? 'planned' : 'rest-dot';
    return { date, training, status, isToday, mark };
  });
  const total = days.filter((d) => d.training).length;
  const done = days.filter((d) => d.status === 'done').length;
  return (
    <Link
      to={`/programme/${p.id}`}
      className="weekcard"
      aria-label={`This week: ${done} of ${total} sessions done. Open the plan.`}
    >
      <div className="head">
        <span>This week</span>
        <span>
          {done} of {total} done
        </span>
      </div>
      <div className="weekdays">
        {days.map((d) => (
          <div key={d.date} className={`weekday${d.isToday ? ' now' : ''}`}>
            <span className={`daymark ${d.mark}`}>
              {d.status === 'done' ? Icon.check : d.status === 'skipped' ? Icon.dash : null}
            </span>
            {dayName(d.date)[0]}
          </div>
        ))}
      </div>
    </Link>
  );
}

export default function Home() {
  const nav = useNavigate();
  const today = isoDate();
  const [adding, setAdding] = useState(false);

  const data = useLiveQuery(async () => {
    const [spaces, routines, programmes, workouts, exercises] = await Promise.all([
      db.spaces.orderBy('order').toArray(),
      db.routines.toArray(),
      db.programmes.toArray(),
      db.workouts.toArray(),
      db.exercises.toArray(),
    ]);
    return { spaces, routines, programmes, workouts, exercises };
  }, []);

  if (!data) return null;
  const { spaces, routines, programmes, workouts, exercises } = data;
  const spaceById = new Map(spaces.map((s) => [s.id, s]));
  const exerciseName = new Map(exercises.map((e) => [e.id, e.name]));

  const open = workouts.filter((w) => w.status === 'in_progress').sort((a, b) => b.startedAt - a.startedAt);
  const doneToday = workouts
    .filter((w) => w.status === 'done' && w.date === today)
    .sort((a, b) => b.startedAt - a.startedAt)[0];

  const active = programmes.filter((p) => p.active);
  const upcoming: Upcoming[] = [];
  for (const p of active) {
    const closed = closedSlots(p, workouts);
    const scheduled = slotForDate(p, today);
    // Today's slot if it is still open, otherwise the earliest unfinished session.
    const slot = scheduled && !scheduled.rest && !closed.has(slotKey(scheduled)) ? scheduled : nextSlot(p, workouts);
    if (!slot) continue;
    upcoming.push({
      p,
      slot,
      when: slotDate(p, slot),
      routine: routines.find((r) => r.id === slot.routineId),
      restToday: !!scheduled?.rest,
    });
  }
  // Sessions planned for today come first, then anything overdue, then what is still ahead.
  const rank = (u: Upcoming) => (u.when === today ? 0 : u.when < today ? 1 : 2);
  upcoming.sort((a, b) => rank(a) - rank(b) || a.when.localeCompare(b.when));
  // A programme asks for one session a day: once today's is done, a missed earlier one waits its turn
  // as "next up" instead of taking over the screen again.
  const trainedToday = new Set(workouts.filter((w) => w.status === 'done' && w.date === today).map((w) => w.programmeId));
  const due = upcoming.filter((u) => u.when <= today && !trainedToday.has(u.p.id));
  const ahead = upcoming.filter((u) => !due.includes(u));

  const start = async (u: Upcoming) =>
    nav(`/workout/${await startWorkout({ spaceId: u.p.spaceId, routine: u.routine, programme: u.p, slot: u.slot })}`);

  // Exactly one thing leads the screen: resume, start, done, or rest.
  const resume = open[0];
  const lead = !resume ? due[0] : undefined;
  const finished = !resume && !lead ? doneToday : undefined;
  const rest = !resume && !lead && !finished ? ahead[0] : undefined;

  const others = [
    ...open.slice(1).map((w) => ({ key: w.id, title: w.title, sub: 'In progress', spaceId: w.spaceId, go: () => nav(`/workout/${w.id}`) })),
    ...due
      .filter((u) => u !== lead)
      .map((u) => ({
        key: u.p.id,
        title: u.slot.title,
        sub: u.when === today ? 'Also today' : `From ${niceDate(u.when, today)}`,
        spaceId: u.p.spaceId,
        go: () => void start(u),
      })),
  ];
  const nextUp = ahead.filter((u) => u !== rest);

  const stripProgramme =
    active.find((p) => p.id === (resume?.programmeId ?? lead?.p.id ?? finished?.programmeId ?? rest?.p.id)) ?? active[0];
  const heroSpace = spaceById.get(resume?.spaceId ?? lead?.p.spaceId ?? finished?.spaceId ?? rest?.p.spaceId ?? '');

  const lede = (u: Upcoming): { text: string; oneLine: boolean } | undefined => {
    const names = (u.routine?.items ?? []).map((i) => exerciseName.get(i.exerciseId)).filter((n): n is string => !!n);
    if (names.length > 2) return { text: `${names[0]}, ${names[1]} and ${names.length - 2} more`, oneLine: true };
    if (names.length) return { text: names.join(', '), oneLine: true };
    return u.slot.prescription ? { text: u.slot.prescription, oneLine: false } : undefined;
  };

  const planTiles = (u: Upcoming): TileData[] => {
    const tiles: TileData[] = [];
    if (u.slot.targetMinutes) tiles.push({ icon: Icon.clock, value: `${u.slot.targetMinutes} min`, label: 'Time' });
    if (u.slot.targetRpe) tiles.push({ icon: Icon.bolt, value: `RPE ${u.slot.targetRpe}`, label: 'Effort' });
    if (u.routine?.items.length) tiles.push({ icon: Icon.exercises, value: String(u.routine.items.length), label: 'Exercises' });
    return tiles;
  };

  const doneTiles = (w: Workout): TileData[] => {
    const tiles: TileData[] = [];
    if (w.minutes != null) tiles.push({ value: `${w.minutes} min`, label: 'Time' });
    if (w.rpe != null) tiles.push({ value: `RPE ${w.rpe}`, label: 'Effort' });
    if (w.backResponse) tiles.push({ value: w.backResponse, label: 'Back' });
    return tiles;
  };

  const title = (text: string) => <h2 className={text.length > 14 ? 'long' : undefined}>{text}</h2>;
  const leadLede = lead && lede(lead);

  return (
    <Page
      title="Today"
      kicker={longDate(today)}
      large
      actions={
        <>
          <Link to="/pass" className="icon-btn boxed" aria-label="Gym passes and scanner">
            {Icon.pass}
          </Link>
          <Link to="/settings" className="icon-btn boxed" aria-label="Settings">
            {Icon.settings}
          </Link>
        </>
      }
    >
      <div style={{ ['--space' as string]: heroSpace?.color, display: 'contents' }}>
        {resume && (
          <section className="hero" aria-label="Session in progress">
            <div className="hero-top">
              <SpaceChip space={heroSpace} />
              <span>In progress</span>
            </div>
            <div>
              {title(resume.title)}
              <p className="lede">
                {resume.date === today ? 'Started today' : `Started ${relativeDay(resume.date, today).toLowerCase()}`}
              </p>
            </div>
            <Link to={`/workout/${resume.id}`} className="btn primary big block">
              Resume session
              {Icon.arrow}
            </Link>
          </section>
        )}

        {lead && (
          <section className="hero" aria-label="Next session">
            <div className="hero-top">
              <SpaceChip space={heroSpace} />
              <span>
                {lead.when === today ? `Week ${lead.slot.week} of ${lead.p.weeks}` : `From ${niceDate(lead.when, today)}`}
              </span>
            </div>
            <div>
              {title(lead.slot.title)}
              {leadLede && <p className={`lede ${leadLede.oneLine ? 'one-line' : 'clamp'}`}>{leadLede.text}</p>}
            </div>
            <Tiles tiles={planTiles(lead)} />
            <button className="btn primary big block" onClick={() => start(lead)}>
              Start session
              {Icon.arrow}
            </button>
          </section>
        )}

        {finished && (
          <section className="hero" aria-label="Today's session">
            <div className="hero-done">
              <span className="bigcheck">{Icon.check}</span>
              <div>
                <h2>Done for today</h2>
                <p className="lede">{[finished.title, heroSpace?.name].filter(Boolean).join(', ')}</p>
              </div>
            </div>
            <Tiles tiles={doneTiles(finished)} />
            <Link to={`/workout/${finished.id}`} className="btn block">
              View session
            </Link>
          </section>
        )}

        {rest && (
          <section className="hero" aria-label="Today">
            <div className="hero-top">
              <SpaceChip space={heroSpace} />
              <span>
                Week {rest.slot.week} of {rest.p.weeks}
              </span>
            </div>
            <div>
              <h2>{rest.restToday ? 'Rest day' : 'Nothing today'}</h2>
              <p className="lede">
                Next: {rest.slot.title}, {upcomingDay(rest.when, today)}
              </p>
            </div>
            <button className="btn block" onClick={() => start(rest)}>
              Start it anyway
            </button>
          </section>
        )}

        {!resume && !lead && !finished && !rest && spaces.length > 0 && (
          <section className="hero" aria-label="Today">
            <div>
              <h2 className="long">Nothing planned</h2>
              <p className="lede">Pick a space below to start a session, or set up a programme in Plan.</p>
            </div>
          </section>
        )}

        {stripProgramme && <WeekStrip p={stripProgramme} workouts={workouts} today={today} />}
      </div>

      {nextUp.map((u) => (
        <Link key={u.p.id} to={`/programme/${u.p.id}`} className="next-up">
          <span>
            <small>{u.when > today ? `Next up, ${upcomingDay(u.when, today)}` : 'Next up'}</small>
            <b>{u.slot.title}</b>
          </span>
          {Icon.chevRight}
        </Link>
      ))}

      {others.length > 0 && (
        <div className="card flush">
          {others.map((o) => (
            <button key={o.key} className="row" onClick={o.go}>
              <span className="dot" style={{ ['--space' as string]: spaceById.get(o.spaceId)?.color }} />
              <div className="grow">
                <div className="title">{o.title}</div>
                <div className="sub">{o.sub}</div>
              </div>
              {Icon.chevRight}
            </button>
          ))}
        </div>
      )}

      {spaces.length > 0 ? (
        <>
          <SectionTitle
            action={
              <button className="add" aria-label="New space" onClick={() => setAdding(true)}>
                {Icon.plus}
              </button>
            }
          >
            Spaces
          </SectionTitle>
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
          </div>
        </>
      ) : (
        <section className="hero">
          <div>
            <h2 className="long">Start with a space</h2>
            <p className="lede">Spaces keep each kind of training separate: home, the gym, outdoors.</p>
          </div>
          <button className="btn primary big block" onClick={() => setAdding(true)}>
            New space
          </button>
          <p className="sub">
            Have a starter or backup file? Load it from{' '}
            <Link className="link" to="/settings">
              Settings
            </Link>
            .
          </p>
        </section>
      )}

      {adding && <SpaceForm onClose={() => setAdding(false)} />}
    </Page>
  );
}
