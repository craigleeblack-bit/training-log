import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, MEASURE_LABEL, uid, type Exercise, type Measure, type Routine, type RoutineItem } from '../db/schema';
import { CATEGORIES, CATEGORY_LABEL, categoryOf, guessCategory, type ExerciseCategory } from '../lib/categories';
import { linkAbove, normaliseGroups, parseLadder } from '../lib/logging';
import { routineCopy } from '../lib/planning';
import { kitList, missingIn } from '../lib/equipment';
import { Chips, Field, Icon, IconPicker, Page, SectionTitle, Sheet, parseNumber, useFeedback } from '../ui';
import { guessActivity, knownActivity } from '../lib/activities';
import { ACTIVITY_OPTIONS } from '../icons';
import { repeatLabel } from '../lib/dates';
import RoutineTable from './RoutineTable';

const WEEKDAY_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function itemSummary(item: RoutineItem): string {
  const parts: string[] = [];
  if (item.repsBySet?.length) parts.push(`${item.repsBySet.length} sets: ${item.repsBySet.join('-')}`);
  else if (item.sets && item.reps) parts.push(`${item.sets} × ${item.reps}`);
  else if (item.sets) parts.push(`${item.sets} set${item.sets === 1 ? '' : 's'}`);
  else if (item.reps) parts.push(item.reps);
  if (item.eachSide) parts.push('each side');
  if (item.load) parts.push(item.load);
  return parts.join(' · ');
}

/** What a dragged exercise carries, so the routine table can tell it from a dragged row. */
export const EXERCISE_DRAG = 'application/x-exercise-id';

/**
 * The exercise list with search, sections and the space's kit filter. Used in the phone's
 * picker sheet and, on a wide window, as the library column beside a routine.
 */
