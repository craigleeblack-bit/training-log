import Dexie, { type Table } from 'dexie';
import { guessCategory, type ExerciseCategory } from '../lib/categories';
import { DEFAULT_TIMERS, type TimerSpec } from '../lib/timer';

/** How an exercise is measured, which decides the inputs shown when logging a set. */
export type Measure = 'weight_reps' | 'reps' | 'time' | 'distance' | 'rounds';

export const MEASURE_LABEL: Record<Measure, string> = {
  weight_reps: 'Weight × reps',
  reps: 'Reps only',
  time: 'Time',
  distance: 'Distance',
  rounds: 'Rounds',
};

export interface Space {
  id: string;
  name: string;
  color: string;
  order: number;
}

export interface Link {
  label: string;
  url: string;
}

/** One movement inside a complex: "Double clean × 2". */
export interface ComplexPart {
  name: string;
  /** Reps of this movement in one round of the complex. */
  reps: number;
  /** The library exercise these reps count towards, when there is one. */
  exerciseId?: string;
}

export interface Exercise {
  id: string;
  name: string;
  measure: Measure;
  /** Section of the exercise list: bodyweight, kettlebell, machine… */
  category?: ExerciseCategory;
  equipment?: string;
  cues?: string;
  adjustments?: string;
  /** A technique video to watch. */
  video?: string;
  /** Logged one side at a time by default. */
  unilateral?: boolean;
  /** What one round is made of, for an exercise measured in rounds. */
  parts?: ComplexPart[];
  links: Link[];
}

export interface RoutineItem {
  id: string;
  exerciseId: string;
  sets?: number;
  /** Free text: "8–12", "5 each side", "20–30 m/side". */
  reps?: string;
  /** Free text: "60 kg", "2 × 16 kg", "BW". The first number seeds the weight field. */
  load?: string;
  /** Rest between sets, in seconds. */
  rest?: number;
  note?: string;
  /** How many implements the load is per: 2 for "2 × 16 kg" kettlebells. */
  count?: number;
  /** A different target for each set, such as a 1-2-3-4-5 ladder. */
  repsBySet?: number[];
  /** Log left and right separately. */
  eachSide?: boolean;
  /** Items sharing a group are done as a superset or circuit: one set of each, then rest. */
  group?: string;
}

export type LogStyle = 'sets' | 'session';

export interface Routine {
  id: string;
  spaceId: string;
  name: string;
  logStyle: LogStyle;
  description?: string;
  items: RoutineItem[];
  order: number;
}

export interface ProgrammeSlot {
  week: number; // 1-based
  day: number; // 0 = first day of the programme week
  title: string;
  routineId?: string;
  prescription?: string;
  targetMinutes?: string;
  targetRpe?: string;
  rest?: boolean;
}

export interface Programme {
  id: string;
  spaceId: string;
  name: string;
  /** ISO date (YYYY-MM-DD) of week 1, day 0. */
  startDate: string;
  weeks: number;
  slots: ProgrammeSlot[];
  active: boolean;
  notes?: string;
}

export type WorkoutStatus = 'in_progress' | 'done' | 'skipped';

export interface Workout {
  id: string;
  /** ISO date (YYYY-MM-DD) the session counts for. */
  date: string;
  startedAt: number;
  spaceId: string;
  routineId?: string;
  programmeId?: string;
  /** "week-day" of the programme slot this workout fulfils. */
  slotKey?: string;
  title: string;
  prescription?: string;
  status: WorkoutStatus;
  minutes?: number;
  rpe?: number;
  backResponse?: string;
  notes?: string;
  /** Routine item ids ticked off in a session-style workout. */
  checked?: string[];
  /** Snapshot of the routine at the time of starting, so later routine edits never rewrite history. */
  logStyle: LogStyle;
  items: RoutineItem[];
}

