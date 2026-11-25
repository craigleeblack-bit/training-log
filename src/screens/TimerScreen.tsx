import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, type TimerPreset } from '../db/schema';
import {
  buildPhases,
  clock,
  describeSpec,
  MODE_LABEL,
  specSeconds,
  totalSeconds,
  type Phase,
  type TimerMode,
  type TimerSpec,
} from '../lib/timer';
import { useTimer, useTimerPrefs } from '../timerContext';
import { Chips, Field, Icon, NumInput, Page, SectionTitle, Sheet, parseDuration, useFeedback } from '../ui';

const MODES: readonly TimerMode[] = ['intervals', 'emom', 'amrap', 'countdown', 'stopwatch'];

/** Where each mode starts when you pick it in the builder. */
const STARTING: Record<TimerMode, TimerSpec> = {
  intervals: { mode: 'intervals', work: 40, rest: 20, rounds: 8 },
  emom: { mode: 'emom', every: 60, rounds: 10 },
  amrap: { mode: 'amrap', seconds: 600 },
  countdown: { mode: 'countdown', seconds: 90 },
  stopwatch: { mode: 'stopwatch' },
};

const KIND_WORD: Record<Phase['kind'], string> = {
  prep: 'Get ready',
  work: 'Work',
  rest: 'Rest',
  warmup: 'Warm-up',
  cooldown: 'Cool-down',
};

/** "Round 3 of 8", with the set when rounds repeat in sets. */
const whereIn = (p: Phase): string =>
  [p.round && p.rounds ? `Round ${p.round} of ${p.rounds}` : '', p.set && p.sets ? `Set ${p.set} of ${p.sets}` : '']
    .filter(Boolean)
    .join(' · ');

/** Rounds and laps are timed from the end of the get-ready countdown, not from the press of Start. */
const startOfCount = (phases: Phase[]): number => (phases[0]?.kind === 'prep' ? phases[0].seconds : 0);

/* ── A labelled number with − and + either side ───────────── */

function Adjust({
  label,
  value,
  step,
  min = 0,
  time,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min?: number;
  /** Shown and typed as m:ss. */
  time?: boolean;
  onChange: (v: number) => void;
}) {
  const set = (v: number) => onChange(Math.max(min, Math.round(v)));
  return (
    <div className="adjust">
      <span>{label}</span>
      <div className="adjust-ctl">
        <button type="button" aria-label={`Less: ${label}`} disabled={value <= min} onClick={() => set(value - step)}>
          {Icon.minus}
        </button>
        <NumInput
          className="adjust-num"
          ariaLabel={label}
          value={value}
          parse={time ? parseDuration : undefined}
          format={time ? clock : undefined}
          onCommit={(v) => set(v ?? min)}
        />
        <button type="button" aria-label={`More: ${label}`} onClick={() => set(value + step)}>
          {Icon.plus}
        </button>
      </div>
    </div>
  );
}

function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/* ── The fields for one mode ──────────────────────────────── */

function SpecFields({ spec, onChange }: { spec: TimerSpec; onChange: (s: TimerSpec) => void }) {
  switch (spec.mode) {
    case 'stopwatch':
      return <p className="sub">Counts up from zero. Tap Lap to mark a split.</p>;
    case 'countdown':
      return <Adjust label="Time" time step={15} min={5} value={spec.seconds} onChange={(seconds) => onChange({ ...spec, seconds })} />;
    case 'amrap':
      return (
        <>
          <Adjust label="Time" time step={60} min={30} value={spec.seconds} onChange={(seconds) => onChange({ ...spec, seconds })} />
          <p className="sub">As many rounds as possible. Tap once for each round you finish.</p>
        </>
      );
    case 'emom':
      return (
        <>
          <Adjust label="Every" time step={15} min={10} value={spec.every} onChange={(every) => onChange({ ...spec, every })} />
          <Adjust label="Rounds" step={1} min={1} value={spec.rounds} onChange={(rounds) => onChange({ ...spec, rounds })} />
        </>
      );
    case 'intervals': {
      const sets = spec.sets ?? 1;
      return (
        <>
          <Adjust label="Work" time step={5} min={5} value={spec.work} onChange={(work) => onChange({ ...spec, work })} />
          <Adjust label="Rest" time step={5} value={spec.rest} onChange={(rest) => onChange({ ...spec, rest })} />
          <Adjust label="Rounds" step={1} min={1} value={spec.rounds} onChange={(rounds) => onChange({ ...spec, rounds })} />
          <Adjust label="Sets of rounds" step={1} min={1} value={sets} onChange={(n) => onChange({ ...spec, sets: n > 1 ? n : undefined })} />
          {sets > 1 && (
            <Adjust
              label="Rest between sets"
              time
              step={15}
              value={spec.setRest ?? spec.rest}
              onChange={(setRest) => onChange({ ...spec, setRest })}
            />
          )}
          <Adjust label="Warm-up" time step={30} value={spec.warmup ?? 0} onChange={(v) => onChange({ ...spec, warmup: v || undefined })} />
          <Adjust label="Cool-down" time step={30} value={spec.cooldown ?? 0} onChange={(v) => onChange({ ...spec, cooldown: v || undefined })} />
          <Toggle
            label="Finish on a rest"
            hint="Keep the rest after the last round"
            on={!!spec.endWithRest}
            onChange={(v) => onChange({ ...spec, endWithRest: v || undefined })}
          />
        </>
      );
    }
  }
}

