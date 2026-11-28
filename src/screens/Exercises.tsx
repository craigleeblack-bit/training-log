import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, MEASURE_LABEL, uid, type ComplexPart, type Exercise, type Link as ExLink, type Measure } from '../db/schema';
import {
  complexTotals,
  describeParts,
  exerciseHistory,
  summariseSets,
  totalRounds,
  type ExerciseSession,
} from '../db/queries';
import { niceDate } from '../lib/dates';
import { buildExerciseContext } from '../lib/claude';
import { useAskClaude } from '../actions';
import { CATEGORIES, CATEGORY_LABEL, categoryOf, guessCategory, type ExerciseCategory } from '../lib/categories';
import { cleanUrl, videoFor, videoSearchUrl } from '../lib/videos';
import { METRIC_LABEL, METRIC_UNIT, metricsFor, metricValue, records, sideGap, type Metric } from '../lib/stats';
import { LineChart } from '../charts';
import { Chips, Field, Icon, MultiChips, Page, SectionTitle, Sheet, useFeedback } from '../ui';
import { EQUIPMENT, equipmentLabel, kitList, needsOf } from '../lib/equipment';

const nonEmpty = <T,>(list: T[]): T[] | undefined => (list.length ? list : undefined);

const OPEN_KEY = 'exercise-sections-open';

/** Which sections were left open, on this device. */
function recallOpen(): ExerciseCategory[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]');
    return Array.isArray(v) ? (v as ExerciseCategory[]) : [];
  } catch {
    return [];
  }
}

export function ExerciseList() {
  const nav = useNavigate();
  const exercises = useLiveQuery(() => db.exercises.orderBy('name').toArray(), []);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(recallOpen);
  if (!exercises) return null;
  const needle = q.trim().toLowerCase();
  const shown = exercises.filter((e) => e.name.toLowerCase().includes(needle));
  const sections = CATEGORIES.map((c) => ({ c, list: exercises.filter((e) => categoryOf(e) === c) })).filter(
    (s) => s.list.length,
  );

  const toggle = (c: ExerciseCategory) => {
    const next = open.includes(c) ? open.filter((x) => x !== c) : [...open, c];
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    } catch {
      /* private mode: the sections simply start closed next time */
    }
  };

  const add = async () => {
    const name = q.trim() || 'New exercise';
    const e: Exercise = { id: uid(), name, measure: 'weight_reps', category: guessCategory(name), links: [] };
    await db.exercises.add(e);
    nav(`/exercise/${e.id}?edit=1`);
  };

  const row = (e: Exercise) => (
    <Link key={e.id} to={`/exercise/${e.id}`} className="row">
      <div className="grow">
        <div className="title">{e.name}</div>
        <div className="sub">{[e.equipment, MEASURE_LABEL[e.measure]].filter(Boolean).join(' · ')}</div>
      </div>
      {Icon.chevRight}
    </Link>
  );

  return (
    <Page
      title="Exercises"
      back="/library"
      actions={
        <button className="btn small" onClick={add}>
          + New
        </button>
      }
    >
      <input className="input" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      {needle ? (
        <div className="card flush">
          {shown.map(row)}
          {!shown.length && <div className="empty">No matches.</div>}
        </div>
      ) : (
        sections.map(({ c, list }) => {
          const isOpen = open.includes(c);
          return (
            <div key={c} className="card flush">
              <button className="row section-row" aria-expanded={isOpen} onClick={() => toggle(c)}>
                <div className="grow">
                  <div className="title">{CATEGORY_LABEL[c]}</div>
                </div>
                <span className="badge">{list.length}</span>
                <span className={`chev${isOpen ? ' open' : ''}`}>{Icon.chevDown}</span>
              </button>
              {isOpen && list.map(row)}
            </div>
          );
        })
      )}
      {!exercises.length && <div className="empty">No exercises yet. They appear here as you build routines.</div>}
    </Page>
  );
}

