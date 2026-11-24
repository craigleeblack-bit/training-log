import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { isoDate, niceDate } from '../lib/dates';
import { Icon, Page } from '../ui';

export default function History() {
  const [params] = useSearchParams();
  const spaceId = params.get('space') ?? undefined;
  const today = isoDate();
  const data = useLiveQuery(async () => {
    const [spaces, workouts] = await Promise.all([db.spaces.toArray(), db.workouts.toArray()]);
    return { spaces, workouts };
  }, []);
  if (!data) return null;
  const spaceById = new Map(data.spaces.map((s) => [s.id, s]));
  const rows = data.workouts
    .filter((w) => w.status !== 'in_progress' && (!spaceId || w.spaceId === spaceId))
    .sort((a, b) => b.date.localeCompare(a.date) || b.startedAt - a.startedAt);

  const months = new Map<string, typeof rows>();
  for (const w of rows) months.set(w.date.slice(0, 7), [...(months.get(w.date.slice(0, 7)) ?? []), w]);
  const monthName = (ym: string) =>
    new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });

  return (
    <Page title={spaceId ? `${spaceById.get(spaceId)?.name ?? ''} history` : 'History'} back>
      {!rows.length && <div className="empty">Nothing logged yet.</div>}
      {[...months].map(([ym, list]) => (
        <div key={ym} className="stack">
          <div className="section-title">
            <span>{monthName(ym)}</span>
            <span>{list.filter((w) => w.status === 'done').length} sessions</span>
          </div>
          <div className="card flush">
            {list.map((w) => (
              <Link key={w.id} to={`/workout/${w.id}`} className="row">
                <span className="dot" style={{ ['--space' as string]: spaceById.get(w.spaceId)?.color }} />
                <div className="grow">
                  <div className="title">{w.title}</div>
                  <div className="sub">
                    {niceDate(w.date, today)}
                    {w.minutes != null ? ` · ${w.minutes} min` : ''}
                    {w.rpe != null ? ` · RPE ${w.rpe}` : ''}
                    {w.backResponse ? ` · back: ${w.backResponse}` : ''}
                  </div>
                </div>
                {w.status === 'skipped' && <span className="badge">Skipped</span>}
                {Icon.chevRight}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </Page>
  );
}
