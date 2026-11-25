import { lazy, Suspense, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Activity } from '../db/schema';
import { startWorkout } from '../actions';
import { saveSet } from '../lib/logging';
import { ACTIVITY_LABEL, formatDistance, formatDuration, formatPace, recentPace, type DistanceUnit } from '../lib/track';
import { useDistanceUnit, useTrack } from '../trackContext';
import { Chips, Field, Icon, Page, useFeedback } from '../ui';
import { GpxImport, SplitList } from './TrackSummary';

const TrackMap = lazy(() => import('./TrackMap'));

const ACTIVITIES: readonly Activity[] = ['run', 'walk', 'ride'];
const UNITS: readonly DistanceUnit[] = ['km', 'mi'];
const SPACE_KEY = 'track-space';

function recallSpace(): string | undefined {
  try {
    return localStorage.getItem(SPACE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** "3 min" or "45 s", for telling how long the recording was not listening. */
const roughly = (seconds: number): string => (seconds >= 90 ? `${Math.round(seconds / 60)} min` : `${seconds} s`);

export default function TrackScreen() {
  const { id = 'new' } = useParams();
  const [params] = useSearchParams();
  const itemId = params.get('item') ?? undefined;
  const nav = useNavigate();
  const t = useTrack();
  const { confirm, toast } = useFeedback();
  const [unit, setUnit] = useDistanceUnit();
  const [activity, setActivity] = useState<Activity>('run');
  const [spaceId, setSpaceId] = useState(recallSpace);

  const data = useLiveQuery(async () => {
    const [workout, spaces] = await Promise.all([id === 'new' ? undefined : db.workouts.get(id), db.spaces.orderBy('order').toArray()]);
    return { workout, spaces };
  }, [id]);
  if (!data) return null;
  const { workout, spaces } = data;
  const rec = t.recording;
  const here = !!rec && rec.workoutId === id;
  const space = spaces.find((s) => s.id === spaceId) ?? spaces.find((s) => /out|run|road|park/i.test(s.name)) ?? spaces[0];

  if (id !== 'new' && !workout) {
    return (
      <Page title="Track" back="/">
        <div className="empty">This session no longer exists.</div>
      </Page>
    );
  }

  const begin = async () => {
    let workoutId = id;
    if (id === 'new') {
      if (!space) return;
      try {
        localStorage.setItem(SPACE_KEY, space.id);
      } catch {
        /* private mode */
      }
      workoutId = await startWorkout({ spaceId: space.id, title: ACTIVITY_LABEL[activity] });
      nav(`/track/${workoutId}`, { replace: true });
    }
    await t.start(workoutId, activity);
  };

  const finish = async () => {
    const ok = await confirm({ title: 'Finish recording?', body: 'The route is saved with this session.', action: 'Finish' });
    if (!ok || !rec) return;
    const track = await t.finish();
    if (!track) {
      toast('Nothing was recorded.');
    } else if (itemId && workout) {
      // Started from an exercise: its next set gets the distance and time.
      const item = workout.items.find((i) => i.id === itemId);
      const exercise = item && (await db.exercises.get(item.exerciseId));
      if (item && exercise) {
        const entries = await db.sets.where('workoutId').equals(workout.id).filter((s) => s.itemId === item.id).toArray();
        const taken = new Set(entries.filter((e) => e.metres != null || e.seconds != null).map((e) => e.setNo));
        let setNo = 1;
        while (taken.has(setNo)) setNo++;
        const values = exercise.measure === 'time' ? { seconds: track.seconds } : { metres: track.metres, seconds: track.seconds };
        if (exercise.measure === 'time' || exercise.measure === 'distance') await saveSet(workout, item, exercise, setNo, values);
      }
    }
    nav(`/workout/${rec.workoutId}`, { replace: true });
  };

  const discard = async () => {
    const ok = await confirm({ title: 'Discard this recording?', body: 'The route so far is deleted.', action: 'Discard', danger: true });
    if (ok) await t.discard();
  };

  /* ── Recording, or paused ── */
  if (here && rec) {
    const pace = recentPace(rec.segments);
    return (
      <Page title={ACTIVITY_LABEL[rec.activity]} kicker={workout?.title !== ACTIVITY_LABEL[rec.activity] ? workout?.title : undefined} back={`/workout/${rec.workoutId}`}>
        <Suspense fallback={<div className="track-map tall" />}>
          <div className="track-map-wrap tall">
            <TrackMap segments={rec.segments} follow />
          </div>
        </Suspense>

        {t.problem && <div className="notice warn">{t.problem}</div>}
        {t.gap != null && (
          <button className="notice warn" onClick={t.dismissGap}>
            Nothing was recorded for {roughly(t.gap)} while the app was in the background. Keep the screen on and this app in front. Tap to
            dismiss.
          </button>
        )}

        <div className="track-stats">
          <div className="big">
            <b>{formatDuration(t.seconds)}</b>
            <small>{rec.paused ? 'Paused' : 'Moving time'}</small>
          </div>
          <div>
            <b>{formatDistance(t.metres, unit)}</b>
            <small>Distance</small>
          </div>
          <div>
            <b>{formatPace(t.seconds, t.metres, unit)}</b>
            <small>Average pace</small>
          </div>
          <div>
            <b>{pace ? formatPace(pace * 1000, 1000, unit) : '–'}</b>
            <small>Pace now</small>
          </div>
          <div>
            <b>{t.accuracy != null ? `±${Math.round(t.accuracy)} m` : '…'}</b>
            <small>{t.accuracy != null ? 'GPS accuracy' : 'Finding GPS'}</small>
          </div>
        </div>

        <div className="grid-2">
          {rec.paused ? (
            <button className="btn primary big" onClick={t.resume}>
              {Icon.play}
              Resume
            </button>
          ) : (
            <button className="btn big" onClick={t.pause}>
              {Icon.pause}
              Pause
            </button>
          )}
          <button className={`btn big${rec.paused ? '' : ' primary'}`} onClick={finish}>
            {Icon.check}
            Finish
          </button>
        </div>

        <SplitList track={rec} limit={5} />

        <p className="sub">The screen is kept awake. Recording needs it on, with this app in front: a locked phone stops it.</p>
        <button className="btn ghost danger" onClick={discard}>
          Discard recording
        </button>
      </Page>
    );
  }

  /* ── Another session's recording is still running ── */
  if (rec) {
    return (
      <Page title="Track" back="/">
        <div className="card stack">
          <p>A recording is already under way for another session.</p>
          <Link className="btn primary" to={`/track/${rec.workoutId}`}>
            Go to it
          </Link>
        </div>
      </Page>
    );
  }

  /* ── Ready to start ── */
  return (
    <Page title="Track with GPS" kicker={workout?.title} back={workout ? `/workout/${workout.id}` : '/'}>
      <div className="field">
        <span>Activity</span>
        <Chips options={ACTIVITIES} value={activity} onChange={(v) => v && setActivity(v)} label={(a) => ACTIVITY_LABEL[a]} />
      </div>
      {id === 'new' && spaces.length > 1 && (
        <Field label="Log it in">
          <select value={space?.id ?? ''} onChange={(e) => setSpaceId(e.target.value)}>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="field">
        <span>Distances in</span>
        <Chips options={UNITS} value={unit} onChange={(v) => v && setUnit(v)} label={(u) => (u === 'km' ? 'Kilometres' : 'Miles')} />
      </div>

      {id === 'new' && !spaces.length ? (
        <Link className="btn primary big block" to="/">
          Create a space first
        </Link>
      ) : (
        <button className="btn primary big block" onClick={begin}>
          {Icon.route}
          Start recording
        </button>
      )}

      <div className="card stack">
        <p>
          Shows your route on a map with time, distance, pace and splits. Your phone will ask to share its location the first time.
        </p>
        <p className="sub">
          A web app can only follow you while the screen is on and the app is in front, so the screen is kept awake for you: carry the
          phone unlocked, in an armband or hand. For a run with the phone locked in a pocket, record with a watch or another app and
          bring the GPX file in afterwards.
        </p>
        {workout && <GpxImport workout={workout} />}
      </div>
    </Page>
  );
}
