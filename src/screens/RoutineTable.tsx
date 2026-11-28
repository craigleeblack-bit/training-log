import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { db, uid, type Exercise, type Routine, type RoutineItem, type Space } from '../db/schema';
import { formatSeconds } from '../db/queries';
import { kitList, missingIn } from '../lib/equipment';
import { groupItems, insertItemAt, moveItemTo, normaliseGroups, parseLadder, ungroupItems } from '../lib/logging';
import { Icon, parseDuration, parseNumber } from '../ui';
import { EXERCISE_DRAG } from './RoutineEdit';

/** What a dragged row carries, so a drop can tell a reorder from a new exercise. */
const ROW_DRAG = 'application/x-routine-item';

/** A new exercise for a routine, as the phone's picker makes one. */
export const newItem = (e: Exercise): RoutineItem => ({ id: uid(), exerciseId: e.id, sets: 3, eachSide: e.unilateral || undefined });

/** Add an exercise to a routine, at a gap in its list or at the end. */
export async function addToRoutine(routineId: string, e: Exercise, at?: number): Promise<void> {
  const r = await db.routines.get(routineId);
  if (!r) return;
  await db.routines.update(routineId, { items: insertItemAt(r.items, newItem(e), at ?? r.items.length) });
}

/** One cell's text, saved when it loses focus or on Enter; Escape puts it back. */
function Cell({
  value,
  onCommit,
  label,
  placeholder,
  numeric,
  wide,
}: {
  value: string;
  onCommit: (text: string) => void;
  label: string;
  placeholder?: string;
  numeric?: boolean;
  wide?: boolean;
}) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  // Follow changes made elsewhere (another device, the phone) unless this cell is being typed in.
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  return (
    <input
      className={`cell${wide ? ' wide' : ''}`}
      aria-label={label}
      value={text}
      placeholder={placeholder}
      inputMode={numeric ? 'numeric' : undefined}
      onFocus={(e) => {
        focused.current = true;
        e.target.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (text !== value) onCommit(text);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(value);
          focused.current = false;
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

/** The fields that don't fit the row: a ladder of reps, left and right, and a note. */
function Details({ item, onChange }: { item: RoutineItem; onChange: (i: RoutineItem) => void }) {
  const ladder = item.repsBySet?.join(', ') ?? '';
  return (
    <div className="rt-details">
      <label>
        <span>Different reps each set</span>
        <Cell
          value={ladder}
          label="Different reps each set"
          placeholder="A ladder: 1, 2, 3, 4, 5"
          wide
          onCommit={(text) => {
            const perSet = parseLadder(text);
            onChange({ ...item, repsBySet: perSet, sets: perSet ? perSet.length : item.sets });
          }}
        />
      </label>
      <label className="inline">
        <input type="checkbox" checked={!!item.eachSide} onChange={(e) => onChange({ ...item, eachSide: e.target.checked || undefined })} />
        Log left and right separately
      </label>
      <label>
        <span>Note for this routine</span>
        <Cell
          value={item.note ?? ''}
          label="Note for this routine"
          placeholder="Cue or reminder shown while logging"
          wide
          onCommit={(text) => onChange({ ...item, note: text.trim() || undefined })}
        />
      </label>
    </div>
  );
}

/**
 * A routine's exercises as a table to edit in place, for a wide window: type into the cells,
 * drag rows by their handle, drop exercises in from the library, and tick rows to make supersets.
 */
export default function RoutineTable({ routine, exercises, space }: { routine: Routine; exercises: Exercise[]; space?: Space }) {
  const items = routine.items;
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState<string>();
  const [armed, setArmed] = useState<string>();
  const [dropAt, setDropAt] = useState<number>();
  const [removed, setRemoved] = useState<{ item: RoutineItem; at: number; name: string }>();
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));
  const nameOf = (i: RoutineItem) => exerciseById.get(i.exerciseId)?.name ?? 'Unknown exercise';

  // Rows that were removed or belong to another routine no longer count as chosen.
  const chosen = selected.filter((id) => items.some((i) => i.id === id));
  useEffect(() => setSelected([]), [routine.id]);
  useEffect(() => {
    if (!removed) return;
    const t = window.setTimeout(() => setRemoved(undefined), 8000);
    return () => window.clearTimeout(t);
  }, [removed]);

  const save = (next: RoutineItem[]) => db.routines.update(routine.id, { items: normaliseGroups(next) });
  const change = (next: RoutineItem) => save(items.map((i) => (i.id === next.id ? next : i)));
  const remove = (item: RoutineItem) => {
    setRemoved({ item, at: items.indexOf(item), name: nameOf(item) });
    void save(items.filter((i) => i.id !== item.id));
  };
  const undo = () => {
    if (!removed) return;
    void save(insertItemAt(items, removed.item, removed.at));
    setRemoved(undefined);
  };

  /* Dragging: a row by its handle, or an exercise from the library. */
  const dragging = (e: DragEvent) => e.dataTransfer.types.includes(ROW_DRAG) || e.dataTransfer.types.includes(EXERCISE_DRAG);
  const overRow = (e: DragEvent<HTMLElement>, index: number) => {
    if (!dragging(e)) return;
    e.preventDefault();
    const box = e.currentTarget.getBoundingClientRect();
    setDropAt(e.clientY < box.top + box.height / 2 ? index : index + 1);
  };
  const drop = (e: DragEvent) => {
    if (!dragging(e)) return;
    e.preventDefault();
    const at = dropAt ?? items.length;
    const rowId = e.dataTransfer.getData(ROW_DRAG);
    const exerciseId = e.dataTransfer.getData(EXERCISE_DRAG);
    if (rowId) void save(moveItemTo(items, rowId, at));
    else if (exerciseId) {
      const ex = exerciseById.get(exerciseId);
      if (ex) void save(insertItemAt(items, newItem(ex), at));
    }
    setDropAt(undefined);
    setArmed(undefined);
  };
  const keys = (e: KeyboardEvent, index: number, item: RoutineItem) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const to = e.key === 'ArrowUp' ? index - 1 : index + 2;
    if (to >= 0 && to <= items.length) void save(moveItemTo(items, item.id, to));
  };

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const anyGrouped = chosen.some((id) => items.find((i) => i.id === id)?.group);

  return (
    <div className="rt" onDragOver={(e) => dragging(e) && e.preventDefault()} onDrop={drop} onDragLeave={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(undefined);
    }}>
      <div className="rt-row rt-head" aria-hidden>
        <span />
        <span>Exercise</span>
        <span>Sets</span>
        <span>Reps</span>
        <span>Load</span>
        <span>Rest</span>
        <span />
      </div>

      {items.map((item, index) => {
        const missing = (() => {
          const e = exerciseById.get(item.exerciseId);
          return e ? missingIn(e, space) : [];
        })();
        const prev = items[index - 1];
        const next = items[index + 1];
        const inGroup = !!item.group;
        const groupStart = inGroup && prev?.group !== item.group;
        const groupEnd = inGroup && next?.group !== item.group;
        const groupSize = inGroup ? items.filter((i) => i.group === item.group).length : 0;
        const ladder = item.repsBySet?.length ? item.repsBySet.join('-') : undefined;
        const cls = [
          'rt-item',
          inGroup ? 'grouped' : '',
          groupStart ? 'g-start' : '',
          groupEnd ? 'g-end' : '',
          missing.length ? 'unavailable' : '',
          chosen.includes(item.id) ? 'picked' : '',
          dropAt === index ? 'drop-before' : '',
          dropAt === items.length && index === items.length - 1 ? 'drop-after' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <div
            key={item.id}
            className={cls}
            draggable={armed === item.id}
            onDragStart={(e) => {
              e.dataTransfer.setData(ROW_DRAG, item.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => {
              setArmed(undefined);
              setDropAt(undefined);
            }}
            onDragOver={(e) => overRow(e, index)}
            onKeyDown={(e) => keys(e, index, item)}
          >
            {groupStart && <span className="rt-band">{groupSize > 2 ? 'Circuit' : 'Superset'}</span>}
            <div className="rt-row">
              <span className="rt-grip">
                <input type="checkbox" aria-label={`Choose ${nameOf(item)}`} checked={chosen.includes(item.id)} onChange={() => toggle(item.id)} />
                <span
                  className="handle"
                  title="Drag to move. Alt + ↑ / ↓ also moves it."
                  onPointerDown={() => setArmed(item.id)}
                  onPointerUp={() => setArmed(undefined)}
                >
                  {Icon.grip}
                </span>
              </span>
              <span className="rt-name" title={missing.length ? `Needs ${kitList(missing).toLowerCase()}, not in ${space?.name}` : undefined}>
                <b>{nameOf(item)}</b>
                {missing.length > 0 && <small>Needs {kitList(missing).toLowerCase()}</small>}
              </span>
              <Cell
                value={item.sets != null ? String(item.sets) : ''}
                label={`${nameOf(item)} sets`}
                placeholder="3"
                numeric
                onCommit={(t) => change({ ...item, sets: parseNumber(t) })}
              />
              {ladder ? (
                <button className="cell ladder" title="Different reps each set: change it under ⌄" onClick={() => setOpen(item.id)}>
                  {ladder}
                </button>
              ) : (
                <Cell
                  value={item.reps ?? ''}
                  label={`${nameOf(item)} reps`}
                  placeholder="8–12"
                  onCommit={(t) => change({ ...item, reps: t.trim() || undefined })}
                />
              )}
              <Cell
                value={item.load ?? ''}
                label={`${nameOf(item)} load`}
                placeholder="16 kg"
                onCommit={(t) => change({ ...item, load: t.trim() || undefined })}
              />
              <Cell
                value={item.rest != null ? formatSeconds(item.rest) : ''}
                label={`${nameOf(item)} rest`}
                placeholder="1:30"
                onCommit={(t) => change({ ...item, rest: parseDuration(t) || undefined })}
              />
              <span className="rt-tools">
                <button
                  className={`icon-btn sm${open === item.id || item.note || item.eachSide ? ' on' : ''}`}
                  aria-label={`More for ${nameOf(item)}`}
                  aria-expanded={open === item.id}
                  onClick={() => setOpen((o) => (o === item.id ? undefined : item.id))}
                >
                  {open === item.id ? Icon.chevUp : Icon.chevDown}
                </button>
                <button className="icon-btn sm" aria-label={`Remove ${nameOf(item)}`} onClick={() => remove(item)}>
                  {Icon.close}
                </button>
              </span>
            </div>
            {open === item.id && <Details item={item} onChange={change} />}
          </div>
        );
      })}

      {!items.length && (
        <div className={`rt-empty${dropAt != null ? ' over' : ''}`} onDragOver={(e) => dragging(e) && (e.preventDefault(), setDropAt(0))}>
          Drag exercises here from the library, or use + beside one.
        </div>
      )}

      {chosen.length > 0 && (
        <div className="rt-bar">
          <span>{chosen.length} chosen</span>
          {chosen.length > 1 && (
            <button className="btn small primary" onClick={() => (void save(groupItems(items, chosen)), setSelected([]))}>
              Make {chosen.length > 2 ? 'circuit' : 'superset'}
            </button>
          )}
          {anyGrouped && (
            <button className="btn small" onClick={() => (void save(ungroupItems(items, chosen)), setSelected([]))}>
              Split
            </button>
          )}
          <button className="btn small ghost" onClick={() => setSelected([])}>
            Clear
          </button>
        </div>
      )}

      {removed && (
        <div className="rt-bar">
          <span>Removed {removed.name}.</span>
          <button className="btn small" onClick={undo}>
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
