import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, MEASURE_LABEL, uid, type Exercise, type Measure, type Routine, type RoutineItem } from '../db/schema';
import { CATEGORIES, CATEGORY_LABEL, categoryOf, guessCategory, type ExerciseCategory } from '../lib/categories';
import { linkAbove, normaliseGroups, parseLadder } from '../lib/logging';
import { routineCopy } from '../lib/planning';
import { Chips, Field, Page, SectionTitle, Sheet, parseNumber, useFeedback } from '../ui';

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

/** Pick an existing exercise or create one on the spot. */
export function ExercisePicker({
  onPick,
  onClose,
  title = 'Add exercise',
}: {
  onPick: (e: Exercise) => void;
  onClose: () => void;
  title?: string;
}) {
  const exercises = useLiveQuery(() => db.exercises.orderBy('name').toArray(), []) ?? [];
  const [q, setQ] = useState('');
  const [measure, setMeasure] = useState<Measure>('weight_reps');
  const [section, setSection] = useState<ExerciseCategory>();
  const needle = q.trim().toLowerCase();
  // Typing searches everything; otherwise a section narrows the list.
  const matches = exercises.filter((e) =>
    needle ? e.name.toLowerCase().includes(needle) : !section || categoryOf(e) === section,
  );
  const exact = exercises.some((e) => e.name.toLowerCase() === needle);
  const sections = CATEGORIES.filter((c) => exercises.some((e) => categoryOf(e) === c));

  const create = async () => {
    const name = q.trim();
    const e: Exercise = { id: uid(), name, measure, category: section ?? guessCategory(name), links: [] };
    await db.exercises.add(e);
    onPick(e);
  };

  return (
    <Sheet title={title} onClose={onClose}>
      <input className="input" autoFocus placeholder="Search or type a new name" value={q} onChange={(e) => setQ(e.target.value)} />
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
      <div className="card flush">
        {matches.map((e) => (
          <button key={e.id} className="row" onClick={() => onPick(e)}>
            <div className="grow">
              <div className="title">{e.name}</div>
              <div className="sub">{[CATEGORY_LABEL[categoryOf(e)], MEASURE_LABEL[e.measure]].join(' · ')}</div>
            </div>
          </button>
        ))}
        {!matches.length && <div className="empty">No matching exercises.</div>}
      </div>
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

export default function RoutineEdit() {
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
      nav(-1);
    }
  };

  const currentIndex = routine.items.findIndex((i) => i.id === editing);
  const current = routine.items[currentIndex];

  return (
    <Page title="Edit routine" back>
      <Field label="Name">
        <input defaultValue={routine.name} onBlur={(e) => e.target.value.trim() && patch({ name: e.target.value.trim() })} />
      </Field>

      <Field label="Space">
        <select value={routine.spaceId} onChange={(e) => patch({ spaceId: e.target.value })}>
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>

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

      <Field label="Description / prescription">
        <textarea
          defaultValue={routine.description ?? ''}
          placeholder="Shown at the top of the session"
          onBlur={(e) => patch({ description: e.target.value.trim() || undefined })}
        />
      </Field>

      <SectionTitle action={<button onClick={() => setPicking(true)}>+ Add</button>}>Exercises</SectionTitle>
      <div className="card flush">
        {routine.items.map((item, i) => (
          <div key={item.id} className={`row${item.group ? ' grouped' : ''}`}>
            <button className="grow" style={{ border: 0, background: 'none', textAlign: 'left', padding: 0 }} onClick={() => setEditing(item.id)}>
              <div className="title">{nameOf(item.exerciseId)}</div>
              <div className="sub">
                {[item.group && 'Superset', itemSummary(item)].filter(Boolean).join(' · ') || 'Tap to set sets, reps and load'}
              </div>
            </button>
            <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
              ↑
            </button>
            <button className="icon-btn" aria-label="Move down" disabled={i === routine.items.length - 1} onClick={() => move(i, 1)}>
              ↓
            </button>
          </div>
        ))}
        {!routine.items.length && <div className="empty">No exercises yet.</div>}
      </div>

      <button
        className="btn"
        onClick={async () => {
          const copy = routineCopy(routine, (await db.routines.where('spaceId').equals(routine.spaceId).count()) + 1);
          await db.routines.add(copy);
          nav(`/routine/${copy.id}`, { replace: true });
        }}
      >
        Duplicate this routine
      </button>
      <button className="btn ghost danger" onClick={remove}>
        Delete this routine
      </button>

      {picking && (
        <ExercisePicker
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
