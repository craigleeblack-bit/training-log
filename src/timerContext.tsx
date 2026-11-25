import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/schema';
import { adjustRounds, positionAt, skipTo, type Phase, type TimerPosition, type TimerSpec } from './lib/timer';
import { useWakeLock } from './lib/wakeLock';

interface TimerState {
  name: string;
  phases: Phase[];
  /** The recipe the phases came from, when there is one: it is what lets rounds be added on the fly. */
  spec?: TimerSpec;
  /** Seconds banked before the last resume. */
  banked: number;
  /** ms timestamp of the last resume, undefined while paused. */
  resumedAt?: number;
  /** Elapsed seconds at each tap of the round / lap button. */
  laps: number[];
}

/** How the timer behaves, the same for every timer. */
export interface TimerPrefs {
  /** Get-ready countdown before a timer starts, in seconds. 0 for none. */
  prep: number;
  sound: boolean;
  vibrate: boolean;
  /** Say "Round 3", "Rest" and so on aloud. */
  voice: boolean;
  /** A beep halfway through each work phase. */
  halfway: boolean;
}

export const DEFAULT_PREFS: TimerPrefs = { prep: 5, sound: true, vibrate: true, voice: false, halfway: false };
const PREFS_KEY = 'timerPrefs';

/** The timer options and a way to change them. They live in the database, so they travel with a backup. */
export function useTimerPrefs(): [TimerPrefs, (changes: Partial<TimerPrefs>) => void] {
  const saved = useLiveQuery(async () => (await db.settings.get(PREFS_KEY))?.value as Partial<TimerPrefs> | undefined, []);
  const prefs = useMemo(() => ({ ...DEFAULT_PREFS, ...saved }), [saved]);
  const set = useCallback(
    (changes: Partial<TimerPrefs>) => void db.settings.put({ key: PREFS_KEY, value: { ...prefs, ...changes } }),
    [prefs],
  );
  return [prefs, set];
}

interface TimerApi {
  active: boolean;
  running: boolean;
  name: string;
  phases: Phase[];
  spec: TimerSpec | undefined;
  position: TimerPosition | undefined;
  /** Seconds the timer has run, pauses excluded. */
  elapsed: number;
  laps: number[];
  start: (phases: Phase[], name: string, spec?: TimerSpec) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  /** Lengthen (or, with a negative number, shorten) the current phase by this many seconds. */
  extend: (seconds: number) => void;
  /** Jump to the next phase, or back to the start of this one (then the one before). */
  skip: (by: 1 | -1) => void;
  /** Add or take away a round. Does nothing when `canAddRound` says it cannot be done. */
  addRound: (by: 1 | -1) => void;
  canAddRound: (by: 1 | -1) => boolean;
  /** Count a round or a lap at this moment. */
  lap: () => void;
  undoLap: () => void;
}

const Ctx = createContext<TimerApi | null>(null);

export function useTimer(): TimerApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTimer outside TimerProvider');
  return v;
}

let audio: AudioContext | undefined;

function beep(freq: number, ms: number, when = 0): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const t = audio.currentTime + when;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + ms / 1000 + 0.05);
  } catch {
    // No audio available: the vibration and display still work.
  }
}

const buzz = (pattern: number | number[]): void => {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
};

function say(text: string): void {
  try {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  } catch {
    /* unsupported */
  }
}

/** What to say aloud when a phase begins. */
function spoken(p: Phase): string {
  switch (p.kind) {
    case 'prep':
      return 'Get ready';
    case 'warmup':
      return 'Warm up';
    case 'cooldown':
      return 'Cool down';
    case 'rest':
      return 'Rest';
    case 'work':
      if (!p.round) return 'Go';
      return p.round === p.rounds && (p.set ?? 1) === (p.sets ?? 1) ? 'Last round' : `Round ${p.round}`;
  }
}

const elapsedOf = (s: TimerState): number => s.banked + (s.resumedAt ? (Date.now() - s.resumedAt) / 1000 : 0);

/* A running timer outlives a reload: it is a start time and a recipe, both easy to keep. */
const STORE_KEY = 'timer-state';
const STALE_AFTER = 600;

function recall(): TimerState | undefined {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return undefined;
    const s = JSON.parse(raw) as TimerState;
    if (!Array.isArray(s.phases) || !s.phases.length) return undefined;
    const total = s.phases.reduce((a, p) => a + p.seconds, 0);
    return elapsedOf(s) > total + STALE_AFTER ? undefined : { ...s, laps: s.laps ?? [] };
  } catch {
    return undefined;
  }
}

