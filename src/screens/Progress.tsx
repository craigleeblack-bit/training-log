import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { hasValue } from '../db/queries';
import { BarChart, type Point } from '../charts';
import { isoDate, niceDate } from '../lib/dates';
import { formatMinutes, formatVolume, records, summarise, weeksAgo, type Week } from '../lib/stats';
import { formatDistance } from '../lib/track';
import { useDistanceUnit } from '../trackContext';
import { Chips, Field, Icon, Page, SectionTitle } from '../ui';

const RANGES = [4, 12, 52, 0] as const;
type Range = (typeof RANGES)[number];
const RANGE_LABEL: Record<Range, string> = { 4: '4 weeks', 12: '12 weeks', 52: 'Year', 0: 'All' };

const MEASURES = ['sessions', 'volume', 'minutes'] as const;
type MeasureKey = (typeof MEASURES)[number];
const MEASURE: Record<MeasureKey, { label: string; unit?: string; of: (w: Week) => number }> = {
  sessions: { label: 'Sessions', of: (w) => w.sessions },
  volume: { label: 'Volume', unit: 'kg', of: (w) => Math.round(w.volume) },
  minutes: { label: 'Time', unit: 'min', of: (w) => w.minutes },
};

/** What the training adds up to: totals, week-by-week bars, the run of weeks trained, and bests. */
export default function Progress() {
  const today = isoDate();
  const [unit] = useDistanceUnit();
  const [range, setRange] = useState<Range>(12);
  const [spaceId, setSpaceId] = useState('');
  const [measure, setMeasure] = useState<MeasureKey>('sessions');

  const data = useLiveQuery(async () => {
    const [spaces, workouts, sets, tracks, exercises] = await Promise.all([
      db.spaces.orderBy('order').toArray(),
      db.workouts.toArray(),
      db.sets.toArray(),
      db.tracks.toArray(),
      db.exercises.toArray(),
    ]);
    return { spaces, workouts, sets, tracks, exercises };
  }, []);
  if (!data) return null;

  const since = range ? weeksAgo(today, range) : undefined;
  const filter = { since, spaceId: spaceId || undefined };
  const s = summarise(data, filter, today);
  const m = MEASURE[measure];
  const points: Point[] = s.weeks.slice(-26).map((w) => ({
    label: niceDate(w.start, today).slice(4),
    title: `Week of ${niceDate(w.start, today).slice(4)}`,
    value: m.of(w),
  }));

  // Bests among the exercises trained in this range: the one that says most about each.
  const inScope = new Set(
    data.workouts.filter((w) => w.status === 'done' && (!since || w.date >= since) && (!spaceId || w.spaceId === spaceId)).map((w) => w.id),
  );
  const allDone = new Set(data.workouts.filter((w) => w.status === 'done').map((w) => w.id));
  const trained = new Set(data.sets.filter((x) => inScope.has(x.workoutId)).map((x) => x.exerciseId));
  const bests = data.exercises
    .filter((e) => trained.has(e.id))
    .map((e) => {
      const all = records(data.sets.filter((x) => x.exerciseId === e.id && allDone.has(x.workoutId) && hasValue(x)), e.measure);
      const top = all.find((r) => r.label === 'Best estimated 1RM') ?? all[all.length - 1];
      return top && { e, top, fresh: inScope.has(top.workoutId) };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => Number(b.fresh) - Number(a.fresh) || b.top.date.localeCompare(a.top.date));

  const tiles = [
    { value: String(s.sessions), label: 'Sessions' },
    { value: formatMinutes(s.minutes), label: 'Training time' },
    { value: s.avgRpe != null ? s.avgRpe.toFixed(1) : '–', label: 'Average RPE' },
    { value: s.volume ? formatVolume(s.volume) : '–', label: 'Volume lifted' },
    ...(s.metres ? [{ value: formatDistance(s.metres, unit), label: 'Distance tracked' }] : []),
    { value: `${s.streak} week${s.streak === 1 ? '' : 's'}`, label: 'In a row' },
  ];

  return (
    <Page title="Progress" back="/plan">
      <Chips options={RANGES} value={range} onChange={(v) => v != null && setRange(v)} label={(r) => RANGE_LABEL[r]} />
      {data.spaces.length > 1 && (
        <Field label="Space">
          <select value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
            <option value="">All spaces</option>
            {data.spaces.map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div className="stat-grid">
        {tiles.map((t) => (
          <div key={t.label} className="stat">
            <b>{t.value}</b>
            <small>{t.label}</small>
          </div>
        ))}
      </div>

      {s.sessions > 0 ? (
        <div className="card stack">
          <div className="spread">
            <b>{m.label} each week</b>
          </div>
          <Chips options={MEASURES} value={measure} onChange={(v) => v && setMeasure(v)} label={(k) => MEASURE[k].label} />
          <BarChart points={points} name={`${m.label} each week`} unit={m.unit} />
        </div>
      ) : (
        <div className="empty">No finished sessions in this range yet.</div>
      )}

      {bests.length > 0 && (
        <>
          <SectionTitle>Personal bests</SectionTitle>
          <div className="card flush">
            {bests.slice(0, 30).map(({ e, top, fresh }) => (
              <Link key={e.id} to={`/exercise/${e.id}`} className="row">
                <div className="grow">
                  <div className="title">{e.name}</div>
                  <div className="sub">
                    {top.label}: {top.value} · {niceDate(top.date, today)}
                  </div>
                </div>
                {fresh && <span className="badge ok">New</span>}
                {Icon.chevRight}
              </Link>
            ))}
          </div>
          <p className="sub">Only finished sessions count. "New" marks a best set within the range shown. Open an exercise for its chart and every record.</p>
        </>
      )}
    </Page>
  );
}
