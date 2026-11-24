import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, type Exercise, type RoutineItem, type SetEntry, type Workout } from '../db/schema';
import { formatSeconds, hasValue, lastTime, loadNumber, repsNumber, summariseSets } from '../db/queries';
import { isoDate, niceDate, relativeDay } from '../lib/dates';
import { countdownPhases } from '../lib/timer';
import { buildWorkoutContext } from '../lib/claude';
import { deleteWorkout, useAskClaude } from '../actions';
import { useTimer } from '../timerContext';
import { Chips, Field, NumInput, Page, SectionTitle, parseDuration, useFeedback } from '../ui';
import { ExercisePicker, itemSummary } from './RoutineEdit';

type NumKey = 'weight' | 'reps' | 'seconds' | 'metres';

interface Column {
  key: NumKey;
  unit: string;
  label: string;
}

const COLUMNS: Record<Exercise['measure'], Column[]> = {
  weight_reps: [
    { key: 'weight', unit: 'kg', label: 'Weight' },
    { key: 'reps', unit: 'reps', label: 'Reps' },
  ],
  reps: [{ key: 'reps', unit: 'reps', label: 'Reps' }],
  rounds: [
    { key: 'reps', unit: 'rds', label: 'Rounds' },
    { key: 'weight', unit: 'kg', label: 'Weight' },
  ],
  time: [{ key: 'seconds', unit: 'sec', label: 'Time' }],
  distance: [
    { key: 'metres', unit: 'm', label: 'Distance' },
    { key: 'weight', unit: 'kg', label: 'Weight' },
  ],
};

const BACK_OPTIONS = ['Fine', 'Aware of it', 'Sore', 'Flare-up'] as const;
const RPE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

