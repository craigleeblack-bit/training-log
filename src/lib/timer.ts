import type { TimerPreset } from '../db/schema';

export type PhaseKind = 'prep' | 'work' | 'rest' | 'warmup' | 'cooldown';

export interface Phase {
  kind: PhaseKind;
  label: string;
  seconds: number;
  /** Which round this phase belongs to, and out of how many. */
  round?: number;
  rounds?: number;
  /** Which set of rounds, when the rounds repeat in sets. */
  set?: number;
  sets?: number;
  /** Counts up with no fixed end: a stopwatch. */
  open?: boolean;
}

/** Long enough that a stopwatch never runs out, and still a plain number when saved. */
export const OPEN_SECONDS = 24 * 3600;

export interface IntervalSpec {
  warmup?: number;
  work: number;
  rest: number;
  rounds: number;
  /** Repeat the whole block of rounds this many times. */
  sets?: number;
  /** Rest between sets, in place of the ordinary rest. */
  setRest?: number;
  cooldown?: number;
  /** Keep the rest after the very last round. */
  endWithRest?: boolean;
}

/** What the user sets up: the recipe a timer's phases are built from. */
export type TimerSpec =
  | { mode: 'countdown'; seconds: number }
  | { mode: 'stopwatch' }
  | ({ mode: 'intervals' } & IntervalSpec)
  | { mode: 'emom'; every: number; rounds: number }
  | { mode: 'amrap'; seconds: number };

export type TimerMode = TimerSpec['mode'];

export const MODE_LABEL: Record<TimerMode, string> = {
  countdown: 'Countdown',
  stopwatch: 'Stopwatch',
  intervals: 'Intervals',
  emom: 'EMOM',
  amrap: 'AMRAP',
};

/** Work/rest rounds, optionally in sets, with warm-up and cool-down. The final rest is dropped unless asked for. */
export function intervalPhases(spec: IntervalSpec): Phase[] {
  const out: Phase[] = [];
  const sets = Math.max(1, Math.round(spec.sets ?? 1));
  const rounds = Math.max(0, Math.round(spec.rounds));
  if (spec.warmup) out.push({ kind: 'warmup', label: 'Warm-up', seconds: spec.warmup });
  for (let s = 1; s <= sets; s++) {
    const where = sets > 1 ? { set: s, sets } : {};
    for (let i = 1; i <= rounds; i++) {
      out.push({ kind: 'work', label: `Round ${i} of ${rounds}`, seconds: spec.work, round: i, rounds, ...where });
      const lastRound = i === rounds;
      const lastOfAll = lastRound && s === sets;
      if (lastOfAll) {
        if (spec.endWithRest && spec.rest) {
          out.push({ kind: 'rest', label: 'Recover', seconds: spec.rest, round: i, rounds, ...where });
        }
      } else if (lastRound) {
        const gap = spec.setRest ?? spec.rest;
        if (gap) out.push({ kind: 'rest', label: 'Set rest', seconds: gap, round: i, rounds, ...where });
      } else if (spec.rest) {
        out.push({ kind: 'rest', label: 'Recover', seconds: spec.rest, round: i, rounds, ...where });
      }
    }
  }
  if (spec.cooldown) out.push({ kind: 'cooldown', label: 'Cool-down', seconds: spec.cooldown });
  return out.filter((p) => p.seconds > 0);
}

/** Every-minute-on-the-minute (or every N seconds): one work phase per interval. */
export function emomPhases(rounds: number, every = 60): Phase[] {
  const unit = every === 60 ? 'Minute' : 'Round';
  return Array.from({ length: Math.max(0, Math.round(rounds)) }, (_, i) => ({
    kind: 'work' as const,
    label: `${unit} ${i + 1} of ${rounds}`,
    seconds: every,
    round: i + 1,
    rounds,
  }));
}

export function countdownPhases(seconds: number, label = 'Rest'): Phase[] {
  return seconds > 0 ? [{ kind: 'rest', label, seconds }] : [];
}

/** The phases a recipe runs through, with an optional get-ready countdown first. */
export function buildPhases(spec: TimerSpec, prep = 0): Phase[] {
  let phases: Phase[];
  switch (spec.mode) {
    case 'countdown':
      phases = countdownPhases(spec.seconds, 'Countdown');
      break;
    case 'stopwatch':
      phases = [{ kind: 'work', label: 'Stopwatch', seconds: OPEN_SECONDS, open: true }];
      break;
    case 'intervals':
      phases = spec.work > 0 ? intervalPhases(spec) : [];
      break;
    case 'emom':
      phases = spec.every > 0 ? emomPhases(spec.rounds, spec.every) : [];
      break;
    case 'amrap':
      phases = spec.seconds > 0 ? [{ kind: 'work', label: 'As many rounds as possible', seconds: spec.seconds }] : [];
      break;
  }
  if (phases.length && prep > 0) phases.unshift({ kind: 'prep', label: 'Get ready', seconds: prep });
  return phases;
}

export const totalSeconds = (phases: Phase[]): number => phases.reduce((a, p) => a + p.seconds, 0);

