import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Programme, type ProgrammeSlot, type Routine } from '../db/schema';
import { closedSlots, currentWeek, isDated, nextSlot, programmeProgress, slotDate, slotKey } from '../db/queries';
import { addDays, dayName, daysBetween, isoDate, niceDate, parseIso } from '../lib/dates';
import { startWorkout } from '../actions';
import { applyWeekSchedule, copyWeek, moveProgrammeDay, programmeCopy, repeatWeeks, weekSchedule, type Day } from '../lib/planning';
import { repeatLabel } from '../lib/dates';
import { Field, Icon, IconPicker, Page, Sheet, parseNumber, useFeedback } from '../ui';
import { activityOf, knownActivity } from '../lib/activities';
import { ACTIVITY_OPTIONS, ActivityIcon } from '../icons';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function SlotForm({
  slot,
  routines,
  dateLabel,
  onSave,
  onClear,
  onClose,
  days,
  onMove,
  context,
}: {
  slot: ProgrammeSlot;
  routines: Routine[];
  /** Names the activity guess can fall back on. */
  context: { programme?: string; space?: string };
  dateLabel: string;
  onSave: (s: ProgrammeSlot) => void;
  onClear: () => void;
  onClose: () => void;
  /** Other days this session could go to. Empty for a day that has no session yet. */
  days: (Day & { label: string })[];
  onMove: (to: Day) => void;
}) {
  const [s, setS] = useState(slot);
  const set = (changes: Partial<ProgrammeSlot>) => setS((prev) => ({ ...prev, ...changes }));
  const routine = routines.find((r) => r.id === s.routineId);
  // What the day would be without a choice of its own: the routine's activity, or a guess.
  const inherited = activityOf({ ...s, activity: undefined, rest: false }, routine, context);
  const activity = knownActivity(s.activity) ?? inherited;
  return (
    <Sheet title={`Week ${slot.week}, ${dateLabel}`} onClose={onClose}>
      <Field label="Session name">
        <input value={s.title} placeholder="Strength A" onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label="Routine (optional)">
        <select
          value={s.routineId ?? ''}
          onChange={(e) => {
            const r = routines.find((x) => x.id === e.target.value);
            set({ routineId: r?.id, title: s.title || r?.name || '' });
          }}
        >
          <option value="">None, free text only</option>
          {routines.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </Field>
      {!s.rest && (
        <IconPicker
          label="Activity"
          options={ACTIVITY_OPTIONS}
          value={activity}
          onChange={(k) => set({ activity: k === inherited ? undefined : k })}
          hint={s.activity ? undefined : routine?.activity ? 'From the routine' : 'Guessed from the name'}
        />
      )}
      <Field label="Prescription for this day">
        <textarea value={s.prescription ?? ''} onChange={(e) => set({ prescription: e.target.value })} />
      </Field>
      <div className="grid-2">
        <Field label="Target minutes">
          <input value={s.targetMinutes ?? ''} placeholder="25–35" onChange={(e) => set({ targetMinutes: e.target.value })} />
        </Field>
        <Field label="Target RPE">
          <input value={s.targetRpe ?? ''} placeholder="5" onChange={(e) => set({ targetRpe: e.target.value })} />
        </Field>
      </div>
      <label className="inline">
        <input type="checkbox" checked={!!s.rest} onChange={(e) => set({ rest: e.target.checked, title: e.target.checked && !s.title ? 'Rest' : s.title })} />
        Rest day
      </label>
      {days.length > 0 && (
        <Field label="Move to another day">
          <select
            value=""
            onChange={(e) => {
              const [week, day] = e.target.value.split('-').map(Number);
              if (e.target.value) onMove({ week, day });
            }}
          >
            <option value="">Keep it on this day</option>
            {days.map((d) => (
              <option key={`${d.week}-${d.day}`} value={`${d.week}-${d.day}`}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="grid-2">
        <button className="btn danger" onClick={onClear}>
          Clear day
        </button>
        <button
          className="btn primary"
          disabled={!s.title.trim()}
          onClick={() =>
            onSave({
              ...s,
              title: s.title.trim(),
              prescription: s.prescription?.trim() || undefined,
              targetMinutes: s.targetMinutes?.trim() || undefined,
              targetRpe: s.targetRpe?.trim() || undefined,
            })
          }
        >
          Save
        </button>
      </div>
    </Sheet>
  );
}

/** Copy one week over others, or repeat a block of weeks to the end. */
function WeekCopy({ p, onApply, onClose }: { p: Programme; onApply: (slots: ProgrammeSlot[]) => void; onClose: () => void }) {
  const weeks = Array.from({ length: p.weeks }, (_, i) => i + 1);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState<number[]>([]);
  const [block, setBlock] = useState(Math.min(2, p.weeks - 1));
  const targets = weeks.filter((w) => w !== from);
  return (
    <Sheet title="Copy weeks" onClose={onClose}>
      <Field label="Copy this week">
        <select
          value={from}
          onChange={(e) => {
            setFrom(Number(e.target.value));
            setTo([]);
          }}
        >
          {weeks.map((w) => (
            <option key={w} value={w}>
              Week {w}
            </option>
          ))}
        </select>
      </Field>
      <div className="field">
        <span>Onto these weeks, replacing what they hold</span>
        <div className="chips">
          {targets.map((w) => (
            <button
              key={w}
              type="button"
              className={`chip${to.includes(w) ? ' on' : ''}`}
              aria-pressed={to.includes(w)}
              onClick={() => setTo(to.includes(w) ? to.filter((x) => x !== w) : [...to, w])}
            >
              {w}
            </button>
          ))}
        </div>
      </div>
      <div className="grid-2">
        <button className="btn" onClick={() => setTo(weeks.filter((w) => w > from))}>
          All later weeks
        </button>
        <button className="btn primary" disabled={!to.length} onClick={() => onApply(copyWeek(p.slots, from, to))}>
          Copy
        </button>
      </div>
      {p.weeks > 2 && (
        <>
          <p className="sub">Or repeat the first weeks, as a block, through to the end of the programme.</p>
          <div className="grid-2">
            <select className="input" aria-label="Weeks in the block" value={block} onChange={(e) => setBlock(Number(e.target.value))}>
              {weeks.slice(1, -1).map((w) => (
                <option key={w} value={w}>
                  Weeks 1 to {w}
                </option>
              ))}
            </select>
            <button className="btn" onClick={() => onApply(repeatWeeks(p.slots, block, p.weeks))}>
              Repeat to the end
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/** A programme as a calendar: one row per week, one mark per day, and a card for the selected day. */
function ProgrammeView({ id }: { id: string }) {
  const nav = useNavigate();
  const { confirm, toast } = useFeedback();
  const [editMode, setEditMode] = useState(false);
  const [copying, setCopying] = useState(false);
  const [editing, setEditing] = useState<Day>();
  const [picked, setPicked] = useState<Day>();
  const today = isoDate();

  const data = useLiveQuery(async () => {
    const programme = await db.programmes.get(id);
    if (!programme) return { programme: null };
    const [space, routines, workouts] = await Promise.all([
      db.spaces.get(programme.spaceId),
      db.routines.where('spaceId').equals(programme.spaceId).sortBy('order'),
      db.workouts.where('programmeId').equals(id).toArray(),
    ]);
    return { programme, space, routines, workouts };
  }, [id]);

  if (!data) return null;
  if (!data.programme) {
    return (
      <Page title="Programme" back>
        <div className="empty">This programme no longer exists.</div>
      </Page>
    );
  }
  const { programme: p, space, routines = [], workouts = [] } = data;
  const closed = closedSlots(p, workouts);
  const progress = programmeProgress(p, workouts);
  const patch = (changes: Partial<Programme>) => db.programmes.update(id, changes);
  const find = (d: Day) => p.slots.find((s) => s.week === d.week && s.day === d.day);

  const dated = isDated(p);
  const offset = daysBetween(p.startDate, today);
  const running = dated && offset >= 0 && offset < p.weeks * 7;
  const upTo = currentWeek(p, closed);
  // Dated, the calendar says which week it is; otherwise it is the first week with a session still open.
  const thisWeek = dated ? (running ? Math.floor(offset / 7) + 1 : undefined) : upTo;
  const finished = progress.total > 0 && !nextSlot(p, workouts);
  const weekLabel = dated
    ? offset < 0
      ? `Starts ${niceDate(p.startDate, today)}`
      : running
        ? `Week ${thisWeek} of ${p.weeks}`
        : 'Finished'
    : finished
      ? 'Complete'
      : `Week ${upTo} of ${p.weeks}`;
  /** How a day is named: its date when the programme is dated, else its weekday. */
  const dayLabel = (d: Day): string => (dated ? niceDate(slotDate(p, d), today) : WEEKDAYS[d.day]);
  const activityFor = (s: ProgrammeSlot) =>
    activityOf(s, routines.find((r) => r.id === s.routineId), { programme: p.name, space: space?.name });

  // The day in view: the one tapped, else today, else the next session still to do.
  const upcoming = nextSlot(p, workouts);
  const fallback: Day = running
    ? { week: Math.floor(offset / 7) + 1, day: offset % 7 }
    : upcoming
      ? { week: upcoming.week, day: upcoming.day }
      : { week: 1, day: 0 };
  const sel = picked && picked.week <= p.weeks ? picked : fallback;
  const slot = find(sel);
  const selDate = slotDate(p, sel);
  const selDone = slot ? closed.get(slotKey(slot)) : undefined;

  const saveSlot = (next: ProgrammeSlot) => {
    void patch({ slots: [...p.slots.filter((s) => !(s.week === next.week && s.day === next.day)), next] });
    setEditing(undefined);
  };

  const start = async (s: ProgrammeSlot) => {
    const routine = routines.find((r) => r.id === s.routineId);
    nav(`/workout/${await startWorkout({ spaceId: p.spaceId, routine, programme: p, slot: s })}`);
  };

  const duplicate = async () => {
    const copy = programmeCopy(p, today);
    await db.programmes.add(copy);
    toast(dated ? 'Copied. Set its start date to use it.' : 'Copied.');
    nav(`/programme/${copy.id}`);
  };

  /** Turn the week in view into the weekly schedule the Week screen repeats. */
  const makeSchedule = async () => {
    const schedule = weekSchedule(p, sel.week);
    const lines = [...schedule].map(([rid, days]) => `${routines.find((r) => r.id === rid)?.name ?? 'A routine'}: ${repeatLabel(days)}`);
    const ok = await confirm({
      title: `Repeat week ${sel.week} every week?`,
      body: `${lines.join('. ')}. These routines will show on the Week screen on these days from now on, replacing the days they had.`,
      action: 'Use as my schedule',
    });
    if (!ok) return;
    const n = await applyWeekSchedule(p, sel.week);
    toast(`${n} routine${n === 1 ? '' : 's'} now repeat every week.`);
  };
  const scheduleCount = weekSchedule(p, sel.week).size;

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${p.name}?`,
      body: 'Sessions already logged are kept in history.',
      action: 'Delete programme',
      danger: true,
    });
    if (ok) {
      await db.programmes.delete(id);
      nav(-1);
    }
  };

  const editingSlot = editing && (find(editing) ?? { ...editing, title: '' });
  const targets =
    slot && !slot.rest
      ? [slot.targetMinutes && `${slot.targetMinutes} min`, slot.targetRpe && `RPE ${slot.targetRpe}`].filter(Boolean).join(', ')
      : '';

  return (
    <div style={{ ['--space' as string]: space?.color }}>
      <Page
        title={p.name}
        kicker={space?.name}
        back="/plan"
        actions={
          <button className="btn small" onClick={() => setEditMode((v) => !v)}>
            {editMode ? 'Done' : 'Edit'}
          </button>
        }
      >
        {editMode ? (
          <div className="card stack">
            <Field label="Name">
              <input defaultValue={p.name} onBlur={(e) => e.target.value.trim() && patch({ name: e.target.value.trim() })} />
            </Field>
            <label className="inline">
              <input type="checkbox" checked={dated} onChange={(e) => patch({ dated: e.target.checked })} />
              Calendar dates
            </label>
            <p className="sub">
              {dated
                ? 'Each day falls on a date, from the start date on.'
                : 'Weeks run Monday to Sunday, one after another, at your own pace.'}
            </p>
            <div className="grid-2">
              {dated && (
                <Field label="Week 1 starts">
                  <input type="date" value={p.startDate} onChange={(e) => e.target.value && patch({ startDate: e.target.value })} />
                </Field>
              )}
              <Field label="Weeks">
                <input
                  inputMode="numeric"
                  defaultValue={p.weeks}
                  onBlur={(e) => {
                    const n = parseNumber(e.target.value);
                    if (n && n >= 1 && n <= 52) void patch({ weeks: Math.round(n) });
                  }}
                />
              </Field>
            </div>
            <label className="inline">
              <input type="checkbox" checked={p.active} onChange={(e) => patch({ active: e.target.checked })} />
              Active
            </label>
            <Field label="Notes">
              <textarea defaultValue={p.notes ?? ''} onBlur={(e) => patch({ notes: e.target.value.trim() || undefined })} />
            </Field>
            <div className="grid-2">
              <button className="btn" disabled={p.weeks < 2} onClick={() => setCopying(true)}>
                Copy weeks
              </button>
              <button className="btn" onClick={duplicate}>
                Duplicate programme
              </button>
            </div>
            <p className="sub">Tap any day below to set, change or move its session.</p>
          </div>
        ) : (
          <div className="card stack">
            <div className="progress" role="img" aria-label={`${progress.done} of ${progress.total} sessions done`}>
              <i style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
            <div className="spread sub">
              <span>{weekLabel}</span>
              <span>
                {progress.done} of {progress.total} sessions
              </span>
            </div>
            {p.notes && <p className="prescription clamp">{p.notes}</p>}
          </div>
        )}

        <div className="cal">
          <div className="cal-head" aria-hidden>
            {Array.from({ length: 7 }, (_, day) => (
              <span key={day}>{dated ? dayName(addDays(p.startDate, day))[0] : WEEKDAYS[day][0]}</span>
            ))}
          </div>
          {Array.from({ length: p.weeks }, (_, w) => w + 1).map((week) => (
            <div key={week} className={`cal-week${week === thisWeek ? ' current' : ''}`}>
              {Array.from({ length: 7 }, (_, day) => {
                const s = find({ week, day });
                const date = slotDate(p, { week, day });
                const status = s ? closed.get(slotKey(s))?.status : undefined;
                const training = !!s && !s.rest;
                const mark =
                  status === 'done'
                    ? 'done'
                    : status === 'skipped'
                      ? 'skipped'
                      : dated && date === today
                        ? 'today'
                        : training
                          ? 'planned'
                          : '';
                // Training days show what they are; the date moves under the mark when there is one.
                const content =
                  status === 'done'
                    ? Icon.check
                    : status === 'skipped'
                      ? Icon.dash
                      : training
                        ? ActivityIcon[activityFor(s)]
                        : dated
                          ? parseIso(date).getDate()
                          : null;
                const dateBelow = dated && (training || !!status);
                const isSel = !editMode && sel.week === week && sel.day === day;
                return (
                  <button
                    key={day}
                    className={`cal-day${isSel ? ' sel' : ''}`}
                    aria-pressed={isSel}
                    aria-label={`Week ${week}, ${dayLabel({ week, day })}: ${s ? s.title : 'nothing planned'}${status ? `, ${status}` : ''}`}
                    onClick={() => (editMode ? setEditing({ week, day }) : setPicked({ week, day }))}
                  >
                    <span className={`daymark ${mark}`}>{content}</span>
                    {dateBelow && <span className="cal-date">{parseIso(date).getDate()}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="legend" aria-hidden>
          <span>
            <i className="done" />
            Done
          </span>
          <span>
            <i className="skipped" />
            Skipped
          </span>
          <span>
            <i className="planned" />
            Planned
          </span>
          <span>
            <i className="today" />
            Today
          </span>
        </div>

        {!editMode && (
          <section className="card daycard" aria-label="Selected day">
            <div className="top">
              <div>
                <small>
                  {dated ? (
                    <>
                      {selDate === today ? 'Today, ' : ''}
                      {niceDate(selDate, today)}
                    </>
                  ) : (
                    `Week ${sel.week}, ${WEEKDAYS[sel.day]}`
                  )}
                </small>
                <h2>{slot ? slot.title : 'Nothing planned'}</h2>
                {targets && <span className="sub">{targets}</span>}
              </div>
              <div className="acts">
                {slot && (
                  <button className="icon-btn" aria-label="Edit this day" onClick={() => setEditing(sel)}>
                    {Icon.pencil}
                  </button>
                )}
                {!slot ? (
                  <button className="btn" onClick={() => setEditing(sel)}>
                    Add session
                  </button>
                ) : selDone ? (
                  <Link className="btn" to={`/workout/${selDone.id}`}>
                    View
                  </Link>
                ) : slot.rest ? null : (
                  <button className="btn primary" onClick={() => start(slot)}>
                    Start
                    {Icon.arrow}
                  </button>
                )}
              </div>
            </div>
            {slot?.prescription && !slot.rest && <p className="prescription clamp">{slot.prescription}</p>}
          </section>
        )}

        {!editMode && scheduleCount > 0 && (
          <button className="btn block" onClick={makeSchedule}>
            Use week {sel.week} as my weekly schedule
          </button>
        )}


        {editMode && (
          <button className="btn ghost danger" onClick={remove}>
            Delete this programme
          </button>
        )}

        {copying && (
          <WeekCopy
            p={p}
            onClose={() => setCopying(false)}
            onApply={(slots) => {
              void patch({ slots });
              setCopying(false);
              toast('Weeks copied.');
            }}
          />
        )}

        {editingSlot && editing && (
          <SlotForm
            slot={editingSlot}
            routines={routines}
            context={{ programme: p.name, space: space?.name }}
            dateLabel={dayLabel(editing)}
            onClose={() => setEditing(undefined)}
            onSave={saveSlot}
            days={
              find(editing)
                ? Array.from({ length: p.weeks * 7 }, (_, n) => ({ week: Math.floor(n / 7) + 1, day: n % 7 }))
                    .filter((d) => !(d.week === editing.week && d.day === editing.day))
                    .map((d) => {
                      const taken = find(d);
                      return { ...d, label: `Week ${d.week}, ${dayLabel(d)}${taken ? ` (swap with ${taken.title})` : ''}` };
                    })
                : []
            }
            onMove={async (to) => {
              await moveProgrammeDay(p.id, editing, to);
              setEditing(undefined);
              setPicked(to);
            }}
            onClear={() => {
              void patch({ slots: p.slots.filter((s) => !(s.week === editing.week && s.day === editing.day)) });
              setEditing(undefined);
            }}
          />
        )}
      </Page>
    </div>
  );
}

export default function ProgrammeScreen() {
  const { id = '' } = useParams();
  return <ProgrammeView key={id} id={id} />;
}
