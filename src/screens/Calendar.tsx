import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Workout } from '../db/schema';
import { isoDate, niceDate, parseIso } from '../lib/dates';
import { monthGrid, plannedSessions, shiftMonth, type Planned } from '../lib/planning';
import { Icon, Page } from '../ui';

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const monthName = (ym: string): string => parseIso(`${ym}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

/** Every space's sessions on one month: what was done, what was skipped and what is still planned. */
export default function Calendar() {
  const today = isoDate();
  const [ym, setYm] = useState(today.slice(0, 7));
  const [picked, setPicked] = useState(today);

  const data = useLiveQuery(async () => {
    const [spaces, programmes, workouts] = await Promise.all([db.spaces.toArray(), db.programmes.toArray(), db.workouts.toArray()]);
    return { spaces, programmes, workouts };
  }, []);
  if (!data) return null;

  const color = new Map(data.spaces.map((s) => [s.id, s.color]));
  const logged = new Map<string, Workout[]>();
  for (const w of data.workouts) {
    if (w.status === 'in_progress') continue;
    logged.set(w.date, [...(logged.get(w.date) ?? []), w]);
  }
  const planned = new Map<string, Planned[]>();
  for (const p of plannedSessions(data.programmes, data.workouts)) planned.set(p.date, [...(planned.get(p.date) ?? []), p]);

  const dayLogged = logged.get(picked) ?? [];
  const dayPlanned = planned.get(picked) ?? [];
  const doneInMonth = data.workouts.filter((w) => w.status === 'done' && w.date.startsWith(ym)).length;

  const go = (by: number) => {
    const next = shiftMonth(ym, by);
    setYm(next);
    setPicked(next === today.slice(0, 7) ? today : `${next}-01`);
  };

  return (
    <Page title="Calendar" back>
      <div className="month-head">
        <button className="icon-btn boxed" aria-label="Previous month" onClick={() => go(-1)}>
          {Icon.back}
        </button>
        <div>
          <b>{monthName(ym)}</b>
          <small>
            {doneInMonth} session{doneInMonth === 1 ? '' : 's'} done
          </small>
        </div>
        <button className="icon-btn boxed" aria-label="Next month" onClick={() => go(1)}>
          {Icon.chevRight}
        </button>
      </div>

      <div className="month card">
        <div className="month-row head" aria-hidden>
          {DAYS.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        {monthGrid(ym).map((week) => (
          <div key={week[0]} className="month-row">
            {week.map((date) => {
              const done = logged.get(date) ?? [];
              const todo = planned.get(date) ?? [];
              const marks = [
                ...done.map((w) => ({ key: w.id, kind: w.status === 'done' ? 'done' : 'skipped', c: color.get(w.spaceId) })),
                ...todo.map((p) => ({ key: `${p.programme.id}${p.slot.week}-${p.slot.day}`, kind: 'planned', c: color.get(p.programme.spaceId) })),
              ].slice(0, 4);
              const outside = !date.startsWith(ym);
              return (
                <button
                  key={date}
                  className={`month-day${date === picked ? ' sel' : ''}${date === today ? ' today' : ''}${outside ? ' out' : ''}`}
                  aria-pressed={date === picked}
                  aria-label={`${niceDate(date, today)}: ${done.length} logged, ${todo.length} planned`}
                  onClick={() => setPicked(date)}
                >
                  <span className="n">{parseIso(date).getDate()}</span>
                  <span className="marks">
                    {marks.map((m) => (
                      <i key={m.key} className={m.kind} style={{ ['--space' as string]: m.c }} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="month-key" aria-hidden>
        {(['done', 'planned', 'skipped'] as const).map((kind) => (
          <span key={kind}>
            <span className="marks">
              <i className={kind} />
            </span>
            {kind === 'done' ? 'Done' : kind === 'planned' ? 'Planned' : 'Skipped'}
          </span>
        ))}
        <span>Dots take each space's colour.</span>
      </div>

      <div className="section-title">
        <span>{picked === today ? 'Today' : niceDate(picked, today)}</span>
      </div>
      <div className="card flush">
        {dayLogged.map((w) => (
          <Link key={w.id} to={`/workout/${w.id}`} className="row">
            <span className="dot" style={{ ['--space' as string]: color.get(w.spaceId) }} />
            <div className="grow">
              <div className="title">{w.title}</div>
              <div className="sub">
                {[w.minutes != null && `${w.minutes} min`, w.rpe != null && `RPE ${w.rpe}`].filter(Boolean).join(' · ') || 'Logged'}
              </div>
            </div>
            <span className={`badge${w.status === 'done' ? ' ok' : ''}`}>{w.status === 'done' ? 'Done' : 'Skipped'}</span>
          </Link>
        ))}
        {dayPlanned.map((p) => (
          <Link key={`${p.programme.id}${p.slot.week}-${p.slot.day}`} to={`/programme/${p.programme.id}`} className="row">
            <span className="dot" style={{ ['--space' as string]: color.get(p.programme.spaceId) }} />
            <div className="grow">
              <div className="title">{p.slot.title}</div>
              <div className="sub">{p.programme.name}</div>
            </div>
            <span className="badge">{p.date < today ? 'Missed' : 'Planned'}</span>
          </Link>
        ))}
        {!dayLogged.length && !dayPlanned.length && <div className="empty">Nothing on this day.</div>}
      </div>
    </Page>
  );
}
