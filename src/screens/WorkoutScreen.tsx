import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, type Exercise, type RoutineItem, type SetEntry, type Side, type Workout } from '../db/schema';
import { formatSet, hasValue, lastTime, loadNumber, repsNumber, summariseSets } from '../db/queries';
import { isoDate, niceDate, relativeDay } from '../lib/dates';
import { buildWorkoutContext } from '../lib/claude';
import { BACK_OPTIONS, COLUMNS, RPE, addSet, fmtDuration, removeSet, saveSet, setCount, sidesOf, type NumKey } from '../lib/logging';
import { deleteWorkout, useAskClaude } from '../actions';
import { Chips, Field, Icon, NumInput, Page, SectionTitle, parseDuration, useFeedback } from '../ui';
import { ExercisePicker, itemSummary } from './RoutineEdit';
import SessionFlow from './SessionFlow';
import TrackSummary, { GpxImport } from './TrackSummary';

/** Every set of one exercise as an editable table: the record of a finished session. */
function ExerciseCard({
  workout,
  item,
  exercise,
  entries,
}: {
  workout: Workout;
  item: RoutineItem;
  exercise: Exercise;
  entries: SetEntry[];
}) {
  const { toast, confirm } = useFeedback();
  const last = useLiveQuery(() => lastTime(db, exercise.id, { workoutId: workout.id }), [exercise.id, workout.id]);
  const cols = COLUMNS[exercise.measure];
  const rows = setCount(item, entries);

  // What a set is expected to be: the same set last time, else last time's final set, else the plan.
  const expected = (setNo: number): Partial<Record<NumKey, number>> => {
    const prev = last?.sets.find((s) => s.setNo === setNo) ?? last?.sets[last.sets.length - 1];
    return {
      weight: prev?.weight ?? loadNumber(item.load),
      reps: prev?.reps ?? repsNumber(item.reps),
      seconds: prev?.seconds,
      metres: prev?.metres,
    };
  };

  const toggle = async (setNo: number, side?: Side) => {
    const current = entries.find((e) => e.setNo === setNo && e.side === side);
    if (current && hasValue(current)) {
      // A logged set is a record: un-logging it is asked about, never a slip of the thumb.
      const ok = await confirm({
        title: `Clear set ${setNo}?`,
        body: `${formatSet(current, exercise.measure)} will be removed from this session.`,
        action: 'Clear set',
        danger: true,
      });
      if (ok) await db.sets.delete(current.id);
      return;
    }
    const exp = expected(setNo);
    const fill: Partial<Record<NumKey, number>> = {};
    for (const c of cols) if (exp[c.key] != null) fill[c.key] = exp[c.key];
    if (!Object.keys(fill).length) {
      toast('Enter a value first.');
      return;
    }
    await saveSet(workout, item, exercise, setNo, fill, side);
  };

  const dropLast = async () => {
    const entry = entries.find((e) => e.setNo === rows && hasValue(e));
    if (entry) {
      const ok = await confirm({
        title: `Remove set ${rows}?`,
        body: `It has ${formatSet(entry, exercise.measure)} logged.`,
        action: 'Remove set',
        danger: true,
      });
      if (!ok) return;
    }
    await removeSet(workout.id, item.id, rows);
  };

  const summary = itemSummary(item);

  return (
    <div className="card ex-card">
      <div className="spread">
        <div>
          <h3>{exercise.name}</h3>
          {summary && <div className="ex-meta">{summary}</div>}
        </div>
        <Link to={`/exercise/${exercise.id}`} className="icon-btn" aria-label={`${exercise.name} details`}>
          {Icon.chevRight}
        </Link>
      </div>

      {last && (
        <div className="last">
          Last time ({relativeDay(last.date).toLowerCase()}): {summariseSets(last.sets, exercise.measure)}
        </div>
      )}

      <div className="stack" style={{ ['--cols' as string]: cols.length, gap: 8 }}>
        {Array.from({ length: rows }, (_, i) => i + 1).flatMap((setNo) => sidesOf(item).map((side) => ({ setNo, side }))).map(({ setNo, side }) => {
          const entry = entries.find((e) => e.setNo === setNo && e.side === side);
          const exp = expected(setNo);
          const on = !!entry && hasValue(entry);
          return (
            <div key={`${setNo}${side ?? ''}`} className="set-row">
              <span className="no">
                {setNo}
                {side}
              </span>
              {cols.map((c) => (
                <NumInput
                  key={c.key}
                  ariaLabel={`${exercise.name} set ${setNo}${side ? ` ${side === 'L' ? 'left' : 'right'}` : ''} ${c.label}`}
                  unit={c.unit}
                  value={entry?.[c.key]}
                  placeholder={
                    exp[c.key] != null ? (c.key === 'seconds' ? fmtDuration(exp[c.key]!) : String(exp[c.key])) : ''
                  }
                  parse={c.key === 'seconds' ? parseDuration : undefined}
                  format={c.key === 'seconds' ? fmtDuration : undefined}
                  onCommit={(v) => saveSet(workout, item, exercise, setNo, { [c.key]: v }, side)}
                />
              ))}
              <button
                className={`check${on ? ' on' : ''}`}
                aria-label={`${on ? 'Clear' : 'Complete'} set ${setNo}`}
                aria-pressed={on}
                onClick={() => toggle(setNo, side)}
              >
                {Icon.check}
              </button>
            </div>
          );
        })}
      </div>

      <div className="inline">
        <button className="btn small ghost" onClick={() => addSet(workout.id, item.id)}>
          Add a set
        </button>
        {rows > 1 && (
          <button className="btn small ghost" onClick={dropLast}>
            Remove last set
          </button>
        )}
      </div>
    </div>
  );
}

