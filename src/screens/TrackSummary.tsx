import { lazy, Suspense, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Track, type Workout } from '../db/schema';
import { download } from '../lib/download';
import { ACTIVITY_LABEL, formatDistance, formatDuration, formatPace, splits, toGpx, UNIT_METRES } from '../lib/track';
import { importGpx, useDistanceUnit } from '../trackContext';
import { NumInput, useFeedback } from '../ui';

const TrackMap = lazy(() => import('./TrackMap'));

/** Time for each kilometre or mile of a route. */
export function SplitList({ track, limit }: { track: Pick<Track, 'segments' | 'activity'>; limit?: number }) {
  const [unit] = useDistanceUnit();
  const list = splits(track.segments, UNIT_METRES[unit], track.activity);
  if (list.length < 2) return null;
  const shown = limit ? list.slice(-limit).reverse() : list;
  return (
    <div className="card flush">
      {shown.map((s) => (
        <div key={s.n} className="row">
          <div className="grow">
            <div className="title">{s.partial ? formatDistance(s.metres, unit) : `${unit === 'km' ? 'Kilometre' : 'Mile'} ${s.n}`}</div>
          </div>
          <span className="sub">{formatPace(s.seconds, s.metres, unit)}</span>
          <b className="split-time">{formatDuration(s.seconds)}</b>
        </div>
      ))}
    </div>
  );
}

/** Pick a GPX file and attach its route to a session. */
export function GpxImport({ workout, className = 'btn', label = 'Import GPX file' }: { workout: Workout; className?: string; label?: string }) {
  const { toast } = useFeedback();
  const ref = useRef<HTMLInputElement>(null);
  const onFile = async (file: File | undefined) => {
    if (ref.current) ref.current.value = '';
    if (!file) return;
    try {
      const track = await importGpx(await file.text(), workout);
      toast(`Route added: ${formatDistance(track.metres)}.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That file could not be read.');
    }
  };
  return (
    <>
      <button className={className} onClick={() => ref.current?.click()}>
        {label}
      </button>
      <input ref={ref} type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" hidden onChange={(e) => onFile(e.target.files?.[0])} />
    </>
  );
}

/** The routes recorded for a session: map, distance, time, pace and splits. */
export default function TrackSummary({ workout }: { workout: Workout }) {
  const { confirm } = useFeedback();
  const [unit] = useDistanceUnit();
  const [open, setOpen] = useState<string>();
  const tracks = useLiveQuery(() => db.tracks.where('workoutId').equals(workout.id).sortBy('startedAt'), [workout.id]);
  const done = (tracks ?? []).filter((t) => t.endedAt && t.segments.length);
  if (!done.length) return null;

  const remove = async (t: Track) => {
    const ok = await confirm({ title: 'Remove this route?', body: 'The session itself is kept.', action: 'Remove route', danger: true });
    if (ok) await db.tracks.delete(t.id);
  };

  return (
    <>
      {done.map((t) => (
        <div key={t.id} className="card stack track-card">
          <Suspense fallback={<div className="track-map" />}>
            <TrackMap segments={t.segments} />
          </Suspense>
          <div className="tiles">
            <div className="tile">
              <div>
                <b>{formatDistance(t.metres, unit)}</b>
                <small>{ACTIVITY_LABEL[t.activity]}</small>
              </div>
            </div>
            <div className="tile">
              <div>
                <b>{formatDuration(t.seconds)}</b>
                <small>Moving time</small>
              </div>
            </div>
            <div className="tile">
              <div>
                <b>{formatPace(t.seconds, t.metres, unit)}</b>
                <small>Pace</small>
              </div>
            </div>
          </div>
          {open === t.id && <SplitList track={t} />}
          {/* Typed in from a watch for now; the same fields can take a device's numbers later. */}
          <div className="hr-row">
            <span>Heart rate</span>
            <NumInput ariaLabel="Average heart rate" unit="avg" value={t.avgHr} onCommit={(v) => db.tracks.update(t.id, { avgHr: v || undefined })} />
            <NumInput ariaLabel="Highest heart rate" unit="max" value={t.maxHr} onCommit={(v) => db.tracks.update(t.id, { maxHr: v || undefined })} />
          </div>
          <div className="inline">
            <button className="btn small ghost" onClick={() => setOpen(open === t.id ? undefined : t.id)}>
              {open === t.id ? 'Hide splits' : 'Splits'}
            </button>
            <button
              className="btn small ghost"
              onClick={() => download(`${workout.date}-${ACTIVITY_LABEL[t.activity].toLowerCase()}.gpx`, toGpx(t.segments, workout.title), 'application/gpx+xml')}
            >
              Export GPX
            </button>
            <button className="btn small ghost danger" onClick={() => remove(t)}>
              Remove
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
