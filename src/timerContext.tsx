import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { positionAt, type Phase, type TimerPosition } from './lib/timer';

interface TimerState {
  name: string;
  phases: Phase[];
  /** Seconds banked before the last resume. */
  banked: number;
  /** ms timestamp of the last resume, undefined while paused. */
  resumedAt?: number;
}

interface TimerApi {
  active: boolean;
  running: boolean;
  name: string;
  phases: Phase[];
  position: TimerPosition | undefined;
  start: (phases: Phase[], name: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  /** Lengthen (or, with a negative number, shorten) the current phase by this many seconds. */
  extend: (seconds: number) => void;
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

export function TimerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TimerState>();
  const [, setTick] = useState(0);
  const lastIndex = useRef(-1);
  const lastSecond = useRef(-1);
  const wakeLock = useRef<WakeLockSentinel | null>(null);

  const elapsed = state ? state.banked + (state.resumedAt ? (Date.now() - state.resumedAt) / 1000 : 0) : 0;
  const position = state ? positionAt(state.phases, elapsed) : undefined;
  const running = !!state?.resumedAt && !position?.done;

  // Re-render while running. The display is always derived from the clock, so a throttled
  // background tab simply catches up when it becomes visible again.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 200);
    return () => window.clearInterval(id);
  }, [running]);

  // Cues: phase changes, the last three seconds of each phase, and the finish.
  useEffect(() => {
    if (!state || !position) return;
    if (position.done) {
      if (lastIndex.current !== -2) {
        lastIndex.current = -2;
        beep(880, 180);
        beep(880, 180, 0.25);
        beep(1175, 420, 0.5);
        buzz([200, 100, 200, 100, 400]);
      }
      return;
    }
    if (!running) return;
    if (position.index !== lastIndex.current) {
      if (lastIndex.current >= 0) {
        beep(position.phase?.kind === 'work' ? 1047 : 660, 320);
        buzz(300);
      }
      lastIndex.current = position.index;
      lastSecond.current = -1;
    }
    const secs = Math.ceil(position.remaining);
    if (secs <= 3 && secs >= 1 && secs !== lastSecond.current && (position.phase?.seconds ?? 0) > 5) {
      lastSecond.current = secs;
      beep(520, 110);
    }
  });

  // Keep the screen on while a timer runs.
  useEffect(() => {
    let cancelled = false;
    const acquire = async () => {
      try {
        if (running && !wakeLock.current && 'wakeLock' in navigator && document.visibilityState === 'visible') {
          const lock = await navigator.wakeLock.request('screen');
          if (cancelled) void lock.release();
          else {
            wakeLock.current = lock;
            lock.addEventListener('release', () => (wakeLock.current = null));
          }
        }
      } catch {
        /* denied or unsupported */
      }
    };
    if (running) {
      void acquire();
      document.addEventListener('visibilitychange', acquire);
    } else {
      void wakeLock.current?.release();
      wakeLock.current = null;
    }
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
    };
  }, [running]);

  const start = useCallback((phases: Phase[], name: string) => {
    if (!phases.length) return;
    lastIndex.current = 0;
    lastSecond.current = -1;
    beep(1047, 200);
    setState({ name, phases, banked: 0, resumedAt: Date.now() });
  }, []);

  const pause = useCallback(() => {
    setState((s) =>
      s?.resumedAt ? { ...s, banked: s.banked + (Date.now() - s.resumedAt) / 1000, resumedAt: undefined } : s,
    );
  }, []);

  const resume = useCallback(() => {
    setState((s) => (s && !s.resumedAt ? { ...s, resumedAt: Date.now() } : s));
  }, []);

  const stop = useCallback(() => {
    lastIndex.current = -1;
    setState(undefined);
  }, []);

  const extend = useCallback((seconds: number) => {
    setState((s) => {
      if (!s) return s;
      const at = s.banked + (s.resumedAt ? (Date.now() - s.resumedAt) / 1000 : 0);
      const pos = positionAt(s.phases, at);
      if (pos.done || !pos.phase) return s;
      // Never shorten past the present: leave a second so the phase ends through the normal path.
      const used = pos.phase.seconds - pos.remaining;
      const phases = s.phases.map((p, i) =>
        i === pos.index ? { ...p, seconds: Math.max(Math.ceil(used) + 1, p.seconds + seconds) } : p,
      );
      return { ...s, phases };
    });
  }, []);

  const api = useMemo<TimerApi>(
    () => ({
      active: !!state,
      running,
      name: state?.name ?? '',
      phases: state?.phases ?? [],
      position,
      start,
      pause,
      resume,
      stop,
      extend,
    }),
    // position is derived from the clock on every render, so depend on its numbers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, running, position?.index, position?.remaining, position?.done, start, pause, resume, stop, extend],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
