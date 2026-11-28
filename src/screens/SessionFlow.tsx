import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, type Exercise, type Routine, type RoutineItem, type SetEntry, type Side, type Space, type Workout } from '../db/schema';
import { describeParts, formatSeconds, hasValue, lastTime, loadNumber, repsNumber, setsLine } from '../db/queries';
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
  runsOf,
  saveSet,
  setCount,
  setsDone,
  setItemRest,
  SIDES,
  sidesOf,
  swapItem,
  changePlan,
  writeBack,
  type Column,
  type NumKey,
  type SetValues,
} from '../lib/logging';
import { deleteWorkout, getSetting, setSetting, useAskClaude } from '../actions';
import { activityLabel, spaceIconOf, type ActivityKey } from '../lib/activities';
import { routineFromWorkout } from '../lib/planning';
import { ActivityIcon, SpaceIcon } from '../icons';
import { useTimer } from '../timerContext';
import { Block, Chips, Field, Icon, NumInput, SectionTitle, Sheet, parseDuration, useFeedback } from '../ui';
import { ExercisePicker, itemSummary } from './RoutineEdit';
import { VideoButton } from './Exercises';
import TrackSummary, { GpxImport } from './TrackSummary';
import { newRecords } from '../lib/stats';

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

export function FocusExercise({
  workout,
  item,
  exercise,
  entries,
  onFinish,
  onAddSet,
  onPlanChanged,
  onSetDone,
  groupNote,
  nextNote,
  rest,
  onRest,
}: {
  workout: Workout;
  item: RoutineItem;
  exercise: Exercise;
  entries: SetEntry[];
  /** Mark the exercise finished and go back to the routine. */
  onFinish: () => void;
  onAddSet: () => void;
  /** A set was taken away: the routine follows. */
  onPlanChanged: () => void;
  /** A whole set has just been logged. `more` says whether this exercise has sets left. */
  onSetDone: (more: boolean) => void;
  /** "Superset 1 of 2", when this exercise is done in turn with others. */
  groupNote?: string;
  /** What follows a logged set: "then rest 1:30", "then Pull-ups". */
  nextNote: string;
  /** Rest between sets, in seconds. */
  rest?: number;
  /** Lengthen or shorten the rest, by seconds. */
  onRest: (by: number) => void;
}) {
  const timer = useTimer();
  const { toast, confirm } = useFeedback();
  const [picked, setPicked] = useState<Slot>();
  const [draft, setDraft] = useState<Record<string, SetValues>>({});
  const [info, setInfo] = useState(false);
  const [noting, setNoting] = useState(false);
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
    onPlanChanged();
  };

  /** Log every set still open exactly as last time: one tap for a session that repeats the last. */
  const repeatLast = async () => {
    for (const s of slots.filter((x) => !slotLogged(x))) {
      const v = expected(s);
      const fill: SetValues = {};
      for (const c of cols) if (v[c.key] != null) fill[c.key] = v[c.key];
      if (Object.keys(fill).length) await saveSet(workout, item, exercise, s.setNo, fill, s.side);
    }
    setDraft({});
    setPicked(undefined);
  };
  const anyLogged = slots.some((s) => slotLogged(s));

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

  return (
    <>
      <div className="s-body">
        <div className="s-title">
          <h1>{exercise.name}</h1>
          <button className="icon-btn boxed" aria-label={`About ${exercise.name}`} onClick={() => setInfo(true)}>
            {Icon.info}
          </button>
        </div>

        <div className={`sets${rows > 4 ? ' many' : ''}`} style={{ ['--n' as string]: rows }}>
          {range.map((n) => {
            const entry = logged(n);
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
              </button>
            );
          })}
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
          </div>
        )}

        {last && !anyLogged && (
          <button type="button" className="same-last" onClick={repeatLast}>
            {Icon.check}
            <span>
              Same as last time <b>{setsLine(last.sets, exercise.measure)}</b>
            </span>
          </button>
        )}

        <div className="plan-row">
          <div className="rest-row">
            <span>
              Sets <b>{rows}</b>
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
          <div className="rest-row">
            <span>
              Rest <b>{rest ? formatSeconds(rest) : 'none'}</b>
            </span>
            <div className="mini-pm">
              <button type="button" aria-label="15 seconds less rest" disabled={!rest} onClick={() => onRest(-15)}>
                {Icon.minus}
              </button>
              <button type="button" aria-label="15 seconds more rest" onClick={() => onRest(15)}>
                {Icon.plus}
              </button>
            </div>
          </div>
        </div>

        {noting || item.note ? (
          <label className="ex-note">
            <span>Note</span>
            <textarea
              key={item.id}
              className="input"
              rows={2}
              autoFocus={noting && !item.note}
              defaultValue={item.note ?? ''}
              placeholder="A cue or reminder, shown here next time"
              onBlur={async (e) => {
                const note = e.target.value.trim() || undefined;
                if (note !== item.note) {
                  await changePlan(workout.id, item.id, (i) => ({ ...i, note }));
                  onPlanChanged();
                }
                setNoting(false);
              }}
            />
          </label>
        ) : (
          <button type="button" className="quiet-link" onClick={() => setNoting(true)}>
            Add a note
          </button>
        )}
      </div>

      <div className="s-foot">
        {current == null ? (
          <button className="btn primary big block" onClick={onFinish}>
            Finish exercise
            {Icon.check}
          </button>
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
                {/* One tap logs exactly what is shown: last time's numbers unless changed. */}
                {cols.some((c) => vals[c.key] != null) ? `Log ${compactSet(vals, exercise.measure)}` : `Log set ${current}`}
                {sideWord && `, ${sideWord}`}
              </span>
              <span className="then">
                {closesSet ? nextNote : 'then the other side'}
                {Icon.arrow}
              </span>
            </button>
            <button className="quiet" onClick={onFinish}>
              Finish exercise
            </button>
          </>
        )}
      </div>

      {info && (
        // Everything about the exercise that is not needed to log the next set.
        <Sheet title={exercise.name} onClose={() => setInfo(false)}>
          {(summary || groupNote) && <p className="sub">{[summary, groupNote].filter(Boolean).join(' · ')}</p>}
          {last && (
            <div className="lasttime">
              <small>Last time</small>
              <b>{niceDate(last.date)}</b>
              <span>{setsLine(last.sets, exercise.measure)}</span>
            </div>
          )}
          {exercise.parts?.length ? <p>Each round: {describeParts(exercise.parts)}</p> : null}
          {exercise.cues && <p className="prescription">{exercise.cues}</p>}
          {exercise.adjustments && <p className="prescription muted">{exercise.adjustments}</p>}
          {workout.prescription && (
            <div className="lasttime">
              <small>Session notes</small>
              <p className="prescription">{workout.prescription}</p>
            </div>
          )}

          <VideoButton exercise={exercise} />
          <Link className="btn" to={`/exercise/${exercise.id}`}>
            Exercise details and history
          </Link>
        </Sheet>
      )}
    </>
  );
}