/* ── Build, start, save ───────────────────────────────────── */

function Builder({
  preset,
  count,
  onStart,
  onClose,
}: {
  /** The saved timer being edited, or undefined for a new one. */
  preset?: TimerPreset;
  count: number;
  onStart: (spec: TimerSpec, name: string) => void;
  onClose: () => void;
}) {
  const { confirm, toast } = useFeedback();
  const [spec, setSpec] = useState<TimerSpec>(preset?.spec ?? STARTING.intervals);
  const [name, setName] = useState(preset?.name ?? '');
  const total = specSeconds(spec);
  const usable = spec.mode === 'stopwatch' || buildPhases(spec).length > 0;
  const label = name.trim() || MODE_LABEL[spec.mode];

  const save = async () => {
    await db.timers.put({ id: preset?.id ?? uid(), name: label, spec, order: preset?.order ?? count });
    toast(preset ? 'Timer updated.' : 'Timer saved.');
    onClose();
  };

  const remove = async () => {
    if (!preset) return;
    const ok = await confirm({ title: `Delete ${preset.name}?`, action: 'Delete timer', danger: true });
    if (ok) {
      await db.timers.delete(preset.id);
      onClose();
    }
  };

  const duplicate = async () => {
    await db.timers.add({ id: uid(), name: `${label} copy`, spec, order: count });
    toast('Copy saved.');
    onClose();
  };

  return (
    <Sheet title={preset ? 'Edit timer' : 'New timer'} onClose={onClose}>
      <Chips options={MODES} value={spec.mode} onChange={(m) => m && m !== spec.mode && setSpec(STARTING[m])} label={(m) => MODE_LABEL[m]} />
      <div className="adjust-list">
        <SpecFields spec={spec} onChange={setSpec} />
      </div>
      <Field label="Name">
        <input value={name} placeholder={MODE_LABEL[spec.mode]} onChange={(e) => setName(e.target.value)} />
      </Field>
      <p className="sub">{describeSpec(spec)}</p>
      <div className="grid-2">
        <button className="btn" disabled={!usable} onClick={save}>
          {preset ? 'Save changes' : 'Save'}
        </button>
        <button className="btn primary" disabled={!usable} onClick={() => onStart(spec, label)}>
          Start{total != null ? ` · ${clock(total)}` : ''}
        </button>
      </div>
      {preset && (
        <div className="grid-2">
          <button className="btn ghost" onClick={duplicate}>
            Duplicate
          </button>
          <button className="btn ghost danger" onClick={remove}>
            Delete
          </button>
        </div>
      )}
    </Sheet>
  );
}

function Options({ onClose }: { onClose: () => void }) {
  const [prefs, setPrefs] = useTimerPrefs();
  return (
    <Sheet title="Timer options" onClose={onClose}>
      <div className="field">
        <span>Get-ready countdown</span>
        <Chips
          options={[0, 3, 5, 10] as const}
          value={prefs.prep as 0 | 3 | 5 | 10}
          onChange={(v) => v != null && setPrefs({ prep: v })}
          label={(v) => (v ? `${v} s` : 'Off')}
        />
      </div>
      <div className="adjust-list">
        <Toggle label="Sound" hint="Beeps at each change and the last three seconds" on={prefs.sound} onChange={(sound) => setPrefs({ sound })} />
        <Toggle label="Vibration" on={prefs.vibrate} onChange={(vibrate) => setPrefs({ vibrate })} />
        <Toggle label="Spoken cues" hint="Says the round, rest and finish aloud" on={prefs.voice} onChange={(voice) => setPrefs({ voice })} />
        <Toggle label="Halfway beep" hint="In work phases of 20 seconds or more" on={prefs.halfway} onChange={(halfway) => setPrefs({ halfway })} />
      </div>
      <p className="sub">The screen stays on while a timer runs.</p>
    </Sheet>
  );
}