/** Opens the exercise's technique video, or a search for one when none is saved. */
export function VideoButton({ exercise }: { exercise: Exercise }) {
  const video = videoFor(exercise);
  return (
    <a className="btn" href={video ?? videoSearchUrl(exercise.name)} target="_blank" rel="noopener noreferrer">
      {Icon.video}
      {video ? 'Watch video' : 'Find a video'}
    </a>
  );
}

/** An exercise's progress by a chosen measure, with its bests underneath. */
function ProgressCard({ sessions, measure }: { sessions: ExerciseSession[]; measure: Measure }) {
  const options = metricsFor(measure);
  const [metric, setMetric] = useState<Metric>(options[0]);
  const points = [...sessions]
    .reverse()
    .map((s) => ({ date: s.date, v: metricValue(s.sets, metric) }))
    .filter((p): p is { date: string; v: number } => p.v != null)
    .slice(-30)
    .map((p) => ({ label: niceDate(p.date).slice(4), title: niceDate(p.date), value: p.v }));
  const bests = records(sessions.flatMap((s) => s.sets), measure);
  const gap = sideGap(sessions[0]?.sets ?? []);
  if (points.length < 2 && !bests.length) return null;
  return (
    <div className="card stack">
      {options.length > 1 && <Chips options={options} value={metric} onChange={(v) => v && setMetric(v)} label={(k) => METRIC_LABEL[k]} />}
      {points.length >= 2 ? (
        <LineChart points={points} name={METRIC_LABEL[metric]} unit={METRIC_UNIT[metric]} />
      ) : (
        <p className="sub">A chart appears after two sessions.</p>
      )}
      {bests.map((r) => (
        <Link key={r.label} to={`/workout/${r.workoutId}`} className="spread record">
          <span className="sub">{r.label}</span>
          <b>{r.value}</b>
        </Link>
      ))}
      {gap && (
        <p className="sub">
          Last time the {gap.stronger === 'L' ? 'left' : 'right'} side did {Math.round(gap.share * 100)}% more.
        </p>
      )}
    </div>
  );
}

