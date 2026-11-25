import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, type Exercise, type RoutineItem, type SetEntry, type Side, type Space, type Workout } from '../db/schema';
import { describeParts, formatSeconds, hasValue, lastTime, loadNumber, repsNumber } from '../db/queries';
import { isoDate, niceDate } from '../lib/dates';
import { countdownPhases } from '../lib/timer';
import { buildWorkoutContext } from '../lib/claude';
import {
  BACK_OPTIONS,
  COLUMNS,
  REST_TIMER,
  RPE,
  compactSet,
  addSet,
  fmtDuration,
  moveItem,
  removeItem,
  removeSet,
  saveSet,
  setCount,
  setsDone,
  SIDES,
  sidesOf,
  swapItem,
  type Column,
  type NumKey,
  type SetValues,
} from '../lib/logging';
import { deleteWorkout, useAskClaude } from '../actions';
import { useTimer } from '../timerContext';
import { Chips, Field, Icon, NumInput, SectionTitle, Sheet, parseDuration, useFeedback } from '../ui';
import { ExercisePicker, itemSummary } from './RoutineEdit';
import { VideoButton } from './Exercises';
import TrackSummary from './TrackSummary';

const round2 = (n: number) => Math.round(n * 100) / 100;

const loggedSets = (entries: SetEntry[]) => entries.filter(hasValue);

/** One thing to log: a set, or one side of a set. */
interface Slot {
  setNo: number;
  side?: Side;
}

const keyOf = (s: Slot): string => `${s.setNo}${s.side ?? ''}`;

/* ── One big number with − and + under it ─────────────────── */

function Stepper({
  col,
  name,
  value,
  onType,
  onBump,
}: {
  col: Column;
  name: string;
  value: number | undefined;
  onType: (v: number | undefined) => void;
  onBump: (by: number) => void;
}) {
  const time = col.key === 'seconds';
  const label = time ? 'Time' : col.key === 'reps' ? col.label : `${col.label}, ${col.unit}`;
  const bump = (by: number) => {
    // Commit anything still being typed before stepping from it.
    (document.activeElement as HTMLElement | null)?.blur?.();
    onBump(by);
  };
  return (
    <div className="stepper">
      <span className="lbl">{label}</span>
      <NumInput
        className="bignum"
        ariaLabel={`${name} ${col.label}`}
        value={value}
        placeholder="0"
        parse={time ? parseDuration : undefined}
        format={time ? fmtDuration : undefined}
        onCommit={onType}
      />
      <div className="pm">
        <button type="button" aria-label={`Less ${col.label.toLowerCase()}`} onClick={() => bump(-col.step)}>
          {Icon.minus}
        </button>
        <button type="button" aria-label={`More ${col.label.toLowerCase()}`} onClick={() => bump(col.step)}>
          {Icon.plus}
        </button>
      </div>
    </div>
  );
}

/* ── One exercise at a time: log a set, rest, repeat ──────── */

