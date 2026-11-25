import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, type Activity, type Track, type TrackPoint, type Workout } from './db/schema';
import { isoDate } from './lib/dates';
import { accept, fromGpx, movingSeconds, toPoint, trackMetres, type DistanceUnit, type Fix } from './lib/track';
import { useWakeLock } from './lib/wakeLock';

/** A route while it is being recorded. */
interface Recording {
  id: string;
  workoutId: string;
  activity: Activity;
  startedAt: number;
  segments: TrackPoint[][];
  paused: boolean;
}

interface TrackApi {
  recording: Recording | undefined;
  metres: number;
  /** Time spent moving, in seconds. */
  seconds: number;
  /** How far off the latest GPS reading may be, in metres. Undefined until the first one arrives. */
  accuracy: number | undefined;
  /** Why recording cannot work, when it cannot. */
  problem: string | undefined;
  /** Seconds that went unrecorded because the app was in the background. */
  gap: number | undefined;
  dismissGap: () => void;
  start: (workoutId: string, activity: Activity) => Promise<void>;
  pause: () => void;
  resume: () => void;
  /** Stop and keep the route. Resolves to the saved track. */
  finish: () => Promise<Track | undefined>;
  /** Stop and throw the route away. */
  discard: () => Promise<void>;
}

const Ctx = createContext<TrackApi | null>(null);

export function useTrack(): TrackApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTrack outside TrackProvider');
  return v;
}

const UNIT_KEY = 'distanceUnit';

/** Kilometres or miles, and a way to change it. */
export function useDistanceUnit(): [DistanceUnit, (u: DistanceUnit) => void] {
  const saved = useLiveQuery(async () => (await db.settings.get(UNIT_KEY))?.value as DistanceUnit | undefined, []);
  const set = useCallback((u: DistanceUnit) => void db.settings.put({ key: UNIT_KEY, value: u }), []);
  return [saved === 'mi' ? 'mi' : 'km', set];
}

const asTrack = (r: Recording, endedAt?: number): Track => ({
  id: r.id,
  workoutId: r.workoutId,
  date: isoDate(new Date(r.startedAt)),
  activity: r.activity,
  startedAt: r.startedAt,
  endedAt,
  segments: r.segments.filter((s) => s.length),
  metres: Math.round(trackMetres(r.segments)),
  seconds: Math.round(movingSeconds(r.segments, r.activity)),
  source: 'gps',
});

/** A session's time is the time on the route, unless one was already entered. */
async function fillMinutes(workoutId: string, seconds: number): Promise<void> {
  const w = await db.workouts.get(workoutId);
  if (w && w.minutes == null && seconds >= 30) await db.workouts.update(workoutId, { minutes: Math.max(1, Math.round(seconds / 60)) });
}

/** Attach a GPX file from a watch or another app to a session. */
export async function importGpx(text: string, workout: Workout, activity: Activity = 'run'): Promise<Track> {
  const segments = fromGpx(text);
  const first = segments[0][0][0];
  const lastSeg = segments[segments.length - 1];
  const track: Track = {
    id: uid(),
    workoutId: workout.id,
    date: workout.date,
    activity,
    startedAt: first,
    endedAt: lastSeg[lastSeg.length - 1][0],
    segments,
    metres: Math.round(trackMetres(segments)),
    seconds: Math.round(movingSeconds(segments, activity)),
    source: 'gpx',
  };
  await db.tracks.put(track);
  await fillMinutes(workout.id, track.seconds);
  return track;
}

const STORE_KEY = 'track-recording';

function recall(): Recording | undefined {
  try {
    const r = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Recording | null;
    return r && Array.isArray(r.segments) ? { ...r, segments: r.segments.length ? r.segments : [[]] } : undefined;
  } catch {
    return undefined;
  }
}

function remember(r: Recording | undefined): void {
  try {
    if (r) localStorage.setItem(STORE_KEY, JSON.stringify(r));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    /* storage full or private mode: the recording carries on, it just would not survive a reload */
  }
}

/** Longer than this without a point means the phone stopped listening, not that you stood still. */
const GAP_AFTER = 20_000;
const SAVE_EVERY = 5_000;