export default function WorkoutScreen() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { confirm } = useFeedback();
  const ask = useAskClaude();
  const [picking, setPicking] = useState(false);

  const data = useLiveQuery(async () => {
    const workout = await db.workouts.get(id);
    if (!workout) return { workout: null };
    const [space, sets, exercises] = await Promise.all([
      db.spaces.get(workout.spaceId),
      db.sets.where('workoutId').equals(id).toArray(),
      db.exercises.toArray(),
    ]);
    return { workout, space, sets, exercises };
  }, [id]);

  if (!data) return null;
  if (!data.workout) {
    return (
      <Page title="Session" back="/">
        <div className="empty">This session no longer exists.</div>
      </Page>
    );
  }
  const { workout: w, space, sets = [], exercises = [] } = data;

  // While a session is under way it is a guided flow; afterwards it is a record you can correct.
  if (w.status === 'in_progress') return <SessionFlow workout={w} space={space} sets={sets} exercises={exercises} />;

  const exerciseById = new Map(exercises.map((e) => [e.id, e]));
  const patch = (changes: Partial<Workout>) => db.workouts.update(id, changes);
  const checked = new Set(w.checked ?? []);

  const setDate = async (date: string) => {
    await db.transaction('rw', db.workouts, db.sets, async () => {
      await db.workouts.update(id, { date });
      await db.sets.where('workoutId').equals(id).modify({ date });
    });
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete this session?',
      body: 'Everything logged in it is removed. This cannot be undone.',
      action: 'Delete session',
      danger: true,
    });
    if (ok) {
      await deleteWorkout(id);
      nav(-1);
    }
  };

  return (
    <div style={{ ['--space' as string]: space?.color }}>
      <Page
        title={w.title}
        kicker={[space?.name, niceDate(w.date)].filter(Boolean).join(', ')}
        back
        actions={<span className={`badge ${w.status === 'done' ? 'ok' : ''}`}>{w.status === 'done' ? 'Done' : 'Skipped'}</span>}
      >
        <div className="tiles on-bg">
          <div className="tile">
            <NumInput ariaLabel="Minutes" unit="min" value={w.minutes} onCommit={(v) => patch({ minutes: v })} />
            <small>Time</small>
          </div>
          <div className="tile">
            <b>{w.rpe != null ? `RPE ${w.rpe}` : 'Not set'}</b>
            <small>Effort</small>
          </div>
          <div className="tile">
            <b>{w.backResponse ?? 'Not set'}</b>
            <small>Back</small>
          </div>
        </div>

        {w.prescription && (
          <div className="card">
            <p className="prescription">{w.prescription}</p>
          </div>
        )}

        <TrackSummary workout={w} />

        {w.logStyle === 'sets' ? (
          w.items.map((item) => {
            const exercise = exerciseById.get(item.exerciseId);
            if (!exercise) return null;
            return (
              <ExerciseCard
                key={item.id}
                workout={w}
                item={item}
                exercise={exercise}
                entries={sets.filter((s) => s.itemId === item.id)}
              />
            );
          })
        ) : w.items.length > 0 ? (
          <div className="card flush">
            {w.items.map((item) => {
              const exercise = exerciseById.get(item.exerciseId);
              const on = checked.has(item.id);
              return (
                <div key={item.id} className={`checklist-item${on ? ' on' : ''}`}>
                  <button
                    className={`check${on ? ' on' : ''}`}
                    aria-pressed={on}
                    aria-label={`${on ? 'Untick' : 'Tick'} ${exercise?.name ?? 'exercise'}`}
                    onClick={() => {
                      const next = new Set(checked);
                      if (on) next.delete(item.id);
                      else next.add(item.id);
                      void patch({ checked: [...next] });
                    }}
                  >
                    {Icon.check}
                  </button>
                  <Link to={`/exercise/${item.exerciseId}`} className="grow">
                    <div className="title">{exercise?.name ?? 'Unknown exercise'}</div>
                    <div className="sub">{[itemSummary(item), item.note].filter(Boolean).join(', ')}</div>
                  </Link>
                </div>
              );
            })}
          </div>
        ) : null}

        <SectionTitle>How it went</SectionTitle>
        <div className="card stack">
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
              key={w.id}
              defaultValue={w.notes ?? ''}
              placeholder="Anything worth remembering next time"
              onBlur={(e) => patch({ notes: e.target.value.trim() || undefined })}
            />
          </Field>
          <Field label="Date">
            <input type="date" value={w.date} max={isoDate()} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
        </div>

        <div className="grid-2">
          <button className="btn" onClick={() => patch({ status: 'in_progress' })}>
            Reopen
          </button>
          <button className="btn" onClick={() => setPicking(true)}>
            Add exercise
          </button>
          <GpxImport workout={w} label="Add a GPX route" />
          <button className="btn ghost" onClick={() => ask(() => buildWorkoutContext(db, w))}>
            Ask Claude
          </button>
          <button className="btn ghost danger" onClick={remove}>
            Delete
          </button>
        </div>

        {picking && (
          <ExercisePicker
            onClose={() => setPicking(false)}
            onPick={(e) => {
              void patch({ items: [...w.items, { id: uid(), exerciseId: e.id, sets: 3 }], logStyle: w.items.length ? w.logStyle : 'sets' });
              setPicking(false);
            }}
          />
        )}
      </Page>
    </div>
  );
}