export function ExerciseBrowser({
  onPick,
  spaceId,
  autoFocus,
  panel,
}: {
  onPick: (e: Exercise) => void;
  /** The space it is for: exercises needing kit it does not have are held back. */
  spaceId?: string;
  autoFocus?: boolean;
  /** As a library column: rows can be dragged into the routine, and link to their details. */
  panel?: boolean;
}) {
  const exercises = useLiveQuery(() => db.exercises.orderBy('name').toArray(), []) ?? [];
  const space = useLiveQuery(() => (spaceId ? db.spaces.get(spaceId) : undefined), [spaceId]);
  const [q, setQ] = useState('');
  const [measure, setMeasure] = useState<Measure>('weight_reps');
  const [section, setSection] = useState<ExerciseCategory>();
  const [showAll, setShowAll] = useState(false);
  const needle = q.trim().toLowerCase();
  const filtering = !!space?.equipment;
  const possible = (e: Exercise) => !missingIn(e, space).length;
  const usable = filtering && !showAll ? exercises.filter(possible) : exercises;
  // Typing searches everything; otherwise a section narrows the list.
  const found = (list: Exercise[]) =>
    list.filter((e) => (needle ? e.name.toLowerCase().includes(needle) : !section || categoryOf(e) === section));
  const matches = found(usable);
  const heldBack = filtering && !showAll ? found(exercises).length - matches.length : 0;
  const exact = exercises.some((e) => e.name.toLowerCase() === needle);
  const sections = CATEGORIES.filter((c) => usable.some((e) => categoryOf(e) === c));

  const create = async () => {
    const name = q.trim();
    const e: Exercise = { id: uid(), name, measure, category: section ?? guessCategory(name), links: [] };
    await db.exercises.add(e);
    onPick(e);
    setQ('');
  };

  return (
    <>
      <input
        className="input"
        autoFocus={autoFocus}
        placeholder="Search or type a new name"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {!needle && sections.length > 1 && (
        <Chips className="scroll" options={sections} value={section} onChange={setSection} label={(c) => CATEGORY_LABEL[c]} />
      )}
      {needle && !exact && (
        <div className="card stack">
          <span className="sub">Create “{q.trim()}”, measured by:</span>
          <Chips
            options={Object.keys(MEASURE_LABEL) as Measure[]}
            value={measure}
            onChange={(v) => v && setMeasure(v)}
            label={(m) => MEASURE_LABEL[m]}
          />
          <button className="btn primary" onClick={create}>
            Create and add
          </button>
        </div>
      )}
      {filtering && space && (
        <button type="button" className="kit-filter" onClick={() => setShowAll((v) => !v)}>
          {showAll
            ? `Showing everything. Show only what ${space.name} has kit for`
            : `Only what ${space.name} has kit for${heldBack ? `. Show ${heldBack} more` : ''}`}
        </button>
      )}
      <div className="card flush">
        {matches.map((e) => {
          const missing = missingIn(e, space);
          const text = (
            <div className="grow">
              <div className="title">{e.name}</div>
              <div className="sub">
                {missing.length
                  ? `Needs ${kitList(missing).toLowerCase()}`
                  : [CATEGORY_LABEL[categoryOf(e)], MEASURE_LABEL[e.measure]].join(' · ')}
              </div>
            </div>
          );
          return panel ? (
            <div
              key={e.id}
              className={`row tools lib-row${missing.length ? ' unavailable' : ''}`}
              draggable
              title="Drag into the routine, or + to add it at the end"
              onDragStart={(ev) => {
                ev.dataTransfer.setData(EXERCISE_DRAG, e.id);
                ev.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <Link to={`/exercise/${e.id}`} className="grow" draggable={false}>
                {text}
              </Link>
              <button className="icon-btn sm" aria-label={`Add ${e.name} to the routine`} onClick={() => onPick(e)}>
                {Icon.plus}
              </button>
            </div>
          ) : (
            <button key={e.id} className={`row${missing.length ? ' unavailable' : ''}`} onClick={() => onPick(e)}>
              {text}
            </button>
          );
        })}
        {!matches.length && (
          <div className="empty">{heldBack ? `No matches with the kit in ${space?.name}.` : 'No matching exercises.'}</div>
        )}
      </div>
    </>
  );
}

/** Pick an existing exercise or create one on the spot. */
export function ExercisePicker({
  onPick,
  onClose,
  title = 'Add exercise',
  spaceId,
}: {
  onPick: (e: Exercise) => void;
  onClose: () => void;
  title?: string;
  /** The space it is for: exercises needing kit it does not have are held back. */
  spaceId?: string;
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <ExerciseBrowser onPick={onPick} spaceId={spaceId} autoFocus />
    </Sheet>
  );
}

function ItemForm({
  item,
  name,
  onSave,
  onDelete,
  onClose,
  above,
  isLinked,
}: {
  item: RoutineItem;
  name: string;
  /** Already a superset with the exercise above. */
  isLinked: boolean;
  onSave: (i: RoutineItem, linkAbove: boolean) => void;
  onDelete: () => void;
  onClose: () => void;
  /** The exercise above this one, to pair with as a superset. Undefined for the first. */
  above?: string;
}) {
  const [sets, setSets] = useState(item.sets != null ? String(item.sets) : '');
  const [reps, setReps] = useState(item.reps ?? '');
  const [load, setLoad] = useState(item.load ?? '');
  const [rest, setRest] = useState(item.rest != null ? String(item.rest) : '');
  const [note, setNote] = useState(item.note ?? '');
  const [ladder, setLadder] = useState(item.repsBySet?.join(', ') ?? '');
  const [eachSide, setEachSide] = useState(!!item.eachSide);
  const [linked, setLinked] = useState(isLinked);
  const perSet = parseLadder(ladder);
  return (
    <Sheet title={name} onClose={onClose}>
      <div className="grid-2">
        <Field label="Sets">
          <input inputMode="numeric" value={sets} placeholder="3" onChange={(e) => setSets(e.target.value)} />
        </Field>
        <Field label="Reps / amount">
          <input value={reps} placeholder="8–12" onChange={(e) => setReps(e.target.value)} />
        </Field>
        <Field label="Load">
          <input value={load} placeholder="60 kg, 2 × 16 kg, BW" onChange={(e) => setLoad(e.target.value)} />
        </Field>
        <Field label="Rest (seconds)">
          <input inputMode="numeric" value={rest} placeholder="90" onChange={(e) => setRest(e.target.value)} />
        </Field>
      </div>
      <Field label="Different reps each set (optional)">
        <input value={ladder} placeholder="A ladder: 1, 2, 3, 4, 5" onChange={(e) => setLadder(e.target.value)} />
      </Field>
      {perSet && <p className="sub">{perSet.length} sets, with these as the target for each.</p>}
      <label className="inline">
        <input type="checkbox" checked={eachSide} onChange={(e) => setEachSide(e.target.checked)} />
        Log left and right separately
      </label>
      {above && (
        <label className="inline">
          <input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} />
          Superset with {above}: one set of each, then rest
        </label>
      )}
      <Field label="Note for this routine">
        <textarea value={note} placeholder="Cue or reminder shown while logging" onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="grid-2">
        <button className="btn danger" onClick={onDelete}>
          Remove
        </button>
        <button
          className="btn primary"
          onClick={() =>
            onSave(
              {
                ...item,
                sets: perSet ? perSet.length : parseNumber(sets),
                reps: reps.trim() || undefined,
                load: load.trim() || undefined,
                rest: parseNumber(rest),
                note: note.trim() || undefined,
                repsBySet: perSet,
                eachSide: eachSide || undefined,
              },
              linked,
            )
          }
        >
          Save
        </button>
      </div>
    </Sheet>
  );
}

export default function RoutineEdit({
  embedded,
  onAddExercises,
}: {
  /** In the wide Plan workspace: no page header, settings in a grid, exercises as a table. */
  embedded?: boolean;
  /** Opens the exercise library, when it is not already showing beside the editor. */
  onAddExercises?: () => void;
} = {}) {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { confirm } = useFeedback();
  const routine = useLiveQuery(() => db.routines.get(id), [id]);
  const exercises = useLiveQuery(() => db.exercises.toArray(), []) ?? [];
  const spaces = useLiveQuery(() => db.spaces.orderBy('order').toArray(), []) ?? [];
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<string>();

  // A duplicate opens in this same screen: its fields must start from the copy, not the original.
  if (routine === undefined || routine?.id !== id) return null;
  if (!routine) {
    return (
      <Page title="Routine" back>
        <div className="empty">This routine no longer exists.</div>
      </Page>
    );
  }

  const nameOf = (exerciseId: string) => exercises.find((e) => e.id === exerciseId)?.name ?? 'Unknown exercise';
  const space = spaces.find((s) => s.id === routine.spaceId);
  /** Kit an item's exercise needs that this routine's space does not have. */
  const missingFor = (exerciseId: string) => {
    const e = exercises.find((x) => x.id === exerciseId);
    return e ? missingIn(e, space) : [];
  };
  const impossible = routine.items.filter((i) => missingFor(i.exerciseId).length).length;
  const patch = (changes: Partial<Routine>) => db.routines.update(id, changes);
  const setItems = (items: RoutineItem[]) => patch({ items: normaliseGroups(items) });

  const move = (index: number, by: number) => {
    const items = [...routine.items];
    const j = index + by;
    if (j < 0 || j >= items.length) return;
    [items[index], items[j]] = [items[j], items[index]];
    void setItems(items);
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${routine.name}?`,
      body: 'Sessions already logged with it are kept.',
      action: 'Delete routine',
      danger: true,
    });
    if (ok) {
      await db.routines.delete(id);
      if (embedded) nav('/plan', { replace: true });
      else nav(-1);
    }
  };

  const duplicate = async () => {
    const copy = routineCopy(routine, (await db.routines.where('spaceId').equals(routine.spaceId).count()) + 1);
    await db.routines.add(copy);
    nav(`/routine/${copy.id}`, { replace: true });
  };

  const currentIndex = routine.items.findIndex((i) => i.id === editing);
  const current = routine.items[currentIndex];

  const nameField = (
    <Field label="Name">
      <input defaultValue={routine.name} onBlur={(e) => e.target.value.trim() && patch({ name: e.target.value.trim() })} />
    </Field>
  );
  const spaceField = (
    <Field label="Space">
      <select value={routine.spaceId} onChange={(e) => patch({ spaceId: e.target.value })}>
        {spaces.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </Field>
  );
  const kitWarning = impossible > 0 && (
    <p className="kit-warning">
      {impossible} exercise{impossible === 1 ? ' needs' : 's need'} kit {space?.name} does not have. They are marked below.
    </p>
  );
  const activityField = (
    <div style={{ ['--space' as string]: spaces.find((s) => s.id === routine.spaceId)?.color, display: 'contents' }}>
      <IconPicker
        label="Activity"
        options={ACTIVITY_OPTIONS}
        value={knownActivity(routine.activity) ?? guessActivity(routine.name, spaces.find((s) => s.id === routine.spaceId)?.name)}
        onChange={(k) => patch({ activity: k })}
        hint={routine.activity ? 'Shown on the Week screen' : 'Guessed from the name'}
      />
    </div>
  );
  const daysField = (
    <div className="field">
      <span>Repeats on</span>
      <div className="chips days" role="group" aria-label="Repeats on">
        {WEEKDAY_SHORT.map((label, d) => {
          const on = !!routine.days?.includes(d);
          return (
            <button
              key={d}
              type="button"
              className={`chip${on ? ' on' : ''}`}
              aria-pressed={on}
              aria-label={WEEKDAY_LONG[d]}
              onClick={() => {
                const next = on ? (routine.days ?? []).filter((x) => x !== d) : [...(routine.days ?? []), d].sort((a, b) => a - b);
                void patch({ days: next.length ? next : undefined });
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      <span className="sub" style={{ fontWeight: 400 }}>
        {routine.days?.length
          ? `On the Week screen every week: ${repeatLabel(routine.days)}.`
          : 'Pick the days it should show on the Week screen, every week.'}
      </span>
    </div>
  );
  const styleField = (
    <div className="field">
      <span>Logging style</span>
      <Chips
        options={['sets', 'session'] as const}
        value={routine.logStyle}
        onChange={(v) => v && patch({ logStyle: v })}
        label={(v) => (v === 'sets' ? 'Set by set' : 'Tick-off session')}
      />
      <span className="sub" style={{ fontWeight: 400 }}>
        {routine.logStyle === 'sets'
          ? 'Log reps and weight for every set, with last time shown.'
          : 'Tick exercises off, then record minutes, effort and how the back felt.'}
      </span>
    </div>
  );
  const descField = (
    <Field label="Description / prescription">
      <textarea
        defaultValue={routine.description ?? ''}
        placeholder="Shown at the top of the session"
        onBlur={(e) => patch({ description: e.target.value.trim() || undefined })}
      />
    </Field>
  );

  if (embedded) {
    return (
      <section className="ws-col ws-editor" style={{ ['--space' as string]: space?.color }}>
        <div className="ws-head">
          <input
            className="ws-title"
            aria-label="Routine name"
            defaultValue={routine.name}
            onBlur={(e) => e.target.value.trim() && patch({ name: e.target.value.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          {onAddExercises && (
            <button className="btn small primary" onClick={onAddExercises}>
              {Icon.plus}
              Add exercises
            </button>
          )}
          <button className="btn small ghost" onClick={duplicate}>
            Duplicate
          </button>
          <button className="btn small ghost danger" onClick={remove}>
            Delete
          </button>
        </div>
        <div className="ws-settings">
          {spaceField}
          {activityField}
          {daysField}
          {styleField}
          <div className="span-2">{descField}</div>
        </div>
        {kitWarning}
        <SectionTitle>Exercises</SectionTitle>
        <RoutineTable routine={routine} exercises={exercises} space={space} />
      </section>
    );
  }

  return (
    <Page title="Edit routine" back>
      {nameField}

      {spaceField}
      {kitWarning}

      {activityField}

      {daysField}

      {styleField}

      {descField}

      <SectionTitle action={<button onClick={() => setPicking(true)}>+ Add</button>}>Exercises</SectionTitle>
      <div className="card flush">
        {routine.items.map((item, i) => {
          const missing = missingFor(item.exerciseId);
          return (
            <div key={item.id} className={`row${item.group ? ' grouped' : ''}${missing.length ? ' unavailable' : ''}`}>
              <button className="grow" style={{ border: 0, background: 'none', textAlign: 'left', padding: 0 }} onClick={() => setEditing(item.id)}>
                <div className="title">{nameOf(item.exerciseId)}</div>
                <div className="sub">
                  {missing.length
                    ? `Needs ${kitList(missing).toLowerCase()}, not in ${space?.name}`
                    : [item.group && 'Superset', itemSummary(item)].filter(Boolean).join(' · ') || 'Tap to set sets, reps and load'}
                </div>
              </button>
              <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button className="icon-btn" aria-label="Move down" disabled={i === routine.items.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
            </div>
          );
        })}
        {!routine.items.length && <div className="empty">No exercises yet.</div>}
      </div>

      <button className="btn" onClick={duplicate}>
        Duplicate this routine
      </button>
      <button className="btn ghost danger" onClick={remove}>
        Delete this routine
      </button>

      {picking && (
        <ExercisePicker
          spaceId={routine.spaceId}
          onClose={() => setPicking(false)}
          onPick={(e) => {
            const item: RoutineItem = { id: uid(), exerciseId: e.id, sets: 3, eachSide: e.unilateral || undefined };
            void setItems([...routine.items, item]);
            setPicking(false);
            setEditing(item.id);
          }}
        />
      )}

      {current && (
        <ItemForm
          item={current}
          name={nameOf(current.exerciseId)}
          above={currentIndex > 0 ? nameOf(routine.items[currentIndex - 1].exerciseId) : undefined}
          isLinked={currentIndex > 0 && !!current.group && current.group === routine.items[currentIndex - 1].group}
          onClose={() => setEditing(undefined)}
          onDelete={() => {
            void setItems(routine.items.filter((i) => i.id !== current.id));
            setEditing(undefined);
          }}
          onSave={(next, link) => {
            const items = routine.items.map((i) => (i.id === next.id ? next : i));
            const was = currentIndex > 0 && !!current.group && current.group === routine.items[currentIndex - 1].group;
            void setItems(link === was ? items : linkAbove(items, currentIndex, link));
            setEditing(undefined);
          }}
        />
      )}
    </Page>
  );
}