function FocusExercise({
  workout,
  item,
  exercise,
  entries,
  isLast,
  onNext,
  onWrap,
  onAddSet,
  onOptions,
  onSetDone,
  groupNote,
  nextNote,
}: {
  workout: Workout;
  item: RoutineItem;
  exercise: Exercise;
  entries: SetEntry[];
  isLast: boolean;
  onNext: () => void;
  onWrap: () => void;
  onAddSet: () => void;
  onOptions: () => void;
  /** A whole set has just been logged. `more` says whether this exercise has sets left. */
  onSetDone: (more: boolean) => void;
  /** "Superset 1 of 2", when this exercise is done in turn with others. */
  groupNote?: string;
  /** What follows a logged set: "then rest 1:30", "then Pull-ups". */
  nextNote: string;
}) {
  const timer = useTimer();
  const { toast, confirm } = useFeedback();
  const [picked, setPicked] = useState<Slot>();
  const [draft, setDraft] = useState<Record<string, SetValues>>({});
  const [reading, setReading] = useState<'cues' | 'notes'>();
  const last = useLiveQuery(() => lastTime(db, exercise.id, { workoutId: workout.id }), [exercise.id, workout.id]);

  const cols = COLUMNS[exercise.measure];
  const rows = setCount(item, entries);
  const range = Array.from({ length: rows }, (_, i) => i + 1);
  // One slot to fill per set, or two when left and right are logged apart.
  const sides = sidesOf(item);
  const slots: Slot[] = range.flatMap((setNo) => sides.map((side) => ({ setNo, side })));
  const slotLogged = (s: Slot) => entries.find((e) => e.setNo === s.setNo && e.side === s.side && hasValue(e));
  /** A set is logged once every side of it is. Gives back its first entry. */
  const logged = (setNo: number) =>
    sides.every((side) => slotLogged({ setNo, side })) ? slotLogged({ setNo, side: sides[0] }) : undefined;
  const firstOpen = slots.find((s) => !slotLogged(s));
  /** The slot the steppers are editing; undefined once every set is logged. */
  const slot = picked ?? firstOpen;
  const current = slot?.setNo;
  const slotKey = slot ? keyOf(slot) : '';

  // What a set is expected to be: the plan's own target for that set if it has one (a ladder),
  // else the same set last time, else last time's final set, else the plan.
  const expected = (s: Slot): SetValues => {
    const prev =
      last?.sets.find((p) => p.setNo === s.setNo && p.side === s.side) ??
      last?.sets.find((p) => p.setNo === s.setNo) ??
      last?.sets[last.sets.length - 1];
    return {
      weight: prev?.weight ?? loadNumber(item.load),
      reps: item.repsBySet?.[s.setNo - 1] ?? prev?.reps ?? repsNumber(item.reps),
      seconds: prev?.seconds,
      metres: prev?.metres,
    };
  };

  const valuesFor = (s: Slot, edits: SetValues | undefined): SetValues => {
    const base = slotLogged(s) ?? expected(s);
    const out: SetValues = {};
    for (const c of cols) out[c.key] = base[c.key];
    return { ...out, ...edits };
  };
  const vals = slot ? valuesFor(slot, draft[slotKey]) : {};

  const type = (key: NumKey, v: number | undefined) => {
    if (!slot) return;
    setDraft((d) => ({ ...d, [slotKey]: { ...d[slotKey], [key]: v } }));
  };
  const bump = (key: NumKey, by: number) => {
    if (!slot) return;
    // Read the latest draft inside the update, so a value typed a moment ago is the starting point.
    setDraft((d) => {
      const from = valuesFor(slot, d[slotKey])[key] ?? 0;
      return { ...d, [slotKey]: { ...d[slotKey], [key]: Math.max(0, round2(from + by)) } };
    });
  };

  const editing = !!slot && !!slotLogged(slot);
  /** With sides, the rest comes after the second one. */
  const closesSet = !!slot && sides.every((side) => side === slot.side || slotLogged({ setNo: slot.setNo, side }));
  const sideWord = slot?.side === 'L' ? 'left' : slot?.side === 'R' ? 'right' : '';

  /** What a set tile shows: one value, or left / right. */
  const tileText = (setNo: number): string => {
    if (!item.eachSide) {
      const e = slotLogged({ setNo });
      return e ? compactSet(e, exercise.measure) : '';
    }
    const side = (s: Side) => {
      const e = slotLogged({ setNo, side: s });
      return e ? String(e.reps ?? e.seconds ?? e.metres ?? e.weight ?? '') : '–';
    };
    return `${side('L')} / ${side('R')}`;
  };

  // With a long row of sets, keep the one being logged in view.
  const nowRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    nowRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [current]);

  const log = async () => {
    if (!slot) return;
    if (!cols.some((c) => vals[c.key] != null)) {
      toast('Enter a value first.');
      return;
    }
    const fill: SetValues = {};
    for (const c of cols) fill[c.key] = vals[c.key];
    await saveSet(workout, item, exercise, slot.setNo, fill, slot.side);
    setDraft((d) => {
      const next = { ...d };
      delete next[slotKey];
      return next;
    });
    setPicked(undefined);
    // An edit changes nothing else; a first side is followed at once by the other.
    if (editing || !closesSet) return;
    onSetDone(slots.some((s) => s.setNo !== slot.setNo && !slotLogged(s)));
  };

  /** Take a set out altogether; the sets after it move up. */
  const remove = async (setNo: number) => {
    const entry = sides.map((side) => slotLogged({ setNo, side })).find(Boolean);
    if (entry && setNo !== current) {
      const ok = await confirm({
        title: `Remove set ${setNo}?`,
        body: `It has ${compactSet(entry, exercise.measure)} logged.`,
        action: 'Remove set',
        danger: true,
      });
      if (!ok) return;
    }
    await removeSet(workout.id, item.id, setNo);
    setDraft({});
    setPicked(undefined);
  };

  const pos = timer.position;
  const resting = timer.active && timer.name === REST_TIMER && !!pos && !pos.done;

  if (resting && pos) {
    const total = pos.phase?.seconds ?? 1;
    const ring = 2 * Math.PI * 126;
    const doneHere = setsDone(item, entries);
    return (
      <>
        <div className="s-body rest">
          <span className="logged-chip">
            {Icon.check}
            {doneHere ? `Set ${doneHere} logged` : 'Exercise done'}
          </span>
          <div className="rest-ring">
            <svg viewBox="0 0 280 280" aria-hidden>
              <circle className="track" cx="140" cy="140" r="126" />
              <circle
                className="arc"
                cx="140"
                cy="140"
                r="126"
                transform="rotate(-90 140 140)"
                strokeDasharray={ring}
                strokeDashoffset={ring * (1 - Math.min(1, pos.remaining / total))}
              />
            </svg>
            <div className="face">
              <span className="word">Rest</span>
              <span className="clock" role="timer" aria-live="off">
                {formatSeconds(Math.ceil(pos.remaining))}
              </span>
              <span className="of">of {formatSeconds(total)}</span>
            </div>
          </div>
          <div className="rest-adjust">
            <button type="button" aria-label="Take 15 seconds off" onClick={() => timer.extend(-15)}>
              − 15 s
            </button>
            <button type="button" aria-label="Add 15 seconds" onClick={() => timer.extend(15)}>
              + 15 s
            </button>
          </div>
          <div className="up-next">
            <div>
              <small>Up next</small>
              <b>{current != null ? `${exercise.name}, set ${current} of ${rows}` : exercise.name}</b>
            </div>
            {current != null && <b className="amount">{compactSet(vals, exercise.measure)}</b>}
          </div>
        </div>
        <div className="s-foot">
          <button className="btn outline big block" onClick={timer.stop}>
            {current != null ? `Start set ${current} now` : 'Skip rest'}
            {Icon.arrow}
          </button>
        </div>
      </>
    );
  }

  const summary = itemSummary(item) || exercise.equipment;
  const cue = item.note ?? exercise.cues?.split('\n').find((l) => l.trim());

  return (
    <>
      <div className="s-body">
        <div className="s-intro">
          <div className="s-title">
            <div>
              <h1>{exercise.name}</h1>
              {summary && <p>{summary}</p>}
              {groupNote && <p className="group-note">{groupNote}</p>}
              {exercise.parts?.length ? <p>Each round: {describeParts(exercise.parts)}</p> : null}
            </div>
            <button className="icon-btn boxed" aria-label="Session options" onClick={onOptions}>
              {Icon.more}
            </button>
          </div>
          {cue && (
            <button className="cue" onClick={() => setReading('cues')}>
              {Icon.info}
              <span>{cue}</span>
              {Icon.chevDown}
            </button>
          )}
          {workout.prescription && (
            <button className="cue" onClick={() => setReading('notes')}>
              {Icon.plan}
              <span>Session notes</span>
              {Icon.chevDown}
            </button>
          )}
        </div>

        <div className="sets-wrap">
          <div className="sets-head">
            <span>
              {setsDone(item, entries)} of {rows} sets
            </span>
            <div className="mini-pm">
              <button type="button" aria-label="Remove the last set" disabled={rows <= 1} onClick={() => remove(rows)}>
                {Icon.minus}
              </button>
              <button type="button" aria-label="Add a set" onClick={onAddSet}>
                {Icon.plus}
              </button>
            </div>
          </div>
          <div className={`sets${rows > 4 ? ' many' : ''}`} style={{ ['--n' as string]: rows }}>
          {range.map((n) => {
            const entry = logged(n);
            const before = last?.sets.find((s) => s.setNo === n);
            const now = n === current;
            const target = item.repsBySet?.[n - 1];
            return (
              <button
                key={n}
                ref={now ? nowRef : undefined}
                type="button"
                className={`set ${now ? 'now' : entry ? 'done' : 'next'}`}
                aria-pressed={now}
                aria-label={`Set ${n}${entry ? `, logged ${tileText(n)}` : ''}`}
                onClick={() => setPicked(slots.find((s) => s.setNo === n && !slotLogged(s)) ?? { setNo: n, side: sides[0] })}
              >
                <span className="set-no">Set {n}</span>
                <span className="set-chip">
                  {now ? (
                    editing ? 'Editing' : slot?.side ? (slot.side === 'L' ? 'Left' : 'Right') : 'Now'
                  ) : entry ? (
                    <>
                      {Icon.check}
                      {tileText(n)}
                    </>
                  ) : target != null ? (
                    `× ${target}`
                  ) : (
                    'Next'
                  )}
                </span>
                {last && <span className="set-last">{before ? `Last ${compactSet(before, exercise.measure)}` : ' '}</span>}
              </button>
            );
          })}
          </div>
        </div>

        {current != null && item.eachSide && (
          <Chips
            className="two"
            options={SIDES}
            value={slot?.side}
            onChange={(side) => side && setPicked({ setNo: current, side })}
            label={(s) => (s === 'L' ? 'Left' : 'Right')}
          />
        )}

        {current != null ? (
          <div className="steppers" style={{ ['--cols' as string]: cols.length }}>
            {cols.map((c) => (
              <Stepper
                key={`${slotKey}:${c.key}`}
                col={c}
                name={exercise.name}
                value={vals[c.key]}
                onType={(v) => type(c.key, v)}
                onBump={(by) => bump(c.key, by)}
              />
            ))}
          </div>
        ) : (
          <div className="all-done">
            <span className="bigcheck">{Icon.check}</span>
            <b>All {rows} sets logged</b>
            <span className="sub">Tap a set above to change it.</span>
          </div>
        )}
      </div>

      <div className="s-foot">
        {current == null ? (
          <>
            <button className="btn primary big block" onClick={isLast ? onWrap : onNext}>
              {isLast ? 'Wrap up' : 'Next exercise'}
              {Icon.arrow}
            </button>
            <button className="quiet" onClick={onAddSet}>
              Add a set
            </button>
          </>
        ) : editing ? (
          <>
            <button className="btn primary big block" onClick={log}>
              Update set {current}
              {sideWord && `, ${sideWord}`}
            </button>
            <button className="quiet" onClick={() => remove(current)}>
              {rows > 1 ? 'Remove this set' : 'Clear this set'}
            </button>
          </>
        ) : (
          <>
            <button className="btn primary big block spread" onClick={log}>
              <span>
                Log set {current}
                {sideWord && `, ${sideWord}`}
              </span>
              <span className="then">
                {closesSet ? nextNote : 'then the other side'}
                {Icon.arrow}
              </span>
            </button>
            <button className="quiet" onClick={isLast ? onWrap : onNext}>
              {isLast ? 'Skip to wrap up' : 'Skip this exercise'}
            </button>
          </>
        )}
      </div>

      {reading === 'cues' && (
        <Sheet title={exercise.name} onClose={() => setReading(undefined)}>
          {item.note && <p>{item.note}</p>}
          {exercise.cues && <p className="prescription">{exercise.cues}</p>}
          {exercise.adjustments && <p className="prescription muted">{exercise.adjustments}</p>}
          <VideoButton exercise={exercise} />
          <Link className="btn" to={`/exercise/${exercise.id}`}>
            Exercise details and history
          </Link>
        </Sheet>
      )}
      {reading === 'notes' && (
        <Sheet title="Session notes" onClose={() => setReading(undefined)}>
          <p className="prescription">{workout.prescription}</p>
        </Sheet>
      )}
    </>
  );
}

