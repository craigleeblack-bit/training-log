import { categoryOf, type ExerciseCategory } from './categories';

/** Kit a space can have, and an exercise can need. */
export const EQUIPMENT = [
  { key: 'kettlebell', label: 'Kettlebells' },
  { key: 'dumbbell', label: 'Dumbbells' },
  { key: 'barbell', label: 'Barbell' },
  { key: 'bench', label: 'Bench' },
  { key: 'pullup', label: 'Pull-up bar' },
  { key: 'rings', label: 'Rings or straps' },
  { key: 'bands', label: 'Bands' },
  { key: 'clubs', label: 'Clubs or maces' },
  { key: 'cable', label: 'Cable machine' },
  { key: 'machine', label: 'Weight machines' },
  { key: 'bike', label: 'Bike' },
  { key: 'rower', label: 'Rower' },
  { key: 'treadmill', label: 'Treadmill' },
  { key: 'pool', label: 'Pool' },
] as const;

export type EquipmentKey = (typeof EQUIPMENT)[number]['key'];

const LABEL = new Map<string, string>(EQUIPMENT.map((e) => [e.key, e.label]));

export const equipmentLabel = (key: string): string => LABEL.get(key) ?? key;

/** Only the keys this version knows, in the list's own order. */
export const knownEquipment = (keys: readonly string[] | undefined): EquipmentKey[] =>
  EQUIPMENT.map((e) => e.key).filter((k) => keys?.includes(k));

type Guessable = { name: string; equipment?: string; category?: ExerciseCategory };

/**
 * Best guess at the kit an exercise needs, from its kind, name and equipment note. It only names
 * kit when the words make it plain, so an unclear exercise is never hidden for no reason.
 */
export function guessNeeds(e: Guessable): EquipmentKey[] {
  const text = `${e.name} ${e.equipment ?? ''}`.toLowerCase();
  const out = new Set<EquipmentKey>();
  const category = categoryOf(e);
  if (category === 'club' || /\bclubs?\b|\bmaces?\b/.test(text)) out.add('clubs');
  if (category === 'kettlebell' || /kettlebell|\bkb\b/.test(text)) out.add('kettlebell');
  if (category === 'machine' || /machine|smith|leg press|pec deck|pulldown/.test(text)) out.add('machine');
  if (category === 'cable' || /\bcable\b|pushdown|face pull/.test(text)) out.add('cable');
  if (category === 'free_weights') {
    if (/barbell|\bbb\b|deadlift|good morning|hip thrust|back squat|bench press/.test(text)) out.add('barbell');
    else if (/dumbbell|\bdb\b|\bfly\b|\bcurl\b|\bpress\b/.test(text)) out.add('dumbbell');
  } else if (/dumbbell|\bdb\b/.test(text)) out.add('dumbbell');
  if (/\bbench\b|incline|decline|preacher|hip thrust/.test(text)) out.add('bench');
  if (/pull-?ups?|chin-?ups?|dead hang|hanging|toes.to.bar/.test(text)) out.add('pullup');
  if (/\brings?\b|\btrx\b|suspension/.test(text)) out.add('rings');
  if (/\bbands?\b/.test(text)) out.add('bands');
  if (/\bbike\b|assault|air ?bike|spin/.test(text)) out.add('bike');
  if (/rower|rowing machine|row machine|\berg\b|concept ?2/.test(text)) out.add('rower');
  if (/treadmill/.test(text)) out.add('treadmill');
  if (/\bswim/.test(text)) out.add('pool');
  // A machine named for itself does not need the barbell its free-weight twin would.
  if (out.has('machine')) out.delete('barbell');
  return EQUIPMENT.map((x) => x.key).filter((k) => out.has(k));
}

/** The kit an exercise needs: what was chosen for it, else a guess. */
export const needsOf = (e: Guessable & { needs?: string[] }): EquipmentKey[] =>
  e.needs ? knownEquipment(e.needs) : guessNeeds(e);

/**
 * What an exercise needs that a space does not have. A space that has not said what it has
 * holds nothing back: every exercise is possible there.
 */
export function missingIn(e: Guessable & { needs?: string[] }, space: { equipment?: string[] } | undefined): EquipmentKey[] {
  if (!space?.equipment) return [];
  return needsOf(e).filter((k) => !space.equipment!.includes(k));
}

/** "Barbell and bench". */
export function kitList(keys: readonly string[]): string {
  const names = keys.map((k, i) => (i === 0 ? equipmentLabel(k) : equipmentLabel(k).toLowerCase()));
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '');
}
