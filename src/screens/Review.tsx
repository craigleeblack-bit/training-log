import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Exercise, type Track } from '../db/schema';
import { hasValue } from '../db/queries';
import { BarChart, LineChart, type Point } from '../charts';
import { isoDate, niceDate } from '../lib/dates';
import { CATEGORIES, CATEGORY_LABEL, categoryOf } from '../lib/categories';
import { ON_FOOT, personalBests, trackPace, weeklyDistance } from '../lib/running';
import { weeksAgo } from '../lib/stats';
import { formatDistance, formatDuration, UNIT_METRES } from '../lib/track';
import { useDistanceUnit } from '../trackContext';
import { Icon, Page, SectionTitle } from '../ui';
import { ProgressBody } from './Progress';

/** "4:52" a kilometre (or mile). */
const paceText = (secondsPerKm: number, perUnit: number) => {
  const s = Math.round((secondsPerKm * perUnit) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Runs and walks: pace over time, distance each week, and the fastest 1, 5 and 10 km. */
function Running({ tracks }: { tracks: Track[] }) {
  const [unit] = useDistanceUnit();
  const today = isoDate();
  const perUnit = UNIT_METRES[unit];
  // Finished recordings and imported routes; one still being recorded has no end yet.
  const onFoot = tracks.filter((t) => ON_FOOT.includes(t.activity) && (t.endedAt != null || t.source === 'gpx'));
  if (!onFoot.length) return null;
  const runs = onFoot.filter((t) => t.activity === 'run').sort((a, b) => a.date.localeCompare(b.date) || a.startedAt - b.startedAt);
  const pacePoints: Point[] = runs
    .map((t) => ({ t, pace: trackPace(t) }))
    .filter((x): x is { t: Track; pace: number } => x.pace != null)
    .slice(-30)
    .map(({ t, pace }) => ({ label: niceDate(t.date, today).slice(4), title: `${niceDate(t.date, today)}, ${formatDistance(t.metres, unit)}`, value: pace }));
  const hrPoints: Point[] = runs
    .filter((t) => t.avgHr)
    .slice(-30)
    .map((t) => ({ label: niceDate(t.date, today).slice(4), title: `${niceDate(t.date, today)}${t.maxHr ? `, highest ${t.maxHr}` : ''}`, value: t.avgHr! }));
  const weeks = weeklyDistance(onFoot, weeksAgo(today, 12));
  const weekPoints: Point[] = weeks.map((w) => ({
    label: niceDate(w.week, today).slice(4),
    title: `Week of ${niceDate(w.week, today).slice(4)}`,
    value: Math.round((w.metres / perUnit) * 10) / 10,
  }));
  const bests = personalBests(onFoot);

  return (
    <>
      <SectionTitle>Running</SectionTitle>
      {pacePoints.length >= 2 && (
        <div className="card stack">
          <b>Pace, run by run</b>
          <LineChart points={pacePoints} name="Average pace" unit={`/${unit}`} format={(v) => paceText(v, perUnit)} />
          <p className="sub">Lower is faster.</p>
        </div>
      )}
      {hrPoints.length >= 2 && (
        <div className="card stack">
          <b>Average heart rate</b>
          <LineChart points={hrPoints} name="Average heart rate" unit="bpm" />
        </div>
      )}
      {weekPoints.some((p) => p.value > 0) && (
        <div className="card stack">
          <b>Distance on foot each week</b>
          <BarChart points={weekPoints} name="Distance each week" unit={unit} />
        </div>
      )}
      {bests.length > 0 && (
        <div className="card flush">
          {bests.map((b) => (
            <Link key={b.label} to={`/workout/${b.workoutId}`} className="row">
              <div className="grow">
                <div className="title">Fastest {b.label}</div>
                <div className="sub">
                  {niceDate(b.date, today)} · {paceText((b.seconds / b.metres) * 1000, perUnit)} /{unit}
                </div>
              </div>
              <b>{formatDuration(b.seconds)}</b>
              {Icon.chevRight}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

/** Every exercise you have logged, by section, to open its chart. */
function ExerciseIndex({ exercises, counts }: { exercises: Exercise[]; counts: Map<string, { n: number; last: string }> }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const done = exercises.filter((e) => counts.has(e.id) && (!needle || e.name.toLowerCase().includes(needle)));
  const today = isoDate();
  return (
    <>
      <SectionTitle>Exercises</SectionTitle>
      <input className="input" type="search" placeholder="Search your exercises" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search your exercises" />
      {CATEGORIES.map((c) => {
        const list = done.filter((e) => categoryOf(e) === c).sort((a, b) => a.name.localeCompare(b.name));
        if (!list.length) return null;
        return (
          <div key={c} className="stack">
            <span className="group-label">{CATEGORY_LABEL[c]}</span>
            <div className="card flush">
              {list.map((e) => {
                const k = counts.get(e.id)!;
                return (
                  <Link key={e.id} to={`/exercise/${e.id}`} className="row">
                    <div className="grow">
                      <div className="title">{e.name}</div>
                      <div className="sub">
                        {k.n} session{k.n === 1 ? '' : 's'} · last {niceDate(k.last, today)}
                      </div>
                    </div>
                    {Icon.chevRight}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
      {!done.length && <div className="empty">{needle ? 'No logged exercise matches.' : 'Finished sessions with sets logged show up here.'}</div>}
    </>
  );
}

/** The Review tab: how the training is going, each exercise's chart, and running. */
export default function Review() {
  const data = useLiveQuery(async () => {
    const [exercises, sets, workouts, tracks] = await Promise.all([
      db.exercises.toArray(),
      db.sets.toArray(),
      db.workouts.where('status').equals('done').toArray(),
      db.tracks.toArray(),
    ]);
    const done = new Set(workouts.map((w) => w.id));
    const counts = new Map<string, { n: number; last: string; seen: Set<string> }>();
    for (const s of sets) {
      if (!done.has(s.workoutId) || !hasValue(s)) continue;
      const c = counts.get(s.exerciseId) ?? { n: 0, last: s.date, seen: new Set<string>() };
      if (!c.seen.has(s.workoutId)) {
        c.seen.add(s.workoutId);
        c.n++;
      }
      if (s.date > c.last) c.last = s.date;
      counts.set(s.exerciseId, c);
    }
    return { exercises, counts, tracks: tracks.filter((t) => done.has(t.workoutId)) };
  }, []);

  return (
    <Page title="Review" large>
      <ProgressBody />
      {data && <ExerciseIndex exercises={data.exercises} counts={data.counts} />}
      {data && <Running tracks={data.tracks} />}
      <SectionTitle>Every session</SectionTitle>
      <div className="card flush">
        <Link to="/history" className="row">
          {Icon.clock}
          <div className="grow">
            <div className="title">History</div>
            <div className="sub">Every session you have logged</div>
          </div>
          {Icon.chevRight}
        </Link>
        <Link to="/calendar" className="row">
          {Icon.plan}
          <div className="grow">
            <div className="title">Calendar</div>
            <div className="sub">Month by month</div>
          </div>
          {Icon.chevRight}
        </Link>
      </div>
    </Page>
  );
}
