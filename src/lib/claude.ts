import type { AppDB, Exercise, Workout } from '../db/schema';
import { exerciseHistory, summariseSets } from '../db/queries';
import { niceDate } from './dates';

export const CLAUDE_URL_KEY = 'claudeProjectUrl';
export const CLAUDE_FALLBACK_URL = 'https://claude.ai/new';

/** Only claude.ai links are accepted, so a mistyped setting can never send context elsewhere. */
export function normaliseClaudeUrl(raw: string): string | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (u.protocol !== 'https:' || !/(^|\.)claude\.ai$/i.test(u.hostname)) return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

export function exerciseContext(ex: Exercise, sessions: { date: string; summary: string }[]): string {
  const lines = [`Exercise: ${ex.name}${ex.equipment ? ` (${ex.equipment})` : ''}`];
  if (ex.cues) lines.push(`My cues: ${ex.cues}`);
  if (ex.adjustments) lines.push(`Adjustments: ${ex.adjustments}`);
  if (sessions.length) {
    lines.push('', 'Recent sessions:');
    for (const s of sessions) lines.push(`- ${niceDate(s.date)}: ${s.summary}`);
  } else {
    lines.push('', 'No logged sessions yet.');
  }
  lines.push('', 'My question: ');
  return lines.join('\n');
}

export async function buildExerciseContext(db: AppDB, ex: Exercise, limit = 8): Promise<string> {
  const history = await exerciseHistory(db, ex);
  return exerciseContext(
    ex,
    history.slice(0, limit).map((h) => ({ date: h.date, summary: summariseSets(h.sets, ex.measure) })),
  );
}

export async function workoutLines(db: AppDB, w: Workout): Promise<string[]> {
  const lines: string[] = [];
  const meta = [
    w.status === 'skipped' ? 'skipped' : '',
    w.minutes != null ? `${w.minutes} min` : '',
    w.rpe != null ? `RPE ${w.rpe}` : '',
    w.backResponse ? `back: ${w.backResponse}` : '',
  ].filter(Boolean);
  lines.push(`### ${niceDate(w.date)} — ${w.title}${meta.length ? ` (${meta.join(', ')})` : ''}`);
  if (w.prescription) lines.push(`Plan: ${w.prescription}`);
  const sets = await db.sets.where('workoutId').equals(w.id).toArray();
  const byExercise = new Map<string, typeof sets>();
  for (const s of sets) byExercise.set(s.exerciseId, [...(byExercise.get(s.exerciseId) ?? []), s]);
  for (const [exerciseId, rows] of byExercise) {
    const ex = await db.exercises.get(exerciseId);
    if (!ex) continue;
    const summary = summariseSets(
      rows.sort((a, b) => a.setNo - b.setNo),
      ex.measure,
    );
    if (summary) lines.push(`- ${ex.name}: ${summary}`);
  }
  if (w.notes) lines.push(`Notes: ${w.notes}`);
  return lines;
}

export async function buildWorkoutContext(db: AppDB, w: Workout): Promise<string> {
  return [...(await workoutLines(db, w)), '', 'My question: '].join('\n');
}

/** Markdown training log for dropping into a Claude Project. Newest first. */
export async function buildLogMarkdown(db: AppDB, sinceIso?: string): Promise<string> {
  const spaces = new Map((await db.spaces.toArray()).map((s) => [s.id, s.name]));
  const workouts = (await db.workouts.toArray())
    .filter((w) => w.status !== 'in_progress' && (!sinceIso || w.date >= sinceIso))
    .sort((a, b) => b.date.localeCompare(a.date) || b.startedAt - a.startedAt);
  const out = ['# Training log', '', `Exported ${niceDate(new Date().toISOString().slice(0, 10))}. Weights in kg.`, ''];
  if (!workouts.length) out.push('No sessions logged yet.');
  for (const w of workouts) {
    const lines = await workoutLines(db, w);
    lines[0] = `${lines[0]} · ${spaces.get(w.spaceId) ?? 'Unknown space'}`;
    out.push(...lines, '');
  }
  return out.join('\n');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API can be blocked (insecure origin, no user gesture): fall back to a hidden textarea.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