function remember(s: TimerState | undefined): void {
  try {
    if (s) localStorage.setItem(STORE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    /* private mode: the timer simply does not survive a reload */
  }
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TimerState | undefined>(recall);
  const [, setTick] = useState(0);
  const [prefs] = useTimerPrefs();
  // A timer picked up after a reload should not replay the cue for the phase it is already in.
  const lastIndex = useRef(-1);
  const restored = useRef(false);
  if (!restored.current) {
    restored.current = true;
    if (state) {
      const pos = positionAt(state.phases, elapsedOf(state));
      lastIndex.current = pos.done ? -2 : pos.index;
    }
  }
  const lastSecond = useRef(-1);
  const halfDone = useRef(-1);

  const elapsed = state ? elapsedOf(state) : 0;
  const position = state ? positionAt(state.phases, elapsed) : undefined;
  const running = !!state?.resumedAt && !position?.done;

  useEffect(() => remember(state), [state]);

  // Re-render while running. The display is always derived from the clock, so a throttled
  // background tab simply catches up when it becomes visible again.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 200);
    return () => window.clearInterval(id);
  }, [running]);

  // Cues: phase changes, the last three seconds of each phase, halfway, and the finish.
  useEffect(() => {
    if (!state || !position) return;
    const tone = (freq: number, ms: number, when?: number) => prefs.sound && beep(freq, ms, when);
    const shake = (pattern: number | number[]) => prefs.vibrate && buzz(pattern);
    if (position.done) {
      if (lastIndex.current !== -2) {
        lastIndex.current = -2;
        tone(880, 180);
        tone(880, 180, 0.25);
        tone(1175, 420, 0.5);
        shake([200, 100, 200, 100, 400]);
        if (prefs.voice) say('Done');
      }
      return;
    }
    if (!running) return;
    const phase = position.phase;
    if (position.index !== lastIndex.current) {
      if (lastIndex.current >= 0) {
        tone(phase?.kind === 'work' ? 1047 : 660, 320);
        shake(300);
      }
      if (prefs.voice && phase && (lastIndex.current >= 0 || phase.kind === 'prep')) say(spoken(phase));
      lastIndex.current = position.index;
      lastSecond.current = -1;
    }
    if (!phase || phase.open) return;
    const secs = Math.ceil(position.remaining);
    if (secs <= 3 && secs >= 1 && secs !== lastSecond.current && phase.seconds > 5) {
      lastSecond.current = secs;
      tone(520, 110);
    }
    if (
      prefs.halfway &&
      phase.kind === 'work' &&
      phase.seconds >= 20 &&
      halfDone.current !== position.index &&
      position.remaining <= phase.seconds / 2
    ) {
      halfDone.current = position.index;
      tone(784, 140);
      tone(784, 140, 0.2);
    }
  });

  useWakeLock(running);

  const start = useCallback(
    (phases: Phase[], name: string, spec?: TimerSpec) => {
      if (!phases.length) return;
      lastIndex.current = 0;
      lastSecond.current = -1;
      halfDone.current = -1;
      if (prefs.sound) beep(1047, 200);
      if (prefs.voice) say(spoken(phases[0]));
      setState({ name, phases, spec, banked: 0, resumedAt: Date.now(), laps: [] });
    },
    [prefs.sound, prefs.voice],
  );

  const pause = useCallback(() => {
    setState((s) => (s?.resumedAt ? { ...s, banked: elapsedOf(s), resumedAt: undefined } : s));
  }, []);

  const resume = useCallback(() => {
    setState((s) => (s && !s.resumedAt ? { ...s, resumedAt: Date.now() } : s));
  }, []);

  const stop = useCallback(() => {
    lastIndex.current = -1;
    setState(undefined);
  }, []);

  /** Put the clock at `to` seconds, running or paused as it was. */
  const moveTo = (s: TimerState, to: number, changes: Partial<TimerState> = {}): TimerState => ({
    ...s,
    ...changes,
    banked: to,
    resumedAt: s.resumedAt ? Date.now() : undefined,
  });

  const extend = useCallback((seconds: number) => {
    setState((s) => {
      if (!s) return s;
      const pos = positionAt(s.phases, elapsedOf(s));
      if (pos.done || !pos.phase || pos.phase.open) return s;
      // Never shorten past the present: leave a second so the phase ends through the normal path.
      const used = pos.phase.seconds - pos.remaining;
      const phases = s.phases.map((p, i) =>
        i === pos.index ? { ...p, seconds: Math.max(Math.ceil(used) + 1, p.seconds + seconds) } : p,
      );
      return { ...s, phases };
    });
  }, []);

  const skip = useCallback((by: 1 | -1) => {
    setState((s) => {
      if (!s) return s;
      const at = elapsedOf(s);
      // Coming back from "finished" restarts the last phase, so the clock must be running again.
      const done = positionAt(s.phases, at).done;
      return moveTo(done ? { ...s, resumedAt: Date.now() } : s, skipTo(s.phases, at, by));
    });
  }, []);

  const addRound = useCallback((by: 1 | -1) => {
    setState((s) => {
      if (!s?.spec) return s;
      const out = adjustRounds(s.spec, s.phases, elapsedOf(s), by);
      return out ? moveTo(s, out.elapsed, { spec: out.spec, phases: out.phases }) : s;
    });
  }, []);

  const lap = useCallback(() => {
    setState((s) => (s ? { ...s, laps: [...s.laps, elapsedOf(s)] } : s));
    if (prefs.vibrate) buzz(60);
  }, [prefs.vibrate]);

  const undoLap = useCallback(() => {
    setState((s) => (s?.laps.length ? { ...s, laps: s.laps.slice(0, -1) } : s));
  }, []);

  const canAddRound = useCallback(
    (by: 1 | -1) => !!state?.spec && !!adjustRounds(state.spec, state.phases, elapsedOf(state), by),
    [state],
  );

  const api = useMemo<TimerApi>(
    () => ({
      active: !!state,
      running,
      name: state?.name ?? '',
      phases: state?.phases ?? [],
      spec: state?.spec,
      position,
      elapsed,
      laps: state?.laps ?? [],
      start,
      pause,
      resume,
      stop,
      extend,
      skip,
      addRound,
      canAddRound,
      lap,
      undoLap,
    }),
    // position is derived from the clock on every render, so depend on its numbers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, running, position?.index, position?.remaining, position?.done, start, pause, resume, stop, extend, skip, addRound, canAddRound, lap, undoLap],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