/* ── Moving about: every screen is a real step in history ─── */

/** Back one step, as the system back gesture would; to `fallback` when the screen was opened directly. */
export function useBack(fallback: string): () => void {
  const nav = useNavigate();
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) nav(-1);
    else nav(fallback, { replace: true });
  }, [nav, fallback]);
}

/** Says once, ever, that changing the plan here changes the routine too. */
function useSavedHint(): (saved: boolean) => Promise<void> {
  const { toast } = useFeedback();
  return useCallback(
    async (saved: boolean) => {
      if (!saved || (await getSetting<boolean>(SAVED_HINT))) return;
      await setSetting(SAVED_HINT, true);
      toast('Saved for next time, in the routine too.');
    },
    [toast],
  );
}

const SAVED_HINT = 'hint-saved-for-next-time';

/** Finished: ticked by hand, or every set logged in a set-by-set session. */
export function itemFinished(w: Workout, item: RoutineItem, entries: SetEntry[]): boolean {
  if (w.checked?.includes(item.id)) return true;
  if (w.logStyle !== 'sets') return false;
  const done = setsDone(item, entries);
  return done > 0 && done >= setCount(item, entries);
}

/** A rest under way, shown wherever the session is. */
function RestBar() {
  const timer = useTimer();
  const pos = timer.position;
  if (!timer.active || timer.name !== REST_TIMER || !pos || pos.done) return null;
  return (
    <div className="rest-bar">
      <span>Rest</span>
      <b role="timer" aria-live="off">
        {formatSeconds(Math.ceil(pos.remaining))}
      </b>
      <button className="icon-btn" aria-label="Skip the rest" onClick={timer.stop}>
        {Icon.close}
      </button>
    </div>
  );
}