export function TrackProvider({ children }: { children: ReactNode }) {
  const [rec, setRec] = useState<Recording>();
  const [accuracy, setAccuracy] = useState<number>();
  const [problem, setProblem] = useState<string>();
  const [gap, setGap] = useState<number>();
  const [, setTick] = useState(0);
  const latest = useRef<Recording>();
  latest.current = rec;
  const savedAt = useRef(0);
  const active = !!rec && !rec.paused;

  // A recording cut short by a reload or a closed app is picked up again, paused.
  useEffect(() => {
    const open = recall();
    if (!open) return;
    void db.workouts.get(open.workoutId).then((w) => {
      if (w) setRec((r) => r ?? { ...open, paused: true });
      else remember(undefined);
    });
  }, []);

  // Keep a copy close behind the live recording, so nothing much is lost if the app dies. It stays
  // on this device until the route is finished: a half-made route is no use to another one.
  useEffect(() => {
    if (!rec) return;
    const now = Date.now();
    if (!rec.paused && now - savedAt.current < SAVE_EVERY) return;
    savedAt.current = now;
    remember(rec);
  }, [rec]);

  const onFix = useCallback((pos: GeolocationPosition) => {
    const fix: Fix = {
      t: pos.timestamp || Date.now(),
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      alt: pos.coords.altitude ?? undefined,
      acc: pos.coords.accuracy,
    };
    setAccuracy(fix.acc);
    setProblem(undefined);
    setRec((r) => {
      if (!r || r.paused) return r;
      const seg = r.segments[r.segments.length - 1] ?? [];
      if (!accept(seg[seg.length - 1], fix, r.activity)) return r;
      return { ...r, segments: [...r.segments.slice(0, -1), [...seg, toPoint(fix)]] };
    });
  }, []);

  // Listen to the GPS only while recording.
  useEffect(() => {
    if (!active) return;
    if (!('geolocation' in navigator)) {
      setProblem('This device has no location service the app can use.');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      onFix,
      (err) =>
        setProblem(
          err.code === err.PERMISSION_DENIED
            ? 'Location access is switched off for this app. Allow it in the browser or phone settings, then start again.'
            : 'No GPS signal yet. It can take a moment outdoors, and rarely works indoors.',
        ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    );
    const tick = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      navigator.geolocation.clearWatch(id);
      window.clearInterval(tick);
    };
  }, [active, onFix]);

  // Phones stop feeding a web page positions once it is in the background. Coming back, say how
  // much was missed and start a fresh line so the map does not draw a straight cut across it.
  useEffect(() => {
    if (!active) return;
    const onShow = () => {
      if (document.visibilityState !== 'visible') return;
      const r = latest.current;
      const seg = r?.segments[r.segments.length - 1];
      const last = seg?.[seg.length - 1];
      if (!r || !last) return;
      const missed = Date.now() - last[0];
      if (missed < GAP_AFTER) return;
      setGap(Math.round(missed / 1000));
      setRec((cur) => (cur && !cur.paused ? { ...cur, segments: [...cur.segments, []] } : cur));
    };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [active]);

  useWakeLock(active);

  const start = useCallback(async (workoutId: string, activity: Activity) => {
    setProblem(undefined);
    setGap(undefined);
    setAccuracy(undefined);
    savedAt.current = 0;
    setRec({ id: uid(), workoutId, activity, startedAt: Date.now(), segments: [[]], paused: false });
  }, []);

  const pause = useCallback(() => setRec((r) => (r ? { ...r, paused: true } : r)), []);

  // Resuming starts a new line: wherever you went while paused is not part of the route.
  const resume = useCallback(() => {
    setGap(undefined);
    setRec((r) => (r ? { ...r, paused: false, segments: [...r.segments, []] } : r));
  }, []);

  const finish = useCallback(async () => {
    const r = latest.current;
    if (!r) return undefined;
    const track = asTrack(r, Date.now());
    setRec(undefined);
    setGap(undefined);
    remember(undefined);
    if (!track.segments.length) return undefined; // nothing was recorded: leave no empty route behind
    await db.tracks.put(track);
    await fillMinutes(track.workoutId, track.seconds);
    return track;
  }, []);

  const discard = useCallback(async () => {
    setRec(undefined);
    setGap(undefined);
    remember(undefined);
  }, []);

  const dismissGap = useCallback(() => setGap(undefined), []);

  const metres = rec ? trackMetres(rec.segments) : 0;
  let seconds = rec ? movingSeconds(rec.segments, rec.activity) : 0;
  if (rec && active) {
    // Between readings, let the clock run on for a few seconds so it does not stutter.
    const seg = rec.segments[rec.segments.length - 1];
    const last = seg?.[seg.length - 1];
    const since = last ? (Date.now() - last[0]) / 1000 : 0;
    if (since > 0 && since < 6) seconds += since;
  }

  const api = useMemo<TrackApi>(
    () => ({ recording: rec, metres, seconds, accuracy, problem, gap, dismissGap, start, pause, resume, finish, discard }),
    [rec, metres, seconds, accuracy, problem, gap, dismissGap, start, pause, resume, finish, discard],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
