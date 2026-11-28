import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, SPACE_COLORS, uid, type Space } from '../db/schema';
import { guessSpaceIcon, knownSpaceIcon, spaceIconOf, type SpaceIconKey } from '../lib/activities';
import { isoDate, relativeDay } from '../lib/dates';
import { SPACE_ICON_OPTIONS, SpaceIcon } from '../icons';
import { Field, Icon, IconPicker, MultiChips, SectionTitle, Sheet } from '../ui';
import { EQUIPMENT, equipmentLabel, knownEquipment, type EquipmentKey } from '../lib/equipment';

const KIT = EQUIPMENT.map((e) => e.key);

export function SpaceForm({ space, onClose }: { space?: Space; onClose: () => void }) {
  const count = useLiveQuery(() => db.spaces.count(), []) ?? 0;
  const [name, setName] = useState(space?.name ?? '');
  const [color, setColor] = useState(space?.color ?? SPACE_COLORS[count % SPACE_COLORS.length]);
  // Until one is picked, the icon follows the name as it is typed.
  const [icon, setIcon] = useState<SpaceIconKey | undefined>(knownSpaceIcon(space?.icon));
  const shown = icon ?? guessSpaceIcon(name);
  // Undefined: not said yet, so nothing is filtered. A list, even an empty one, filters.
  const [kit, setKit] = useState<EquipmentKey[] | undefined>(space?.equipment ? knownEquipment(space.equipment) : undefined);
  const save = async () => {
    const n = name.trim();
    if (!n) return;
    if (space) await db.spaces.update(space.id, { name: n, color, icon: shown, equipment: kit });
    else await db.spaces.add({ id: uid(), name: n, color, icon: shown, equipment: kit, order: count });
    onClose();
  };
  return (
    <Sheet title={space ? 'Edit space' : 'New space'} onClose={onClose}>
      <Field label="Name">
        <input value={name} autoFocus placeholder="Home, Gym, Outdoors…" onChange={(e) => setName(e.target.value)} />
      </Field>
      <div style={{ ['--space' as string]: color, display: 'contents' }}>
        <IconPicker
          label="Icon"
          options={SPACE_ICON_OPTIONS}
          value={shown}
          onChange={setIcon}
          hint={icon ? undefined : 'Guessed from the name'}
        />
      </div>
      <div className="field">
        <span>Equipment here</span>
        <MultiChips ariaLabel="Equipment here" options={KIT} value={kit ?? []} onChange={setKit} label={equipmentLabel} />
        <span className="sub" style={{ fontWeight: 400 }}>
          {kit === undefined
            ? 'Not set, so every exercise counts as possible here. Tick what is here to filter exercises by it.'
            : kit.length
              ? 'Exercises that need anything else are filtered out of routines here.'
              : 'Bodyweight only: exercises that need kit are filtered out.'}
        </span>
        <div className="inline">
          <button type="button" className="btn small ghost" onClick={() => setKit([...KIT])}>
            All of it
          </button>
          {kit !== undefined && (
            <button type="button" className="btn small ghost" onClick={() => setKit(kit.length ? [] : undefined)}>
              {kit.length ? 'Bodyweight only' : "Don't filter"}
            </button>
          )}
        </div>
      </div>
      <div className="field">
        <span>Colour</span>
        <div className="swatches">
          {SPACE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              className={`swatch${c === color ? ' on' : ''}`}
              style={{ ['--c' as string]: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </div>
      <button className="btn primary block" disabled={!name.trim()} onClick={save}>
        Save
      </button>
    </Sheet>
  );
}

/** Where you train, each with its routines: a section of the Plan tab. */
export function SpacesSection() {
  const [adding, setAdding] = useState(false);
  const today = isoDate();
  const data = useLiveQuery(async () => {
    const [spaces, routines, workouts] = await Promise.all([
      db.spaces.orderBy('order').toArray(),
      db.routines.toArray(),
      db.workouts.where('status').equals('done').toArray(),
    ]);
    return { spaces, routines, workouts };
  }, []);
  if (!data) return null;
  const { spaces, routines, workouts } = data;

  return (
    <>
      <SectionTitle
        action={
          <button className="add" aria-label="New space" onClick={() => setAdding(true)}>
            {Icon.plus}
          </button>
        }
      >
        Spaces
      </SectionTitle>
      {spaces.length ? (
        <div className="spaces">
          {spaces.map((s) => {
            const n = routines.filter((r) => r.spaceId === s.id).length;
            const last = workouts.filter((w) => w.spaceId === s.id).sort((a, b) => b.date.localeCompare(a.date))[0];
            return (
              <Link key={s.id} to={`/space/${s.id}`} className="space-card" style={{ ['--space' as string]: s.color }}>
                <span className="space-ico">{SpaceIcon[spaceIconOf(s)]}</span>
                <div>
                  <div className="name">{s.name}</div>
                  <div className="sub">{last ? relativeDay(last.date, today) : `${n} routine${n === 1 ? '' : 's'}`}</div>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <button className="btn block" onClick={() => setAdding(true)}>
          New space: home, the gym, outdoors…
        </button>
      )}
      {adding && <SpaceForm onClose={() => setAdding(false)} />}
    </>
  );
}
