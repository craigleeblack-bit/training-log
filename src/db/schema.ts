import Dexie, { type Table } from 'dexie';

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

export interface Exercise {
  id: string;
  name: string;
  measure: Measure;
  equipment?: string;
  cues?: string;
  adjustments?: string;
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
] as const;
export type TableName = (typeof TABLES)[number];

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export const SPACE_COLORS = ['#c2553b', '#2f6f8f', '#4d7c4a', '#8a5a9e', '#b7862b', '#58606b'];
