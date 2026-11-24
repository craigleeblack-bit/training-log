export type PhaseKind = 'prep' | 'work' | 'rest' | 'warmup' | 'cooldown';

export interface Phase {
  kind: PhaseKind;
  label: string;
  seconds: number;
}

export interface IntervalSpec {
  warmup?: number;
  work: number;
  rest: number;
  rounds: number;
  cooldown?: number;
}

/** Work/rest rounds with optional warm-up and cool-down. The final rest is dropped. */
export function intervalPhases(spec: IntervalSpec): Phase[] {
  const out: Phase[] = [];
  if (spec.warmup) out.push({ kind: 'warmup', label: 'Warm-up', seconds: spec.warmup });
  for (let i = 1; i <= spec.rounds; i++) {
    out.push({ kind: 'work', label: `Round ${i} of ${spec.rounds}`, seconds: spec.work });
    if (spec.rest && i < spec.rounds) out.push({ kind: 'rest', label: 'Recover', seconds: spec.rest });
  }
  if (spec.cooldown) out.push({ kind: 'cooldown', label: 'Cool-down', seconds: spec.cooldown });
  return out.filter((p) => p.seconds > 0);
}

/** Every-minute-on-the-minute: one work phase per interval. */
export function emomPhases(rounds: number, every = 60): Phase[] {
  return Array.from({ length: rounds }, (_, i) => ({
    kind: 'work' as const,
    label: `Minute ${i + 1} of ${rounds}`,
    seconds: every,
  }));
}

export function countdownPhases(seconds: number, label = 'Rest'): Phase[] {
  return seconds > 0 ? [{ kind: 'rest', label, seconds }] : [];
}

export const totalSeconds = (phases: Phase[]): number => phases.reduce((a, p) => a + p.seconds, 0);

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

export interface Preset {
  id: string;
  name: string;
  detail: string;
  phases: Phase[];
}

export const PRESETS: Preset[] = [
  { id: 'rest-90', name: 'Rest 1:30', detail: 'Single countdown', phases: countdownPhases(90) },
  { id: 'emom-5', name: 'EMOM 5', detail: '5 × 1 min', phases: emomPhases(5) },
  { id: 'emom-10', name: 'EMOM 10', detail: '10 × 1 min', phases: emomPhases(10) },
  {
    id: 'density-10',
    name: 'Density 10 min',
    detail: 'One 10-minute block',
    phases: [{ kind: 'work', label: 'Work', seconds: 600 }],
  },
  {
    id: 'norwegian-4x4',
    name: 'Norwegian 4×4',
    detail: '10 warm-up · 4 × (4 hard + 3 easy) · 5 cool-down',
    phases: intervalPhases({ warmup: 600, work: 240, rest: 180, rounds: 4, cooldown: 300 }),
  },
];