export interface SetEntry {
  id: string;
  workoutId: string;
  exerciseId: string;
  itemId?: string;
  date: string;
  setNo: number;
  reps?: number;
  weight?: number;
  seconds?: number;
  metres?: number;
  note?: string;
  /** How many implements the weight is per: 2 for a pair of 16 kg kettlebells. */
  count?: number;
  /** Which side, for a set logged left and right separately. */
  side?: Side;
}

export type Side = 'L' | 'R';

/** A saved timer on the Timer screen. */
export interface TimerPreset {
  id: string;
  name: string;
  spec: TimerSpec;
  order: number;
}

/** A gym card or code to show at a turnstile or machine. */
export interface Pass {
  id: string;
  name: string;
  kind: 'image' | 'code';
  /** Picture of the pass, as a data URL. */
  image?: string;
  /** Barcode format of a scanned code: "qr_code", "code_128"… */
  format?: string;
  /** What a scanned code says. */
  text?: string;
  note?: string;
  order: number;
}

export type Activity = 'run' | 'walk' | 'ride' | 'other';

/** One GPS fix: time (ms), latitude, longitude, and altitude in metres when known. */
export type TrackPoint = [t: number, lat: number, lon: number, alt?: number];

/** A recorded route. A pause starts a new segment, so the line never jumps across a gap. */
export interface Track {
  id: string;
  workoutId: string;
  date: string;
  activity: Activity;
  startedAt: number;
  endedAt?: number;
  segments: TrackPoint[][];
  /** Distance covered, in metres. */
  metres: number;
  /** Time spent moving, in seconds. */
  seconds: number;
  source: 'gps' | 'gpx';
}

export type NoteKind = 'note' | 'book';

export interface Note {
  id: string;
  kind: NoteKind;
  title: string;
  /** Author for books. */
  author?: string;
  body: string;
  order: number;
}

export interface Setting {
  key: string;
  value: unknown;
}

export class AppDB extends Dexie {
  spaces!: Table<Space, string>;
  exercises!: Table<Exercise, string>;
  routines!: Table<Routine, string>;
  programmes!: Table<Programme, string>;
  workouts!: Table<Workout, string>;
  sets!: Table<SetEntry, string>;
  notes!: Table<Note, string>;
  settings!: Table<Setting, string>;
  timers!: Table<TimerPreset, string>;
  passes!: Table<Pass, string>;
  tracks!: Table<Track, string>;

  constructor(name = 'training-log') {
    super(name);
    this.version(1).stores({
      spaces: 'id, order',
      exercises: 'id, name',
      routines: 'id, spaceId, order',
      programmes: 'id, spaceId',
      workouts: 'id, date, spaceId, routineId, programmeId, status',
      sets: 'id, workoutId, exerciseId, date',
      notes: 'id, kind, order',
      settings: 'key',
    });
    this.version(2)
      .stores({
        exercises: 'id, name, category',
        timers: 'id, order',
        passes: 'id, order',
        tracks: 'id, workoutId, date',
      })
      .upgrade(async (tx) => {
        await tx
          .table<Exercise>('exercises')
          .toCollection()
          .modify((e) => {
            e.category ??= guessCategory(e.name, e.equipment);
          });
        await tx.table<TimerPreset>('timers').bulkPut(DEFAULT_TIMERS);
      });
    // A brand-new database skips upgrades, so it gets the starter timers here.
    this.on('populate', (tx) => {
      void tx.table<TimerPreset>('timers').bulkAdd(DEFAULT_TIMERS);
    });
  }
}

export const db = new AppDB();

export const TABLES = [
  'spaces',
  'exercises',
  'routines',
  'programmes',
  'workouts',
  'sets',
  'notes',
  'settings',
  'timers',
  'passes',
  'tracks',
] as const;
export type TableName = (typeof TABLES)[number];

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export const SPACE_COLORS = ['#c2553b', '#2f6f8f', '#4d7c4a', '#8a5a9e', '#b7862b', '#58606b'];
