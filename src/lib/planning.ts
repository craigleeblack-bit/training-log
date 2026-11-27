import { db, uid, type Programme, type ProgrammeSlot, type Routine, type Workout } from '../db/schema';
import { closedSlots, isDated, slotDate, slotKey } from '../db/queries';
import { addDays, isoDate, parseIso } from './dates';

export interface Day {
  week: number;
  day: number;
}

const sameDay = (a: Day, b: Day): boolean => a.week === b.week && a.day === b.day;

/** Lay one week's sessions over other weeks, replacing whatever those weeks held. */
export function copyWeek(slots: ProgrammeSlot[], from: number, to: number[]): ProgrammeSlot[] {
  const targets = new Set(to.filter((w) => w !== from));
  const source = slots.filter((s) => s.week === from);
  return [...slots.filter((s) => !targets.has(s.week)), ...[...targets].flatMap((week) => source.map((s) => ({ ...s, week })))];
}

/** Repeat the first `block` weeks through to the end of the programme: 1-2-3, 1-2-3, … */
export function repeatWeeks(slots: ProgrammeSlot[], block: number, weeks: number): ProgrammeSlot[] {
  let out = slots.filter((s) => s.week <= block);
  const pattern = [...out];
  for (let week = block + 1; week <= weeks; week++) {
    const from = ((week - 1) % block) + 1;
    out = [...out, ...pattern.filter((s) => s.week === from).map((s) => ({ ...s, week }))];
  }
  return out;
}

/** Move a session to another day. If that day already has one, the two change places. */
export function moveSlot(slots: ProgrammeSlot[], from: Day, to: Day): ProgrammeSlot[] {
  if (sameDay(from, to)) return slots;
  return slots.map((s) => (sameDay(s, from) ? { ...s, ...to } : sameDay(s, to) ? { ...s, ...from } : s));
}

/** Move a day in a stored programme, taking any session already logged for it along. */
export async function moveProgrammeDay(programmeId: string, from: Day, to: Day): Promise<void> {
  await db.transaction('rw', db.programmes, db.workouts, async () => {
    const p = await db.programmes.get(programmeId);
    if (!p) return;
    await db.programmes.update(programmeId, { slots: moveSlot(p.slots, from, to) });
    const a = slotKey(from);
    const b = slotKey(to);
    await db.workouts
      .where('programmeId')
      .equals(programmeId)
      .modify((w: Workout) => {
        if (w.slotKey === a) w.slotKey = b;
        else if (w.slotKey === b) w.slotKey = a;
      });
  });
}

/** A copy of a routine with its own identity, ready to be changed without touching the original. */
export function routineCopy(r: Routine, order: number, name = `${r.name} copy`): Routine {
  return { ...r, id: uid(), name, order, items: r.items.map((i) => ({ ...i, id: uid() })) };
}

/** A fresh run of a programme from a new start date. It starts with no sessions logged against it. */
export function programmeCopy(p: Programme, startDate: string = isoDate()): Programme {
  return { ...p, id: uid(), name: `${p.name} copy`, startDate, active: false, slots: p.slots.map((s) => ({ ...s })) };
}

/** Turn what was actually done in a session into a routine to use again. */
export function routineFromWorkout(w: Workout, order: number): Routine {
  return {
    id: uid(),
    spaceId: w.spaceId,
    name: w.title,
    logStyle: w.logStyle,
    description: w.prescription,
    order,
    items: w.items.map((i) => ({ ...i, id: uid() })),
  };
}

/** The weeks of a month, Monday first, padded with the days either side. `ym` is "2026-11". */
export function monthGrid(ym: string): string[][] {
  const first = `${ym}-01`;
  const lead = (parseIso(first).getDay() + 6) % 7; // days from the Monday before
  const start = addDays(first, -lead);
  const weeks: string[][] = [];
  for (let w = 0; w < 6; w++) {
    const week = Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d));
    if (w > 0 && week[0].slice(0, 7) !== ym) break;
    weeks.push(week);
  }
  return weeks;
}

export const shiftMonth = (ym: string, by: number): string => {
  const d = parseIso(`${ym}-01`);
  d.setMonth(d.getMonth() + by);
  return isoDate(d).slice(0, 7);
};

export interface Planned {
  date: string;
  programme: Programme;
  slot: ProgrammeSlot;
}

/**
 * Sessions the active programmes still ask for, by date: neither done nor skipped, and not rest days.
 * A programme without calendar dates has no dates to put them on, so it is left out.
 */
export function plannedSessions(programmes: Programme[], workouts: Workout[]): Planned[] {
  const out: Planned[] = [];
  for (const p of programmes) {
    if (!p.active || !isDated(p)) continue;
    const closed = closedSlots(p, workouts);
    for (const slot of p.slots) {
      if (slot.rest || slot.week > p.weeks || closed.has(slotKey(slot))) continue;
      out.push({ date: slotDate(p, slot), programme: p, slot });
    }
  }
  return out;
}