function EditForm({ exercise, onClose }: { exercise: Exercise; onClose: () => void }) {
  const [e, setE] = useState<Exercise>(exercise);
  const set = (changes: Partial<Exercise>) => setE((prev) => ({ ...prev, ...changes }));
  const setLink = (i: number, changes: Partial<ExLink>) =>
    set({ links: e.links.map((l, j) => (j === i ? { ...l, ...changes } : l)) });
  const setPart = (i: number, changes: Partial<ComplexPart>) =>
    set({ parts: (e.parts ?? []).map((p, j) => (j === i ? { ...p, ...changes } : p)) });
  const save = async () => {
    await db.exercises.put({
      ...e,
      name: e.name.trim() || exercise.name,
      equipment: e.equipment?.trim() || undefined,
      video: cleanUrl(e.video),
      // A recipe only means something for an exercise counted in rounds; empty rows are dropped.
      parts: e.measure === 'rounds' ? nonEmpty((e.parts ?? []).map((p) => ({ ...p, name: p.name.trim() })).filter((p) => p.name && p.reps > 0)) : undefined,
      cues: e.cues?.trim() || undefined,
      adjustments: e.adjustments?.trim() || undefined,
      links: e.links
        .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
        .filter((l) => /^https?:\/\//i.test(l.url))
        .map((l) => ({ ...l, label: l.label || l.url })),
    });
    onClose();
  };
  return (
    <Sheet title="Edit exercise" onClose={onClose}>
      <Field label="Name">
        <input value={e.name} onChange={(ev) => set({ name: ev.target.value })} />
      </Field>
      <div className="field">
        <span>Measured by</span>
        <Chips
          options={Object.keys(MEASURE_LABEL) as Measure[]}
          value={e.measure}
          onChange={(v) => v && set({ measure: v })}
          label={(m) => MEASURE_LABEL[m]}
        />
      </div>
      <div className="field">
        <span>Section</span>
        <Chips
          options={CATEGORIES}
          value={categoryOf(e)}
          onChange={(v) => v && set({ category: v })}
          label={(c) => CATEGORY_LABEL[c]}
        />
      </div>
      <label className="inline">
        <input type="checkbox" checked={!!e.unilateral} onChange={(ev) => set({ unilateral: ev.target.checked || undefined })} />
        Done one side at a time (log left and right)
      </label>
      {e.measure === 'rounds' && (
        <div className="field">
          <span>What one round is made of</span>
          {(e.parts ?? []).map((p, i) => (
            <div key={i} className="part-row">
              <input
                className="input"
                inputMode="numeric"
                aria-label="Reps"
                value={p.reps || ''}
                placeholder="2"
                onChange={(ev) => setPart(i, { reps: Math.max(0, Math.round(Number(ev.target.value) || 0)) })}
              />
              <input className="input" aria-label="Movement" value={p.name} placeholder="Double clean" onChange={(ev) => setPart(i, { name: ev.target.value })} />
            </div>
          ))}
          <button
            className="btn small ghost"
            style={{ justifySelf: 'start' }}
            onClick={() => set({ parts: [...(e.parts ?? []), { name: '', reps: 1 }] })}
          >
            + Add a movement
          </button>
        </div>
      )}
      <div className="field">
        <span>Needs</span>
        <MultiChips
          ariaLabel="Needs"
          options={EQUIPMENT.map((x) => x.key)}
          value={needsOf(e)}
          onChange={(needs) => set({ needs })}
          label={equipmentLabel}
        />
        <span className="sub" style={{ fontWeight: 400 }}>
          {e.needs ? (needsOf(e).length ? '' : 'Nothing: possible anywhere.') : 'Guessed from the name. Tap to correct it.'}
        </span>
      </div>
      <Field label="Equipment note">
        <input value={e.equipment ?? ''} placeholder="2 × 16 kg kettlebells" onChange={(ev) => set({ equipment: ev.target.value })} />
      </Field>
      <Field label="Video link">
        <input
          value={e.video ?? ''}
          inputMode="url"
          placeholder={videoFor({ ...e, video: undefined }) ?? 'https://youtube.com/…'}
          onChange={(ev) => set({ video: ev.target.value })}
        />
      </Field>
      <Field label="How to perform / cues">
        <textarea value={e.cues ?? ''} onChange={(ev) => set({ cues: ev.target.value })} />
      </Field>
      <Field label="Adjustments / progression">
        <textarea value={e.adjustments ?? ''} onChange={(ev) => set({ adjustments: ev.target.value })} />
      </Field>
      <div className="field">
        <span>Links (videos, articles)</span>
        {e.links.map((l, i) => (
          <div key={i} className="grid-2">
            <input className="input" value={l.label} placeholder="Label" onChange={(ev) => setLink(i, { label: ev.target.value })} />
            <input className="input" value={l.url} placeholder="https://…" inputMode="url" onChange={(ev) => setLink(i, { url: ev.target.value })} />
          </div>
        ))}
        <button className="btn small ghost" style={{ justifySelf: 'start' }} onClick={() => set({ links: [...e.links, { label: '', url: '' }] })}>
          + Add link
        </button>
      </div>
      <button className="btn primary block" onClick={save}>
        Save
      </button>
    </Sheet>
  );
}

export function ExerciseDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { confirm } = useFeedback();
  const ask = useAskClaude();
  const [editing, setEditing] = useState(() => new URLSearchParams(window.location.hash.split('?')[1]).has('edit'));

  const data = useLiveQuery(async () => {
    const exercise = await db.exercises.get(id);
    if (!exercise) return { exercise: null };
    const [history, routines, spaces] = await Promise.all([
      exerciseHistory(db, exercise),
      db.routines.toArray(),
      db.spaces.toArray(),
    ]);
    const used = routines.filter((r) => r.items.some((i) => i.exerciseId === id));
    return { exercise, history, used, spaces };
  }, [id]);

  if (!data) return null;
  if (!data.exercise) {
    return (
      <Page title="Exercise" back>
        <div className="empty">This exercise no longer exists.</div>
      </Page>
    );
  }
  const { exercise: e, history = [], used = [], spaces = [] } = data;

  const remove = async () => {
    if (used.length) {
      await confirm({
        title: 'Still in use',
        body: `Remove it from ${used.map((r) => r.name).join(', ')} first.`,
        action: 'OK',
      });
      return;
    }
    const ok = await confirm({
      title: `Delete ${e.name}?`,
      body: history.length ? `Its ${history.length} logged sessions lose their exercise name.` : undefined,
      action: 'Delete exercise',
      danger: true,
    });
    if (ok) {
      await db.exercises.delete(id);
      nav(-1);
    }
  };

  return (
    <Page
      title={e.name}
      back
      actions={
        <button className="icon-btn" aria-label="Edit exercise" onClick={() => setEditing(true)}>
          {Icon.pencil}
        </button>
      }
    >
      <div className="inline" style={{ marginTop: -8 }}>
        <span className="badge">{CATEGORY_LABEL[categoryOf(e)]}</span>
        <span className="badge">{MEASURE_LABEL[e.measure]}</span>
        {e.equipment && <span className="badge">{e.equipment}</span>}
        {needsOf(e).length > 0 && <span className="badge">Needs {kitList(needsOf(e)).toLowerCase()}</span>}
        {used.map((r) => (
          <Link key={r.id} to={`/routine/${r.id}`} className="badge">
            {spaces.find((s) => s.id === r.spaceId)?.name} · {r.name}
          </Link>
        ))}
      </div>

      {(e.cues || e.adjustments || e.links.length > 0 || e.parts?.length) && (
        <div className="card stack">
          {e.parts?.length ? (
            <div>
              <div className="sub" style={{ fontWeight: 600 }}>One round</div>
              <p>{describeParts(e.parts)}</p>
            </div>
          ) : null}
          {e.cues && (
            <div>
              <div className="sub" style={{ fontWeight: 600 }}>How to perform</div>
              <p>{e.cues}</p>
            </div>
          )}
          {e.adjustments && (
            <div>
              <div className="sub" style={{ fontWeight: 600 }}>Adjustments / progression</div>
              <p>{e.adjustments}</p>
            </div>
          )}
          {e.links.map((l) => (
            <a key={l.url} className="link" href={l.url} target="_blank" rel="noopener noreferrer">
              {l.label} ↗
            </a>
          ))}
        </div>
      )}

      <VideoButton exercise={e} />

      <button className="btn" onClick={() => ask(() => buildExerciseContext(db, e))}>
        Ask Claude about this
      </button>

      <ProgressCard key={e.measure} sessions={history} measure={e.measure} />

      <SectionTitle>History</SectionTitle>
      <div className="card flush">
        {history.slice(0, 30).map((h) => (
          <Link key={h.workoutId} to={`/workout/${h.workoutId}`} className="row">
            <div className="grow">
              <div className="title">{summariseSets(h.sets, e.measure)}</div>
              <div className="sub">
                {niceDate(h.date)}
                {e.parts?.length && totalRounds(h.sets) ? ` · ${complexTotals(e.parts, totalRounds(h.sets))}` : ''}
              </div>
            </div>
            {Icon.chevRight}
          </Link>
        ))}
        {!history.length && <div className="empty">Not logged yet.</div>}
      </div>

      <button className="btn ghost danger" onClick={remove}>
        Delete this exercise
      </button>

      {editing && <EditForm exercise={e} onClose={() => setEditing(false)} />}
    </Page>
  );
}