/** "1:30", or "1:05:00" past the hour. */
export function clock(total: number): string {
  const t = Math.max(0, Math.round(total));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** One line that says what a recipe does: "8 × (0:20 work, 0:10 rest)". */
export function describeSpec(spec: TimerSpec): string {
  switch (spec.mode) {
    case 'countdown':
      return 'Single countdown';
    case 'stopwatch':
      return 'Counts up, with laps';
    case 'emom':
      return `${spec.rounds} × ${clock(spec.every)}`;
    case 'amrap':
      return `As many rounds as possible in ${clock(spec.seconds)}`;
    case 'intervals': {
      const sets = Math.max(1, spec.sets ?? 1);
      const block = `${spec.rounds} × (${clock(spec.work)} work${spec.rest ? `, ${clock(spec.rest)} rest` : ''})`;
      return [
        spec.warmup ? `${clock(spec.warmup)} warm-up` : '',
        sets > 1 ? `${sets} sets of ${block}` : block,
        spec.cooldown ? `${clock(spec.cooldown)} cool-down` : '',
      ]
        .filter(Boolean)
        .join(' · ');
    }
  }
}

/** How long a recipe lasts, or undefined for a stopwatch. */
export function specSeconds(spec: TimerSpec): number | undefined {
  return spec.mode === 'stopwatch' ? undefined : totalSeconds(buildPhases(spec));
}

export interface TimerPosition {
  done: boolean;
  index: number;
  phase?: Phase;
  /** Seconds left in the current phase. */
  remaining: number;
  /** Seconds left overall. */
  totalRemaining: number;
}

/** Where a timer is after `elapsed` seconds. Pure, so the display survives a throttled tab. */
export function positionAt(phases: Phase[], elapsed: number): TimerPosition {
  const total = totalSeconds(phases);
  let t = Math.max(0, elapsed);
  for (let i = 0; i < phases.length; i++) {
    if (t < phases[i].seconds) {
      return {
        done: false,
        index: i,
        phase: phases[i],
        remaining: phases[i].seconds - t,
        totalRemaining: total - Math.max(0, elapsed),
      };
    }
    t -= phases[i].seconds;
  }
  return { done: true, index: phases.length, remaining: 0, totalRemaining: 0 };
}

const startOf = (phases: Phase[], index: number): number => totalSeconds(phases.slice(0, index));

/**
 * The elapsed time that lands at the start of a neighbouring phase.
 * Going back restarts the current phase first, unless it has only just begun.
 */
export function skipTo(phases: Phase[], elapsed: number, by: 1 | -1): number {
  const pos = positionAt(phases, elapsed);
  if (pos.done) return by < 0 ? startOf(phases, Math.max(0, phases.length - 1)) : elapsed;
  if (by > 0) return startOf(phases, pos.index + 1);
  const into = (pos.phase?.seconds ?? 0) - pos.remaining;
  return startOf(phases, into > 3 ? pos.index : Math.max(0, pos.index - 1));
}

const sameSpot = (a: Phase, b: Phase): boolean => a.kind === b.kind && a.round === b.round && a.set === b.set;

/**
 * Add or take away rounds while a timer runs. Returns the new recipe, its phases and the elapsed
 * time that keeps the clock exactly where it is, or undefined when that is not possible
 * (wrong kind of timer, already past the rounds, or it would cut the round in progress).
 */
export function adjustRounds(
  spec: TimerSpec,
  phases: Phase[],
  elapsed: number,
  by: number,
): { spec: TimerSpec; phases: Phase[]; elapsed: number } | undefined {
  if (spec.mode !== 'intervals' && spec.mode !== 'emom') return undefined;
  const rounds = spec.rounds + by;
  if (rounds < 1) return undefined;
  const pos = positionAt(phases, elapsed);
  if (pos.done || !pos.phase) return undefined;
  const next: TimerSpec = { ...spec, rounds };
  const prep = phases[0]?.kind === 'prep' ? phases[0].seconds : 0;
  const rebuilt = buildPhases(next, prep);
  const here = pos.phase;
  const index = rebuilt.findIndex((p) => sameSpot(p, here));
  if (index < 0) return undefined;
  // Keep however long the current phase has been stretched or trimmed to.
  rebuilt[index] = { ...rebuilt[index], seconds: here.seconds };
  return { spec: next, phases: rebuilt, elapsed: startOf(rebuilt, index) + (here.seconds - pos.remaining) };
}

/** The timers a new install starts with. Fixed ids, so two devices never end up with doubles. */
export const DEFAULT_TIMERS: TimerPreset[] = [
  { id: 'preset-rest-90', name: 'Rest 1:30', spec: { mode: 'countdown', seconds: 90 } },
  { id: 'preset-tabata', name: 'Tabata', spec: { mode: 'intervals', work: 20, rest: 10, rounds: 8 } },
  { id: 'preset-emom-10', name: 'EMOM 10', spec: { mode: 'emom', every: 60, rounds: 10 } },
  { id: 'preset-amrap-10', name: 'AMRAP 10 min', spec: { mode: 'amrap', seconds: 600 } },
  {
    id: 'preset-norwegian-4x4',
    name: 'Norwegian 4×4',
    spec: { mode: 'intervals', warmup: 600, work: 240, rest: 180, rounds: 4, cooldown: 300 },
  },
].map((p, order) => ({ ...p, order }) as TimerPreset);