const entryId = (workoutId: string, itemId: string, setNo: number) => `${workoutId}:${itemId}:${setNo}`;
const fmtDuration = (n: number) => (n >= 60 ? formatSeconds(n) : String(n));

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
  const timer = useTimer();
  const { toast } = useFeedback();
  const [extra, setExtra] = useState(0);
  const last = useLiveQuery(() => lastTime(db, exercise.id, { workoutId: workout.id }), [exercise.id, workout.id]);
  const cols = COLUMNS[exercise.measure];
  const maxLogged = entries.reduce((m, e) => Math.max(m, e.setNo), 0);
  const rows = Math.max(item.sets ?? 1, maxLogged) + extra;

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

  const save = async (setNo: number, changes: Partial<Record<NumKey, number | undefined>>) => {
    const id = entryId(workout.id, item.id, setNo);
    // Merge against the stored row, not the rendered one: two fields committed in quick
    // succession would otherwise each start from a stale copy and the second would drop the first.
    await db.transaction('rw', db.sets, async () => {
      const current = await db.sets.get(id);
      const next: SetEntry = {
        id,
        workoutId: workout.id,
        exerciseId: exercise.id,
        itemId: item.id,
        date: workout.date,
        setNo,
        ...current,
        ...changes,
      };
      if (hasValue(next)) await db.sets.put(next);
      else await db.sets.delete(id);
    });
  };

  const toggle = async (setNo: number) => {
    const current = entries.find((e) => e.setNo === setNo);
    if (current && hasValue(current)) {
      await db.sets.delete(current.id);
      return;
    }
    const exp = expected(setNo);
    const fill: Partial<Record<NumKey, number>> = {};
    for (const c of cols) if (exp[c.key] != null) fill[c.key] = exp[c.key];
    if (!Object.keys(fill).length) {
      toast('Enter a value first.');
      return;
    }
    await save(setNo, fill);
    if (item.rest) timer.start(countdownPhases(item.rest), 'Rest');
  };

  const summary = itemSummary(item);

  return (
    <div className="card ex-card">
      <div>
        <div className="spread">
          <h3>{exercise.name}</h3>
          <Link to={`/exercise/${exercise.id}`} className="sub link">
            Details
          </Link>
        </div>
        {summary && <div className="ex-meta">{summary}</div>}
        {item.note && <div className="ex-meta">{item.note}</div>}
      </div>

      {last && (
        <div className="last">
          Last time ({relativeDay(last.date).toLowerCase()}): {summariseSets(last.sets, exercise.measure)}
        </div>
      )}

      <div className="stack" style={{ ['--cols' as string]: cols.length, gap: 8 }}>
        {Array.from({ length: rows }, (_, i) => i + 1).map((setNo) => {
          const entry = entries.find((e) => e.setNo === setNo);
          const exp = expected(setNo);
          const on = !!entry && hasValue(entry);
          return (
            <div key={setNo} className="set-row">
              <span className="no">{setNo}</span>
              {cols.map((c) => (
                <NumInput
                  key={c.key}
                  ariaLabel={`${exercise.name} set ${setNo} ${c.label}`}
                  unit={c.unit}
                  value={entry?.[c.key]}
                  placeholder={
                    exp[c.key] != null ? (c.key === 'seconds' ? fmtDuration(exp[c.key]!) : String(exp[c.key])) : ''
                  }
                  parse={c.key === 'seconds' ? parseDuration : undefined}
                  format={c.key === 'seconds' ? fmtDuration : undefined}
                  onCommit={(v) => save(setNo, { [c.key]: v })}
                />
              ))}
              <button
                className={`check${on ? ' on' : ''}`}
                aria-label={`${on ? 'Clear' : 'Complete'} set ${setNo}`}
                aria-pressed={on}
                onClick={() => toggle(setNo)}
              >
                ✓
              </button>
            </div>
          );
        })}
      </div>

      <div className="spread">
        <button className="btn small ghost" onClick={() => setExtra((n) => n + 1)}>
          + Set
        </button>
        {item.rest ? (
          <button className="btn small ghost" onClick={() => timer.start(countdownPhases(item.rest!), 'Rest')}>
            Rest {fmtDuration(item.rest)}
          </button>
        ) : null}
      </div>

      {(exercise.cues || exercise.adjustments) && (
        <details>
          <summary className="sub">Cues</summary>
          {exercise.cues && <p className="sub" style={{ marginTop: 6 }}>{exercise.cues}</p>}
          {exercise.adjustments && <p className="sub" style={{ marginTop: 6 }}>{exercise.adjustments}</p>}
        </details>
      )}
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
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));
  const patch = (changes: Partial<Workout>) => db.workouts.update(id, changes);
  const checked = new Set(w.checked ?? []);
  const elapsedMin = Math.round((Date.now() - w.startedAt) / 60000);
  const suggestMinutes = w.status === 'in_progress' && elapsedMin >= 1 && elapsedMin <= 240 ? elapsedMin : undefined;

  const setDate = async (date: string) => {
    await db.transaction('rw', db.workouts, db.sets, async () => {
      await db.workouts.update(id, { date });
      await db.sets.where('workoutId').equals(id).modify({ date });
    });
  };

  const finish = async (status: 'done' | 'skipped') => {
    await patch({
      status,
      minutes: status === 'done' ? (w.minutes ?? suggestMinutes) : w.minutes,
    });
    // Land on Today, which now shows what is next; replace so Back does not reopen the finished session.
    nav('/', { replace: true });
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
        back
        actions={
          w.status !== 'in_progress' ? (
            <span className={`badge ${w.status === 'done' ? 'ok' : ''}`}>{w.status === 'done' ? 'Done' : 'Skipped'}</span>
          ) : undefined
        }
      >
        <div className="spread sub" style={{ marginTop: -8 }}>
          <span>
            {space?.name} · {niceDate(w.date)}
          </span>
          {w.items.length > 0 && (
            <button
              className="btn small ghost"
              onClick={() => patch({ logStyle: w.logStyle === 'sets' ? 'session' : 'sets' })}
            >
              {w.logStyle === 'sets' ? 'Switch to tick-off' : 'Switch to set by set'}
            </button>
          )}
        </div>

        {w.prescription && (
          <div className="card">
            <p className="prescription">{w.prescription}</p>
          </div>
        )}

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
                    ✓
                  </button>
                  <Link to={`/exercise/${item.exerciseId}`} className="grow" style={{ flex: 1, minWidth: 0 }}>
                    <div className="title" style={{ fontWeight: 560 }}>{exercise?.name ?? 'Unknown exercise'}</div>
                    <div className="sub">{[itemSummary(item), item.note].filter(Boolean).join(' — ')}</div>
                  </Link>
                </div>
              );
            })}
          </div>
        ) : null}

        <button className="btn" onClick={() => setPicking(true)}>
          + Add exercise
        </button>

        <SectionTitle>How it went</SectionTitle>
        <div className="card stack">
          <div className="grid-2">
            <Field label="Date">
              <input type="date" value={w.date} max={isoDate()} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </Field>
            <div className="field">
              <span>Minutes</span>
              <NumInput
                ariaLabel="Minutes"
                unit="min"
                value={w.minutes}
                placeholder={suggestMinutes != null ? String(suggestMinutes) : ''}
                onCommit={(v) => patch({ minutes: v })}
              />
            </div>
          </div>
          <div className="field">
            <span>Effort (RPE)</span>
            <Chips className="five" options={RPE} value={w.rpe as (typeof RPE)[number] | undefined} onChange={(v) => patch({ rpe: v })} />
          </div>
          <div className="field">
            <span>Back response</span>
            <Chips
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
        </div>

        {w.status === 'in_progress' ? (
          <div className="stack">
            <button className="btn primary block" onClick={() => finish('done')}>
              Finish session
            </button>
            {w.programmeId && (
              <button className="btn block" onClick={() => finish('skipped')}>
                Skip this session
              </button>
            )}
          </div>
        ) : (
          <button className="btn block" onClick={() => patch({ status: 'in_progress' })}>
            Reopen session
          </button>
        )}

        <div className="grid-2">
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