/* ── The routine screen: the day's exercises, nothing to type ── */

export function RoutineList({
  workout: w,
  routine,
  title,
  space,
  activity,
  exercises,
  sets,
  onStart,
  locked,
}: {
  /** The session, once there is one. Before that the routine's own list is shown. */
  workout?: Workout;
  routine?: Routine;
  title: string;
  space?: Space;
  activity?: ActivityKey;
  exercises: Exercise[];
  sets: SetEntry[];
  /** Begin the session, giving back its id: called on the first tap of an exercise. */
  onStart?: () => Promise<string>;
  /** A day still to come: shown, but not started. */
  locked?: boolean;
}) {
  const nav = useNavigate();
  const back = useBack('/');
  const timer = useTimer();
  const { confirm, toast } = useFeedback();
  const ask = useAskClaude();
  const [sheet, setSheet] = useState<'wrap' | 'details' | 'pick' | 'swap'>();
  const [editList, setEditList] = useState(false);
  const [swapping, setSwapping] = useState<string>();
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));
  const items = (w?.items ?? routine?.items ?? []).filter((i) => exerciseById.has(i.exerciseId));
  const entriesFor = (i: RoutineItem) => sets.filter((s) => s.itemId === i.id);
  const nameOf = (i: RoutineItem) => exerciseById.get(i.exerciseId)?.name ?? 'Exercise';
  const live = !w || w.status === 'in_progress';

  // One line of "last time" for each exercise: what was done, and when.
  const lastFor = useLiveQuery(async () => {
    const ids = [...new Set(items.map((i) => i.exerciseId))];
    const found = await Promise.all(ids.map((id) => lastTime(db, id, w ? { workoutId: w.id } : undefined)));
    return new Map(ids.map((id, k) => [id, found[k]]));
  }, [items.map((i) => i.exerciseId).join(), w?.id]);

  // On the wrap-up, say what this session beat.
  const beaten = useLiveQuery(async () => {
    if (sheet !== 'wrap' || !w) return [];
    const ids = [...new Set(w.items.map((i) => i.exerciseId))];
    const [workouts, history] = await Promise.all([db.workouts.toArray(), db.sets.where('exerciseId').anyOf(ids).toArray()]);
    return newRecords({ workouts, sets: history, tracks: [] }, w.id, exercises.filter((e) => ids.includes(e.id)));
  }, [sheet, w?.id, sets.length]);

  const open = async (item: RoutineItem) => {
    if (locked) return;
    const id = w?.id ?? (await onStart?.());
    if (id) nav(`/workout/${id}/exercise/${item.id}`);
  };

  const patch = (changes: Partial<Workout>) => (w ? db.workouts.update(w.id, changes) : Promise.resolve(0));
  const elapsedMin = w ? Math.round((Date.now() - w.startedAt) / 60000) : 0;
  const suggestMinutes = elapsedMin >= 1 && elapsedMin <= 240 ? elapsedMin : undefined;

  const finish = async (status: 'done' | 'skipped') => {
    const id = w?.id ?? (await onStart?.());
    if (!id) return;
    if (timer.active && timer.name === REST_TIMER) timer.stop();
    const current = await db.workouts.get(id);
    await db.workouts.update(id, { status, minutes: status === 'done' ? (current?.minutes ?? suggestMinutes) : current?.minutes });
    setSheet(undefined);
    back();
  };

  const setDate = async (date: string) => {
    if (!w) return;
    await db.transaction('rw', db.workouts, db.sets, async () => {
      await db.workouts.update(w.id, { date });
      await db.sets.where('workoutId').equals(w.id).modify({ date });
    });
  };

  const sureAbout = async (i: RoutineItem, heading: string, action: string) => {
    const n = loggedSets(entriesFor(i)).length;
    if (!n) return true;
    return confirm({ title: heading, body: `The ${n} set${n === 1 ? '' : 's'} logged for ${nameOf(i)} will be removed.`, action, danger: true });
  };
  const dropItem = async (i: RoutineItem) => {
    if (w && (await sureAbout(i, `Remove ${nameOf(i)}?`, 'Remove exercise'))) await removeItem(w.id, i.id);
  };
  const remove = async () => {
    if (!w) return;
    const ok = await confirm({
      title: 'Delete this session?',
      body: 'Everything logged in it is removed. This cannot be undone.',
      action: 'Delete session',
      danger: true,
    });
    if (ok) {
      await deleteWorkout(w.id);
      back();
    }
  };

  const blockFor = (i: RoutineItem) => {
    const ex = exerciseById.get(i.exerciseId)!;
    const last = lastFor?.get(i.exerciseId);
    const entries = entriesFor(i);
    const done = !!w && itemFinished(w, i, entries);
    const logged = w?.logStyle === 'sets' ? setsDone(i, entries) : 0;
    const sub = last ? `${setsLine(last.sets, ex.measure)} · ${niceDate(last.date).replace(/^\w+ /, '')}` : itemSummary(i) || 'Not done before';
    return (
      <Block
        key={i.id}
        title={ex.name}
        sub={sub}
        done={done}
        progress={!done && logged ? { done: logged, of: setCount(i, entries) } : undefined}
        ariaLabel={`${ex.name}${done ? ', finished' : ''}. Last time: ${sub}`}
        onClick={locked ? undefined : () => void open(i)}
      />
    );
  };

  return (
    <div className="session list" style={{ ['--space' as string]: space?.color }}>
      <header className="s-head">
        <button className="icon-btn" aria-label="Back" onClick={back}>
          {Icon.back}
        </button>
        <div className="mid">
          <b>{title}</b>
        </div>
        {w && (
          <button className="icon-btn" aria-label="Session details" onClick={() => setSheet('details')}>
            {Icon.more}
          </button>
        )}
      </header>

      <div className="s-body top">
        <div className="day-meta">
          {activity && (
            <span className="day-act">
              {ActivityIcon[activity]}
              {activityLabel(activity)}
            </span>
          )}
          {space && (
            <span className="day-act">
              {SpaceIcon[spaceIconOf(space)]}
              {space.name}
            </span>
          )}
          {w && w.status !== 'in_progress' && (
            <span className={`day-act plain${w.status === 'done' ? ' ok' : ''}`}>
              {w.status === 'done' ? 'Done' : 'Skipped'} {niceDate(w.date)}
            </span>
          )}
          {locked && <span className="day-act plain">Coming up</span>}
        </div>

        <RestBar />

        {!items.length && (w?.prescription ?? routine?.description) && <p className="prescription">{w?.prescription ?? routine?.description}</p>}

        {items.length > 0 && (
          <div className="blocks">
            {runsOf(items).map((run) =>
              run.length > 1 ? (
                <div key={run[0].id} className="block-group">
                  {run.map(blockFor)}
                </div>
              ) : (
                blockFor(run[0])
              ),
            )}
          </div>
        )}

        {w && <TrackSummary workout={w} />}
      </div>

      {live && !locked && (
        <div className="s-foot">
          <button className="btn primary big block" onClick={() => setSheet('wrap')}>
            Finish session
          </button>
        </div>
      )}

      {sheet === 'wrap' && (
        <Sheet title="How did it go?" onClose={() => setSheet(undefined)}>
          {beaten && beaten.length > 0 && (
            <div className="card stack records-card">
              <b>New personal best{beaten.length === 1 ? '' : 's'}</b>
              {beaten.map((line) => (
                <span key={line} className="sub">
                  {line}
                </span>
              ))}
            </div>
          )}
          <div className="ask">
            <h2>How hard was it?</h2>
            <Chips className="five" options={RPE} value={w?.rpe as (typeof RPE)[number] | undefined} onChange={(v) => patch({ rpe: v })} />
          </div>
          <div className="ask">
            <h2>How is your back?</h2>
            <Chips
              className="two"
              options={BACK_OPTIONS}
              value={w?.backResponse as (typeof BACK_OPTIONS)[number] | undefined}
              onChange={(v) => patch({ backResponse: v })}
            />
          </div>
          {w && (
            <label className="ask">
              <span className="q">Notes</span>
              <textarea
                className="input"
                defaultValue={w.notes ?? ''}
                placeholder="Anything worth remembering next time"
                onBlur={(e) => patch({ notes: e.target.value.trim() || undefined })}
              />
            </label>
          )}
          <button className="btn primary big block" onClick={() => finish('done')}>
            Save session
          </button>
        </Sheet>
      )}

      {sheet === 'details' && w && (
        <Sheet
          title={w.title}
          onClose={() => {
            setSheet(undefined);
            setEditList(false);
          }}
        >
          {items.length > 0 && w.prescription && <p className="prescription">{w.prescription}</p>}

          {w.status !== 'in_progress' && (
            <>
              <div className="grid-2">
                <Field label="Time (min)">
                  <NumInput ariaLabel="Minutes" unit="min" value={w.minutes} onCommit={(v) => patch({ minutes: v })} />
                </Field>
                <Field label="Date">
                  <input type="date" value={w.date} max={isoDate()} onChange={(e) => e.target.value && setDate(e.target.value)} />
                </Field>
              </div>
              <div className="field">
                <span>Effort (RPE)</span>
                <Chips className="five" options={RPE} value={w.rpe as (typeof RPE)[number] | undefined} onChange={(v) => patch({ rpe: v })} />
              </div>
              <div className="field">
                <span>Back response</span>
                <Chips
                  className="two"
                  options={BACK_OPTIONS}
                  value={w.backResponse as (typeof BACK_OPTIONS)[number] | undefined}
                  onChange={(v) => patch({ backResponse: v })}
                />
              </div>
              <Field label="Notes">
                <textarea
                  defaultValue={w.notes ?? ''}
                  placeholder="Anything worth remembering next time"
                  onBlur={(e) => patch({ notes: e.target.value.trim() || undefined })}
                />
              </Field>
              {w.autoClosed && <p className="sub">Closed by the app at the end of its day.</p>}
            </>
          )}

          {items.length > 0 && (
            <>
              <SectionTitle action={<button onClick={() => setEditList((v) => !v)}>{editList ? 'Done' : 'Change'}</button>}>
                Exercises
              </SectionTitle>
              {editList && (
                <div className="card flush">
                  {items.map((i, n) => (
                    <div key={i.id} className="row tools">
                      <div className="grow">
                        <div className="title">{nameOf(i)}</div>
                      </div>
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
                  ))}
                </div>
              )}
            </>
          )}

          {w.status === 'in_progress' && (
            <Field label="Date">
              <input type="date" value={w.date} max={isoDate()} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </Field>
          )}
          <div className="grid-2">
            <button className="btn" onClick={() => setSheet('pick')}>
              Add exercise
            </button>
            {items.length > 0 && (
              <button className="btn" onClick={() => void patch({ logStyle: w.logStyle === 'sets' ? 'session' : 'sets' })}>
                {w.logStyle === 'sets' ? 'Tick-off list' : 'Log set by set'}
              </button>
            )}
            {w.status !== 'in_progress' && (
              <button className="btn" onClick={() => void patch({ status: 'in_progress', autoClosed: undefined })}>
                Reopen
              </button>
            )}
            {!w.routineId && items.length > 0 && (
              <button
                className="btn"
                onClick={async () => {
                  const r = routineFromWorkout(w, await db.routines.where('spaceId').equals(w.spaceId).count());
                  await db.routines.add(r);
                  toast('Saved as a routine.');
                  nav(`/routine/${r.id}`);
                }}
              >
                Save as routine
              </button>
            )}
            <button className="btn" onClick={() => ask(() => buildWorkoutContext(db, w))}>
              Ask Claude
            </button>
            <Link className="btn" to={`/track/${w.id}`}>
              Track with GPS
            </Link>
            {w.status !== 'in_progress' && <GpxImport workout={w} label="Add a GPX route" />}
            {w.programmeId && w.status === 'in_progress' && (
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

      {sheet === 'pick' && w && (
        <ExercisePicker
          spaceId={w.spaceId}
          onClose={() => setSheet('details')}
          onPick={(e) => {
            void patch({ items: [...w.items, { id: uid(), exerciseId: e.id, sets: 3 }], logStyle: w.items.length ? w.logStyle : 'sets' });
            setSheet(undefined);
          }}
        />
      )}

      {sheet === 'swap' && swapping && w && (
        <ExercisePicker
          spaceId={w.spaceId}
          title="Swap exercise"
          onClose={() => setSheet('details')}
          onPick={async (e) => {
            const target = items.find((i) => i.id === swapping);
            setSheet('details');
            if (!target || target.exerciseId === e.id) return;
            if (await sureAbout(target, `Swap ${nameOf(target)}?`, 'Swap exercise')) await swapItem(w.id, target.id, e.id);
          }}
        />
      )}
    </div>
  );
}

/* ── The exercise screen: the only place with inputs ──────── */

export function ExerciseFlow({
  workout: w,
  startId,
  space,
  sets,
  exercises,
}: {
  workout: Workout;
  /** The exercise opened. A superset moves between its exercises here, without leaving the screen. */
  startId: string;
  space?: Space;
  sets: SetEntry[];
  exercises: Exercise[];
}) {
  const timer = useTimer();
  const { toast } = useFeedback();
  const savedHint = useSavedHint();
  const back = useBack(`/workout/${w.id}`);
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));
  const items = w.items.filter((i) => exerciseById.has(i.exerciseId));
  const entriesFor = (item: RoutineItem) => sets.filter((s) => s.itemId === item.id);
  const complete = (item: RoutineItem) => setsDone(item, entriesFor(item)) >= setCount(item, entriesFor(item));
  const [currentId, setCurrentId] = useState(startId);
  const live = w.status === 'in_progress';

  // A finished rest ends itself, so the next set is simply waiting.
  const restOver = timer.active && timer.name === REST_TIMER && !!timer.position?.done;
  const stopTimer = timer.stop;
  useEffect(() => {
    if (restOver) stopTimer();
  }, [restOver, stopTimer]);

  const item = items.find((i) => i.id === currentId) ?? items.find((i) => i.id === startId);
  const exercise = item && exerciseById.get(item.exerciseId);
  if (!item || !exercise) {
    return (
      <div className="session">
        <header className="s-head">
          <button className="icon-btn" aria-label="Back" onClick={back}>
            {Icon.back}
          </button>
        </header>
        <div className="s-body top">
          <div className="empty">This exercise is no longer in the session.</div>
        </div>
      </div>
    );
  }

  const nameOf = (i: RoutineItem) => exerciseById.get(i.exerciseId)?.name ?? 'Exercise';
  const group = item.group ? items.filter((i) => i.group === item.group) : [item];
  const restFor = (i: RoutineItem) => i.rest ?? group.find((g) => g.rest)?.rest;
  const turnNext = group.slice(group.indexOf(item) + 1).find((i) => !complete(i));

  const changeRest = async (i: RoutineItem, by: number) => {
    const next = Math.min(600, Math.max(0, (restFor(i) ?? 0) + by)) || undefined;
    const saved = await setItemRest(w.id, i.id, next);
    if (!saved) toast(`${next ? `Rest ${formatSeconds(next)}` : 'No rest'} for this session.`);
    else await savedHint(true);
  };

  /** After a set: the next exercise in the round, or rest and go again. Finishing is left to you. */
  const afterSet = (more: boolean) => {
    if (turnNext) {
      setCurrentId(turnNext.id);
      return;
    }
    const again = group.find((i) => (i.id === item.id ? more : !complete(i)));
    if (!again) return;
    const rest = restFor(item);
    if (rest && live) timer.start(countdownPhases(rest), REST_TIMER);
    setCurrentId(again.id);
  };

  /** Tick the exercise (and the rest of its superset) and go back to the list, resting on the way if due. */
  const finishExercise = async () => {
    const fresh = await db.workouts.get(w.id);
    const ticked = new Set(fresh?.checked ?? []);
    for (const g of group) ticked.add(g.id);
    await db.workouts.update(w.id, { checked: [...ticked] });
    const rest = restFor(item);
    const othersLeft = items.some((i) => !group.includes(i) && !ticked.has(i.id) && !complete(i));
    if (rest && live && othersLeft && !(timer.active && timer.name === REST_TIMER)) timer.start(countdownPhases(rest), REST_TIMER);
    back();
  };

  return (
    <div className="session" style={{ ['--space' as string]: space?.color }}>
      <header className="s-head">
        <button className="icon-btn" aria-label={`Back to ${w.title}`} onClick={back}>
          {Icon.back}
        </button>
        <div className="mid">
          <b>{w.title}</b>
          {group.length > 1 && <small>{`${group.length > 2 ? 'Circuit' : 'Superset'}, ${group.indexOf(item) + 1} of ${group.length}`}</small>}
        </div>
      </header>

      {w.logStyle === 'sets' ? (
        <FocusExercise
          key={item.id}
          workout={w}
          item={item}
          exercise={exercise}
          entries={entriesFor(item)}
          onFinish={() => void finishExercise()}
          onAddSet={async () => {
            await addSet(w.id, item.id);
            await savedHint(await writeBack(w.id, item.id));
          }}
          onPlanChanged={async () => savedHint(await writeBack(w.id, item.id))}
          onSetDone={afterSet}
          groupNote={group.length > 1 ? `${group.length > 2 ? 'Circuit' : 'Superset'}, ${group.indexOf(item) + 1} of ${group.length}` : undefined}
          nextNote={turnNext ? `then ${nameOf(turnNext)}` : restFor(item) ? `then rest ${formatSeconds(restFor(item)!)}` : ''}
          rest={restFor(item)}
          onRest={(by) => void changeRest(item, by)}
        />
      ) : (
        // A tick-off session: nothing to type, only what to do.
        <>
          <div className="s-body">
            <div className="s-title">
              <h1>{exercise.name}</h1>
            </div>
            {itemSummary(item) && <p className="s-target">{itemSummary(item)}</p>}
            {item.note && <p className="prescription">{item.note}</p>}
            {exercise.cues && <p className="prescription muted">{exercise.cues}</p>}
            <VideoButton exercise={exercise} />
          </div>
          <div className="s-foot">
            <button className="btn primary big block" onClick={() => void finishExercise()}>
              Finish exercise
              {Icon.check}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
