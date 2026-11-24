import { useState } from 'react';
import { formatSeconds } from '../db/queries';
import { countdownPhases, emomPhases, intervalPhases, PRESETS, totalSeconds, type Phase } from '../lib/timer';
import { useTimer } from '../timerContext';
import { Chips, Field, Page, SectionTitle, parseDuration, parseNumber } from '../ui';

type Mode = 'Countdown' | 'EMOM' | 'Intervals';
const MODES: readonly Mode[] = ['Countdown', 'EMOM', 'Intervals'];

function Running() {
  const t = useTimer();
  const pos = t.position;
  if (!pos) return null;
  const next = t.phases[pos.index + 1];
  const kind = pos.done ? 'rest' : (pos.phase?.kind ?? 'work');
  const total = totalSeconds(t.phases);
  return (
    <>
      <div className={`card timer-face ${kind}`}>
        <span className="phase">{pos.done ? 'Finished' : pos.phase?.label}</span>
        <span className="clock" role="timer" aria-live="off">
          {formatSeconds(Math.ceil(pos.remaining))}
        </span>
        <span className="sub">
          {pos.done
            ? t.name
            : next
              ? `Next: ${next.label} · ${formatSeconds(next.seconds)}`
              : t.phases.length > 1
                ? 'Last one'
                : t.name}
        </span>
      </div>
      {t.phases.length > 1 && !pos.done && (
        <>
          <div className="progress">
            <i style={{ width: `${total ? ((total - pos.totalRemaining) / total) * 100 : 0}%` }} />
          </div>
          <span className="sub" style={{ textAlign: 'center' }}>
            {formatSeconds(Math.ceil(pos.totalRemaining))} left in total
          </span>
        </>
      )}
      <div className="grid-2">
        <button className="btn" onClick={t.stop}>
          {pos.done ? 'Close' : 'Stop'}
        </button>
        {pos.done ? (
          <button className="btn primary" onClick={() => t.start(t.phases, t.name)}>
            Again
          </button>
        ) : (
          <button className="btn primary" onClick={t.running ? t.pause : t.resume}>
            {t.running ? 'Pause' : 'Resume'}
          </button>
        )}
      </div>
    </>
  );
}

export default function TimerScreen() {
  const t = useTimer();
  const [mode, setMode] = useState<Mode>('Countdown');
  const [seconds, setSeconds] = useState('1:30');
  const [rounds, setRounds] = useState('10');
  const [work, setWork] = useState('0:40');
  const [rest, setRest] = useState('0:20');
  const [warmup, setWarmup] = useState('');
  const [cooldown, setCooldown] = useState('');

  const custom = (): Phase[] => {
    const n = Math.round(parseNumber(rounds) ?? 0);
    if (mode === 'Countdown') return countdownPhases(parseDuration(seconds) ?? 0, 'Countdown');
    if (mode === 'EMOM') return n > 0 ? emomPhases(n) : [];
    const w = parseDuration(work) ?? 0;
    if (n <= 0 || w <= 0) return [];
    return intervalPhases({
      warmup: parseDuration(warmup),
      work: w,
      rest: parseDuration(rest) ?? 0,
      rounds: n,
      cooldown: parseDuration(cooldown),
    });
  };
  const phases = custom();

  return (
    <Page title="Timer" large>
      {t.active ? (
        <Running />
      ) : (
        <>
          <SectionTitle>Presets</SectionTitle>
          <div className="card flush">
            {PRESETS.map((p) => (
              <button key={p.id} className="row" onClick={() => t.start(p.phases, p.name)}>
                <div className="grow">
                  <div className="title">{p.name}</div>
                  <div className="sub">{p.detail}</div>
                </div>
                <span className="sub">{formatSeconds(totalSeconds(p.phases))}</span>
              </button>
            ))}
          </div>

          <SectionTitle>Custom</SectionTitle>
          <div className="card stack">
            <Chips options={MODES} value={mode} onChange={(v) => v && setMode(v)} />
            {mode === 'Countdown' && (
              <Field label="Time (m:ss or seconds)">
                <input inputMode="text" value={seconds} onChange={(e) => setSeconds(e.target.value)} />
              </Field>
            )}
            {mode === 'EMOM' && (
              <Field label="Minutes">
                <input inputMode="numeric" value={rounds} onChange={(e) => setRounds(e.target.value)} />
              </Field>
            )}
            {mode === 'Intervals' && (
              <>
                <div className="grid-3">
                  <Field label="Rounds">
                    <input inputMode="numeric" value={rounds} onChange={(e) => setRounds(e.target.value)} />
                  </Field>
                  <Field label="Work">
                    <input value={work} onChange={(e) => setWork(e.target.value)} />
                  </Field>
                  <Field label="Rest">
                    <input value={rest} onChange={(e) => setRest(e.target.value)} />
                  </Field>
                </div>
                <div className="grid-2">
                  <Field label="Warm-up (optional)">
                    <input value={warmup} placeholder="10:00" onChange={(e) => setWarmup(e.target.value)} />
                  </Field>
                  <Field label="Cool-down (optional)">
                    <input value={cooldown} placeholder="5:00" onChange={(e) => setCooldown(e.target.value)} />
                  </Field>
                </div>
              </>
            )}
            <button className="btn primary block" disabled={!phases.length} onClick={() => t.start(phases, mode)}>
              Start{phases.length ? ` · ${formatSeconds(totalSeconds(phases))}` : ''}
            </button>
          </div>
          <p className="sub">The screen stays on while a timer runs. Beeps mark each change and the last three seconds.</p>
        </>
      )}
    </Page>
  );
}