/* ── The whole in-progress session ────────────────────────── */

export default function SessionFlow({
  workout: w,
  space,
  sets,
  exercises,
}: {
  workout: Workout;
  space?: Space;
  sets: SetEntry[];
  exercises: Exercise[];
}) {
  const nav = useNavigate();
  const timer = useTimer();
  const { confirm } = useFeedback();
  const ask = useAskClaude();
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));
  const items = w.items.filter((i) => exerciseById.has(i.exerciseId));
  const entriesFor = (item: RoutineItem) => sets.filter((s) => s.itemId === item.id);
  const complete = (item: RoutineItem) => setsDone(item, entriesFor(item)) >= setCount(item, entriesFor(item));

  const [view, setView] = useState<'log' | 'wrap'>('log');
  const [sheet, setSheet] = useState<'options' | 'pick' | 'swap'>();
  const [editList, setEditList] = useState(false);
  const [swapping, setSwapping] = useState<string>();
  // The exercise in view is remembered by identity, so reordering or removing others never moves you.
  const [currentId, setCurrentId] = useState(() => (items.find((i) => !complete(i)) ?? items[items.length - 1])?.id);

  // A finished rest ends itself here, so the next set is simply waiting.
  const restOver = timer.active && timer.name === REST_TIMER && !!timer.position?.done;
  const stopTimer = timer.stop;
  useEffect(() => {
    if (restOver) stopTimer();
  }, [restOver, stopTimer]);

  const focus = w.logStyle === 'sets' && items.length > 0;
  const found = items.findIndex((i) => i.id === currentId);
  const at = found < 0 ? 0 : found;
  const item = items[at];
  const exercise = item && exerciseById.get(item.exerciseId);
  const checked = new Set(w.checked ?? []);

  const patch = (changes: Partial<Workout>) => db.workouts.update(w.id, changes);
  const elapsedMin = Math.round((Date.now() - w.startedAt) / 60000);
  const suggestMinutes = elapsedMin >= 1 && elapsedMin <= 240 ? elapsedMin : undefined;

  const setDate = async (date: string) => {
    await db.transaction('rw', db.workouts, db.sets, async () => {
      await db.workouts.update(w.id, { date });
      await db.sets.where('workoutId').equals(w.id).modify({ date });
    });
  };

  const finish = async (status: 'done' | 'skipped') => {
    if (timer.active && timer.name === REST_TIMER) timer.stop();
    await patch({ status, minutes: status === 'done' ? (w.minutes ?? suggestMinutes) : w.minutes });
    // Land on Today, which now shows the result and what is next; replace so Back does not reopen this.
    nav('/', { replace: true });
  };

  const nameOf = (i: RoutineItem) => exerciseById.get(i.exerciseId)?.name ?? 'Exercise';

  // Exercises that share a group are done in turn: one set of each, then the rest.
  const group = item?.group ? items.filter((i) => i.group === item.group) : item ? [item] : [];
  const restFor = (i: RoutineItem) => i.rest ?? group.find((g) => g.rest)?.rest;
  /** The exercise that follows this one within the round, if any still has sets to do. */
  const turnNext = item ? group.slice(group.indexOf(item) + 1).find((i) => !complete(i)) : undefined;

  /** After a set: on to the next exercise in the round, or rest and go again, or move on. */
  const afterSet = (more: boolean) => {
    if (!item) return;
    if (turnNext) {
      setCurrentId(turnNext.id);
      return;
    }
    const again = group.find((i) => (i.id === item.id ? more : !complete(i)));
    const onward = again ?? items[items.indexOf(group[group.length - 1]) + 1];
    if (!onward) {
      setView('wrap');
      return;
    }
    const rest = restFor(item);
    if (rest) timer.start(countdownPhases(rest), REST_TIMER);
    setCurrentId(onward.id);
  };

  /** Losing logged sets is worth a question first; an untouched exercise just goes. */
  const sureAbout = async (i: RoutineItem, title: string, action: string) => {
    const n = loggedSets(entriesFor(i)).length;
    if (!n) return true;
    return confirm({
      title,
      body: `The ${n} set${n === 1 ? '' : 's'} logged for ${nameOf(i)} will be removed.`,
      action,
      danger: true,
    });
  };

  const dropItem = async (i: RoutineItem) => {
    if (!(await sureAbout(i, `Remove ${nameOf(i)}?`, 'Remove exercise'))) return;
    if (i.id === currentId) setCurrentId((items[at + 1] ?? items[at - 1])?.id);
    await removeItem(w.id, i.id);
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete this session?',
      body: 'Everything logged in it is removed. This cannot be undone.',
      action: 'Delete session',
      danger: true,
    });
    if (ok) {
      await deleteWorkout(w.id);
      nav('/', { replace: true });
    }
  };

  const doneExercises = focus
    ? items.filter((i) => loggedSets(entriesFor(i)).length > 0).length
    : items.filter((i) => checked.has(i.id)).length;
  const setsLogged = loggedSets(sets).length;

  const sub =
    view === 'wrap'
      ? undefined
      : focus
        ? `Exercise ${at + 1} of ${items.length}`
        : items.length
          ? `${doneExercises} of ${items.length} done`
          : space?.name;

  return (
    <div className="session" style={{ ['--space' as string]: space?.color }}>
      <header className="s-head">
        {view === 'wrap' ? (
          <button className="icon-btn" aria-label="Back to the session" onClick={() => setView('log')}>
            {Icon.back}
          </button>
        ) : (
          <button className="icon-btn" aria-label="Close, and keep the session open" onClick={() => nav('/')}>
            {Icon.close}
          </button>
        )}
        <div className="mid">
          <b>{view === 'wrap' ? 'Wrap up' : w.title}</b>
          {sub && <small>{sub}</small>}
        </div>
        {view === 'wrap' ? (
          <span />
        ) : focus ? (
          <button className="finish" onClick={() => setView('wrap')}>
            Finish
          </button>
        ) : (
          <button className="icon-btn end" aria-label="Session options" onClick={() => setSheet('options')}>
            {Icon.more}
          </button>
        )}
      </header>

      {view === 'log' && focus && (
        <div className="steps" role="tablist" aria-label="Exercises in this session">
          {items.map((i, n) => {
            const entries = entriesFor(i);
            const done = loggedSets(entries).length;
            const of = setCount(i, entries);
            return (
              <button
                key={i.id}
                type="button"
                role="tab"
                aria-selected={n === at}
                aria-label={`${nameOf(i)}, ${done} of ${of} sets`}
                className={n === at ? 'here' : ''}
                onClick={() => setCurrentId(i.id)}
              >
                <i>
                  <b style={{ width: `${Math.min(1, done / of) * 100}%` }} />
                </i>
              </button>
            );
          })}
        </div>
      )}

      {view === 'log' && focus && item && exercise && (
        <FocusExercise
          key={item.id}
          workout={w}
          item={item}
          exercise={exercise}
          entries={entriesFor(item)}
          isLast={at === items.length - 1}
          onNext={() => setCurrentId(items[at + 1]?.id)}
          onWrap={() => setView('wrap')}
          onAddSet={() => addSet(w.id, item.id)}
          onSetDone={afterSet}
          groupNote={group.length > 1 ? `${group.length > 2 ? 'Circuit' : 'Superset'}, ${group.indexOf(item) + 1} of ${group.length}` : undefined}
          nextNote={
            turnNext
              ? `then ${nameOf(turnNext)}`
              : restFor(item)
                ? `then rest ${formatSeconds(restFor(item)!)}`
                : ''
          }
          onOptions={() => setSheet('options')}
        />
      )}

      {view === 'log' && !focus && (
        <>
          <div className="s-body top">
            {w.prescription && (
              <div className="card">
                <p className="prescription">{w.prescription}</p>
              </div>
            )}
            {items.length > 0 && (
              <div className="card flush">
                {items.map((i) => {
                  const on = checked.has(i.id);
                  const name = exerciseById.get(i.exerciseId)?.name ?? 'Exercise';
                  return (
                    <div key={i.id} className={`checklist-item${on ? ' on' : ''}`}>
                      <button
                        className={`check${on ? ' on' : ''}`}
                        aria-pressed={on}
                        aria-label={`${on ? 'Untick' : 'Tick'} ${name}`}
                        onClick={() => {
                          const next = new Set(checked);
                          if (on) next.delete(i.id);
                          else next.add(i.id);
                          void patch({ checked: [...next] });
                        }}
                      >
                        {Icon.check}
                      </button>
                      <Link to={`/exercise/${i.exerciseId}`} className="grow">
                        <div className="title">{name}</div>
                        <div className="sub">{[itemSummary(i), i.note].filter(Boolean).join(', ')}</div>
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
            <button className="btn" onClick={() => setSheet('pick')}>
              {Icon.plus}
              Add exercise
            </button>
          </div>
          <div className="s-foot">
            <button className="btn primary big block" onClick={() => setView('wrap')}>
              Wrap up
              {Icon.arrow}
            </button>
          </div>
        </>
      )}

      {view === 'wrap' && (
        <>
          <div className="s-body top wrap">
            <div className="hero-done">
              <span className="bigcheck">{Icon.check}</span>
              <div>
                <h1>{w.title}</h1>
                <p className="sub">{[space?.name, niceDate(w.date)].filter(Boolean).join(', ')}</p>
              </div>
            </div>

            <div className="tiles on-bg">
              <div className="tile">
                <NumInput
                  ariaLabel="Minutes"
                  unit="min"
                  value={w.minutes}
                  placeholder={suggestMinutes != null ? String(suggestMinutes) : ''}
                  onCommit={(v) => patch({ minutes: v })}
                />
                <small>Time</small>
              </div>
              {items.length > 0 && (
                <div className="tile">
                  <b>
                    {doneExercises} of {items.length}
                  </b>
                  <small>Exercises</small>
                </div>
              )}
              {focus && (
                <div className="tile">
                  <b>{setsLogged}</b>
                  <small>Sets</small>
                </div>
              )}
            </div>

            <TrackSummary workout={w} />

            <div className="ask">
              <h2>How hard was it?</h2>
              <Chips
                className="five"
                options={RPE}
                value={w.rpe as (typeof RPE)[number] | undefined}
                onChange={(v) => patch({ rpe: v })}
              />
            </div>

            <div className="ask">
              <h2>How is your back?</h2>
              <Chips
                className="two"
                options={BACK_OPTIONS}
                value={w.backResponse as (typeof BACK_OPTIONS)[number] | undefined}
                onChange={(v) => patch({ backResponse: v })}
              />
            </div>

            <label className="ask">
              <span className="q">Notes</span>
              <textarea
                key={w.id}
                className="input"
                defaultValue={w.notes ?? ''}
                placeholder="Anything worth remembering next time"
                onBlur={(e) => patch({ notes: e.target.value.trim() || undefined })}
              />
            </label>
          </div>
          <div className="s-foot">
            <button className="btn primary big block" onClick={() => finish('done')}>
              Save session
            </button>
          </div>
        </>
      )}

      {sheet === 'options' && (
        <Sheet
          title={w.title}
          onClose={() => {
            setSheet(undefined);
            setEditList(false);
          }}
        >
          {items.length > 0 && (
            <>
              <SectionTitle action={<button onClick={() => setEditList((v) => !v)}>{editList ? 'Done' : 'Change'}</button>}>
                Exercises
              </SectionTitle>
              <div className="card flush">
                {items.map((i, n) => {
                  const entries = entriesFor(i);
                  const isDone = focus ? complete(i) : checked.has(i.id);
                  const label = (
                    <>
                      <span className={`tick${isDone ? ' done' : ''}`}>{isDone ? Icon.check : null}</span>
                      <div className="grow">
                        <div className="title">{nameOf(i)}</div>
                        {focus && (
                          <div className="sub">
                            {loggedSets(entries).length} of {setCount(i, entries)} sets
                          </div>
                        )}
                      </div>
                    </>
                  );
                  if (editList) {
                    return (
                      <div key={i.id} className="row tools">
                        {label}
                        <button className="icon-btn sm" aria-label={`Move ${nameOf(i)} up`} disabled={n === 0} onClick={() => moveItem(w.id, i.id, -1)}>
                          {Icon.chevUp}
                        </button>
                        <button
                          className="icon-btn sm"
                          aria-label={`Move ${nameOf(i)} down`}
                          disabled={n === items.length - 1}
                          onClick={() => moveItem(w.id, i.id, 1)}
                        >
                          {Icon.chevDown}
                        </button>
                        <button
                          className="icon-btn sm"
                          aria-label={`Swap ${nameOf(i)} for another exercise`}
                          onClick={() => {
                            setSwapping(i.id);
                            setSheet('swap');
                          }}
                        >
                          {Icon.swap}
                        </button>
                        <button className="icon-btn sm danger" aria-label={`Remove ${nameOf(i)}`} onClick={() => dropItem(i)}>
                          {Icon.trash}
                        </button>
                      </div>
                    );
                  }
                  return focus ? (
                    <button
                      key={i.id}
                      className="row"
                      aria-current={n === at ? 'step' : undefined}
                      onClick={() => {
                        setCurrentId(i.id);
                        setSheet(undefined);
                      }}
                    >
                      {label}
                      {n === at && <span className="badge">Here</span>}
                    </button>
                  ) : (
                    <div key={i.id} className="row">
                      {label}
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <Field label="Date">
            <input type="date" value={w.date} max={isoDate()} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
          <div className="grid-2">
            <button className="btn" onClick={() => setSheet('pick')}>
              Add exercise
            </button>
            {items.length > 0 && (
              <button
                className="btn"
                onClick={() => {
                  void patch({ logStyle: w.logStyle === 'sets' ? 'session' : 'sets' });
                  setSheet(undefined);
                }}
              >
                {w.logStyle === 'sets' ? 'Tick-off list' : 'Log set by set'}
              </button>
            )}
            <button className="btn" onClick={() => ask(() => buildWorkoutContext(db, w))}>
              Ask Claude
            </button>
            <Link
              className="btn"
              to={`/track/${w.id}${focus && exercise && item && ['distance', 'time'].includes(exercise.measure) ? `?item=${item.id}` : ''}`}
            >
              Track with GPS
            </Link>
            {w.programmeId && (
              <button className="btn" onClick={() => finish('skipped')}>
                Skip session
              </button>
            )}
          </div>
          <button className="btn ghost danger" onClick={remove}>
            Delete session
          </button>
        </Sheet>
      )}

      {sheet === 'pick' && (
        <ExercisePicker
          onClose={() => setSheet(undefined)}
          onPick={(e) => {
            const added = { id: uid(), exerciseId: e.id, sets: 3 };
            void patch({ items: [...w.items, added], logStyle: w.items.length ? w.logStyle : 'sets' });
            if (w.logStyle === 'sets' || !w.items.length) setCurrentId(added.id);
            setSheet(undefined);
          }}
        />
      )}

      {sheet === 'swap' && swapping && (
        <ExercisePicker
          title="Swap exercise"
          onClose={() => setSheet('options')}
          onPick={async (e) => {
            const target = items.find((i) => i.id === swapping);
            setSheet('options');
            if (!target || target.exerciseId === e.id) return;
            if (await sureAbout(target, `Swap ${nameOf(target)}?`, 'Swap exercise')) await swapItem(w.id, target.id, e.id);
          }}
        />
      )}
    </div>
  );
}
