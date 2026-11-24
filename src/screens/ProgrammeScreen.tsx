import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Programme, type ProgrammeSlot, type Routine } from '../db/schema';
import { closedSlots, programmeProgress, slotDate, slotKey } from '../db/queries';
import { dayName, isoDate, niceDate } from '../lib/dates';
import { startWorkout } from '../actions';
import { Field, Page, Sheet, parseNumber, useFeedback } from '../ui';

function SlotForm({
  slot,
  routines,
  dateLabel,
  onSave,
  onClear,
  onClose,
}: {
  slot: ProgrammeSlot;
  routines: Routine[];
  dateLabel: string;
  onSave: (s: ProgrammeSlot) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [s, setS] = useState(slot);
  const set = (changes: Partial<ProgrammeSlot>) => setS((prev) => ({ ...prev, ...changes }));
  return (
    <Sheet title={`Week ${slot.week} · ${dateLabel}`} onClose={onClose}>
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
          <option value="">None — free text only</option>
          {routines.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </Field>
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

export default function ProgrammeScreen() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { confirm } = useFeedback();
  const [editMode, setEditMode] = useState(false);
  const [editing, setEditing] = useState<{ week: number; day: number }>();
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
  const find = (week: number, day: number) => p.slots.find((s) => s.week === week && s.day === day);

  const saveSlot = (next: ProgrammeSlot) => {
    void patch({ slots: [...p.slots.filter((s) => !(s.week === next.week && s.day === next.day)), next] });
    setEditing(undefined);
  };

  const open = async (week: number, day: number) => {
    const slot = find(week, day);
    if (editMode || !slot) return setEditing({ week, day });
    const done = closed.get(slotKey(slot));
    if (done) return nav(`/workout/${done.id}`);
    if (slot.rest) return;
    const routine = routines.find((r) => r.id === slot.routineId);
    nav(`/workout/${await startWorkout({ spaceId: p.spaceId, routine, programme: p, slot })}`);
  };

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

  const editingSlot = editing && (find(editing.week, editing.day) ?? { ...editing, title: '' });

  return (
    <div style={{ ['--space' as string]: space?.color }}>
      <Page
        title={p.name}
        back
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
            <div className="grid-2">
              <Field label="Week 1 starts">
                <input type="date" value={p.startDate} onChange={(e) => e.target.value && patch({ startDate: e.target.value })} />
              </Field>
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
              Show on the Today screen
            </label>
            <Field label="Notes">
              <textarea defaultValue={p.notes ?? ''} onBlur={(e) => patch({ notes: e.target.value.trim() || undefined })} />
            </Field>
            <p className="sub">Tap any day below to set or change its session.</p>
          </div>
        ) : (
          <div className="card stack">
            <div className="spread">
              <span className="sub">
                Started {niceDate(p.startDate)} · {p.weeks} weeks
              </span>
              {p.active && <span className="badge ok">Active</span>}
            </div>
            <div className="progress">
              <i style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
            <span className="sub">
              {progress.done} of {progress.total} sessions done
            </span>
            {p.notes && <p className="prescription">{p.notes}</p>}
          </div>
        )}

        {Array.from({ length: p.weeks }, (_, w) => w + 1).map((week) => (
          <div key={week} className="week">
            <div className="week-label">Week {week}</div>
            {Array.from({ length: 7 }, (_, day) => {
              const slot = find(week, day);
              const date = slotDate(p, { week, day });
              const state = slot ? closed.get(slotKey(slot))?.status : undefined;
              if (!slot && !editMode) return null;
              return (
                <button
                  key={day}
                  className={`slot${slot?.rest ? ' rest' : ''}${date === today ? ' today-slot' : ''}`}
                  onClick={() => open(week, day)}
                >
                  <span className="day">{dayName(date)}</span>
                  <div className="grow" style={{ minWidth: 0, flex: 1 }}>
                    <div className="title">{slot?.title ?? <span className="muted">+ Add session</span>}</div>
                    {slot && !slot.rest && (slot.targetMinutes || slot.targetRpe) && (
                      <div className="sub">
                        {[slot.targetMinutes && `${slot.targetMinutes} min`, slot.targetRpe && `RPE ${slot.targetRpe}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    )}
                  </div>
                  {slot && !slot.rest && (
                    <span className={`tick ${state ?? ''}`} aria-label={state ?? 'not done'}>
                      {state === 'done' ? '✓' : state === 'skipped' ? '–' : ''}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}

        {editMode && (
          <button className="btn ghost danger" onClick={remove}>
            Delete this programme
          </button>
        )}

        {editingSlot && editing && (
          <SlotForm
            slot={editingSlot}
            routines={routines}
            dateLabel={niceDate(slotDate(p, editing))}
            onClose={() => setEditing(undefined)}
            onSave={saveSlot}
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