/* ── A timer under way ────────────────────────────────────── */

function Running() {
  const t = useTimer();
  const pos = t.position;
  if (!pos) return null;
  const phase = pos.phase;
  const next = t.phases[pos.index + 1];
  const kind = pos.done ? 'rest' : (phase?.kind ?? 'work');
  const total = totalSeconds(t.phases);
  const mode = t.spec?.mode;
  const counting = mode === 'amrap' || mode === 'stopwatch';
  const open = !!phase?.open;
  const shown = pos.done ? 0 : open && phase ? phase.seconds - pos.remaining : Math.ceil(pos.remaining);
  const where = phase ? whereIn(phase) : '';
  const rounds = t.spec && 'rounds' in t.spec ? t.spec.rounds : undefined;
  const lapWord = mode === 'stopwatch' ? 'Lap' : 'Round';

  return (
    <>
      <div className={`card timer-face ${kind}`}>
        <span className="phase">{pos.done ? 'Finished' : phase ? KIND_WORD[phase.kind] : ''}</span>
        <span className="clock" role="timer" aria-live="off">
          {clock(shown)}
        </span>
        {where && !pos.done && <span className="where">{where}</span>}
        <span className="sub">
          {pos.done
            ? counting && t.laps.length
              ? `${t.name} · ${t.laps.length} ${lapWord.toLowerCase()}${t.laps.length === 1 ? '' : 's'}`
              : t.name
            : next
              ? `Next: ${KIND_WORD[next.kind]} · ${clock(next.seconds)}`
              : t.phases.length > 1
                ? 'Last one'
                : t.name}
        </span>
      </div>

      {t.phases.length > 1 && !pos.done && !open && (
        <>
          <div className="progress">
            <i style={{ width: `${total ? ((total - pos.totalRemaining) / total) * 100 : 0}%` }} />
          </div>
          <span className="sub" style={{ textAlign: 'center' }}>
            {clock(Math.ceil(pos.totalRemaining))} left in total
          </span>
        </>
      )}

      {counting && !pos.done && phase?.kind !== 'prep' && (
        <button className="btn primary big block spread" onClick={t.lap}>
          <span>{mode === 'stopwatch' ? 'Lap' : 'Round done'}</span>
          <span className="then">{t.laps.length}</span>
        </button>
      )}

      {pos.done ? (
        <div className="grid-2">
          <button className="btn" onClick={t.stop}>
            Close
          </button>
          <button className="btn primary" onClick={() => t.start(t.phases, t.name, t.spec)}>
            Again
          </button>
        </div>
      ) : (
        <div className="transport">
          <button className="icon-btn boxed" aria-label="Back to the start of this phase" onClick={() => t.skip(-1)}>
            {Icon.skipPrev}
          </button>
          <button className={`btn big${counting ? '' : ' primary'}`} onClick={t.running ? t.pause : t.resume}>
            {t.running ? Icon.pause : Icon.play}
            {t.running ? 'Pause' : 'Resume'}
          </button>
          <button className="icon-btn boxed" aria-label="Skip to the next phase" disabled={open} onClick={() => t.skip(1)}>
            {Icon.skipNext}
          </button>
        </div>
      )}

      {!pos.done && (!open || rounds != null) && (
        <div className="adjust-list">
          {!open && (
            <div className="adjust">
              <span>This phase</span>
              <div className="adjust-ctl wide">
                <button type="button" aria-label="Take 15 seconds off" onClick={() => t.extend(-15)}>
                  − 15 s
                </button>
                <button type="button" aria-label="Add 15 seconds" onClick={() => t.extend(15)}>
                  + 15 s
                </button>
              </div>
            </div>
          )}
          {rounds != null && (
            <div className="adjust">
              <span>Rounds</span>
              <div className="adjust-ctl">
                <button type="button" aria-label="One round fewer" disabled={!t.canAddRound(-1)} onClick={() => t.addRound(-1)}>
                  {Icon.minus}
                </button>
                <b className="adjust-num">{rounds}</b>
                <button type="button" aria-label="One more round" disabled={!t.canAddRound(1)} onClick={() => t.addRound(1)}>
                  {Icon.plus}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {counting && t.laps.length > 0 && (
        <div className="card flush">
          {t.laps
            .map((at, i) => ({ n: i + 1, split: at - (t.laps[i - 1] ?? startOfCount(t.phases)) }))
            .reverse()
            .slice(0, 30)
            .map((l) => (
              <div key={l.n} className="row">
                <div className="grow">
                  <div className="title">
                    {lapWord} {l.n}
                  </div>
                </div>
                <span className="sub">{clock(l.split)}</span>
              </div>
            ))}
          {!pos.done && (
            <button className="row" onClick={t.undoLap}>
              <div className="grow sub">Undo the last one</div>
            </button>
          )}
        </div>
      )}

      {!pos.done && (
        <button className="btn ghost danger" onClick={t.stop}>
          Stop timer
        </button>
      )}
    </>
  );
}

/* ── The Timer tab ────────────────────────────────────────── */

export default function TimerScreen() {
  const t = useTimer();
  const [prefs] = useTimerPrefs();
  const presets = useLiveQuery(() => db.timers.orderBy('order').toArray(), []);
  const [building, setBuilding] = useState<TimerPreset | 'new'>();
  const [options, setOptions] = useState(false);
  const [sorting, setSorting] = useState(false);

  const run = (spec: TimerSpec, name: string) => t.start(buildPhases(spec, prefs.prep), name, spec);

  const move = async (index: number, by: 1 | -1) => {
    if (!presets) return;
    const list = [...presets];
    const to = index + by;
    if (to < 0 || to >= list.length) return;
    [list[index], list[to]] = [list[to], list[index]];
    await db.timers.bulkPut(list.map((p, order) => ({ ...p, order })));
  };

  return (
    <Page
      title="Timer"
      large
      actions={
        <button className="icon-btn boxed" aria-label="Timer options" onClick={() => setOptions(true)}>
          {Icon.settings}
        </button>
      }
    >
      {t.active ? (
        <Running />
      ) : (
        <>
          <div className="grid-2">
            <button className="btn primary big" onClick={() => setBuilding('new')}>
              {Icon.plus}
              New timer
            </button>
            <button className="btn big" onClick={() => run({ mode: 'stopwatch' }, 'Stopwatch')}>
              {Icon.timer}
              Stopwatch
            </button>
          </div>

          <SectionTitle
            action={
              presets && presets.length > 1 ? (
                <button onClick={() => setSorting((v) => !v)}>{sorting ? 'Done' : 'Reorder'}</button>
              ) : undefined
            }
          >
            Saved timers
          </SectionTitle>
          <div className="card flush">
            {presets?.map((p, i) => {
              const total = specSeconds(p.spec);
              const text = (
                <div className="grow">
                  <div className="title">{p.name}</div>
                  <div className="sub">{describeSpec(p.spec)}</div>
                </div>
              );
              return sorting ? (
                <div key={p.id} className="row tools">
                  {text}
                  <button className="icon-btn sm" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    {Icon.chevUp}
                  </button>
                  <button
                    className="icon-btn sm"
                    aria-label={`Move ${p.name} down`}
                    disabled={i === presets.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    {Icon.chevDown}
                  </button>
                </div>
              ) : (
                <div key={p.id} className="row tools">
                  <button className="row-main" aria-label={`Start ${p.name}`} onClick={() => run(p.spec, p.name)}>
                    {text}
                    {total != null && <span className="sub">{clock(total)}</span>}
                  </button>
                  <button className="icon-btn sm" aria-label={`Edit ${p.name}`} onClick={() => setBuilding(p)}>
                    {Icon.pencil}
                  </button>
                </div>
              );
            })}
            {presets && !presets.length && <div className="empty">No saved timers. Build one with New timer and tap Save.</div>}
          </div>
          <p className="sub">Tap a timer to start it. The pencil changes it.</p>
        </>
      )}

      {building && (
        <Builder
          preset={building === 'new' ? undefined : building}
          count={presets?.length ?? 0}
          onClose={() => setBuilding(undefined)}
          onStart={(spec, name) => {
            setBuilding(undefined);
            run(spec, name);
          }}
        />
      )}
      {options && <Options onClose={() => setOptions(false)} />}
    </Page>
  );
}
