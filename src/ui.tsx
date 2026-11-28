import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';

/* ── Page shell ───────────────────────────────────────────── */

export function Page({
  title,
  kicker,
  back,
  large,
  actions,
  children,
}: {
  title: string;
  /** Small line above the title, such as today's date. */
  kicker?: string;
  back?: boolean | string;
  large?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const nav = useNavigate();
  return (
    <>
      <header className={`header${large ? ' large' : ''}`}>
        {back && (
          <button
            className="icon-btn"
            aria-label="Back"
            onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))}
          >
            {Icon.back}
          </button>
        )}
        <div className="titles">
          {kicker && <span className="kicker">{kicker}</span>}
          <h1>{title}</h1>
        </div>
        {actions}
      </header>
      <main className="content">{children}</main>
    </>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="section-title">
      <span>{children}</span>
      {action}
    </div>
  );
}

/* ── Form bits ────────────────────────────────────────────── */

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Chips<T extends string | number>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly T[];
  value: T | undefined;
  onChange: (v: T | undefined) => void;
  label?: (v: T) => string;
  className?: string;
}) {
  return (
    <div className={`chips${className ? ` ${className}` : ''}`}>
      {options.map((o) => (
        <button
          key={String(o)}
          type="button"
          className={`chip${value === o ? ' on' : ''}`}
          aria-pressed={value === o}
          onClick={() => onChange(value === o ? undefined : o)}
        >
          {label ? label(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

/** One small square per set, filled as each is logged. */
export function Pips({ done, of }: { done: number; of: number }) {
  return (
    <span className="pips" aria-hidden>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={i < done ? 'on' : undefined} />
      ))}
    </span>
  );
}

/**
 * One thing to do, as a block: a name and one short line. Done shows a tick,
 * part done shows a pip per set, and "now" is outlined.
 */
export function Block({
  title,
  sub,
  done,
  progress,
  now,
  onClick,
  ariaLabel,
  className,
}: {
  title: ReactNode;
  sub?: ReactNode;
  done?: boolean;
  /** Sets logged so far, shown as pips while the block is part done. */
  progress?: { done: number; of: number };
  now?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  className?: string;
}) {
  const cls = ['block', done ? 'done' : '', now ? 'now' : '', className ?? ''].filter(Boolean).join(' ');
  const mark = done ? (
    <span className="block-mark">{Icon.check}</span>
  ) : progress && progress.done > 0 ? (
    <Pips done={progress.done} of={progress.of} />
  ) : null;
  const body = (
    <>
      <span className="block-text">
        <b>{title}</b>
        {sub && <small>{sub}</small>}
      </span>
      {mark}
    </>
  );
  return onClick ? (
    <button type="button" className={cls} aria-label={ariaLabel} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls} aria-label={ariaLabel}>
      {body}
    </div>
  );
}

/** Chips where any number can be on at once. */
export function MultiChips<T extends string>({
  options,
  value,
  onChange,
  label,
  ariaLabel,
}: {
  options: readonly T[];
  value: readonly T[];
  onChange: (v: T[]) => void;
  label: (v: T) => string;
  ariaLabel?: string;
}) {
  return (
    <div className="chips" role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            className={`chip${on ? ' on' : ''}`}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o) : options.filter((x) => x === o || value.includes(x)))}
          >
            {label(o)}
          </button>
        );
      })}
    </div>
  );
}

/* ── Icon picker ──────────────────────────────────────────── */

export interface IconOption<K extends string> {
  key: K;
  label: string;
  icon: ReactNode;
}

/** Shows the chosen icon; tapping it opens a grid of the others to pick from. */
export function IconPicker<K extends string>({
  label,
  options,
  value,
  onChange,
  hint,
}: {
  label: string;
  options: IconOption<K>[];
  value: K;
  onChange: (key: K) => void;
  /** A note beside the current choice, such as "guessed from the name". */
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.key === value) ?? options[0];
  return (
    <div className="field">
      <span>{label}</span>
      <button type="button" className="icon-choice" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="icon-tile on">{current.icon}</span>
        <span className="grow">
          <b>{current.label}</b>
          {hint && <small>{hint}</small>}
        </span>
        {open ? Icon.chevUp : Icon.chevDown}
      </button>
      {open && (
        <div className="icon-grid" role="radiogroup" aria-label={label}>
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={o.key === value}
              aria-label={o.label}
              title={o.label}
              className={`icon-tile${o.key === value ? ' on' : ''}`}
              onClick={() => {
                onChange(o.key);
                setOpen(false);
              }}
            >
              {o.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Bottom sheet ─────────────────────────────────────────── */

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="spread">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            {Icon.close}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── Toast + confirm ──────────────────────────────────────── */

interface Feedback {
  toast: (msg: string) => void;
  confirm: (opts: { title: string; body?: string; action: string; danger?: boolean }) => Promise<boolean>;
}

const FeedbackCtx = createContext<Feedback>({ toast: () => {}, confirm: async () => false });
export const useFeedback = () => useContext(FeedbackCtx);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string>();
  const [ask, setAsk] = useState<{
    title: string;
    body?: string;
    action: string;
    danger?: boolean;
    resolve: (v: boolean) => void;
  }>();
  const timer = useRef<number>();

  const toast = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(undefined), 3200);
  }, []);

  const confirm = useCallback<Feedback['confirm']>(
    (opts) => new Promise<boolean>((resolve) => setAsk({ ...opts, resolve })),
    [],
  );

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);
  const answer = (v: boolean) => {
    ask?.resolve(v);
    setAsk(undefined);
  };

  return (
    <FeedbackCtx.Provider value={value}>
      {children}
      {msg && (
        <div className="toast" role="status">
          {msg}
        </div>
      )}
      {ask && (
        <Sheet title={ask.title} onClose={() => answer(false)}>
          {ask.body && <p className="muted">{ask.body}</p>}
          <div className="grid-2">
            <button className="btn" onClick={() => answer(false)}>
              Cancel
            </button>
            <button className={`btn ${ask.danger ? 'danger' : 'primary'}`} onClick={() => answer(true)}>
              {ask.action}
            </button>
          </div>
        </Sheet>
      )}
    </FeedbackCtx.Provider>
  );
}

/* ── Number input that keeps its own text while typing ────── */

export function NumInput({
  value,
  unit,
  placeholder,
  onCommit,
  parse = parseNumber,
  format = (n) => String(n),
  ariaLabel,
  className = 'num',
}: {
  value: number | undefined;
  /** Shown inside the field; leave out when a label elsewhere names the unit. */
  unit?: string;
  placeholder?: string;
  onCommit: (v: number | undefined) => void;
  parse?: (s: string) => number | undefined;
  format?: (n: number) => string;
  ariaLabel: string;
  className?: string;
}) {
  const [text, setText] = useState(value != null ? format(value) : '');
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value != null ? format(value) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={className}>
      <input
        aria-label={ariaLabel}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focused.current = false;
          const v = parse(text);
          setText(v != null ? format(v) : '');
          if (v !== value) onCommit(v);
        }}
      />
      {unit && <span>{unit}</span>}
    </div>
  );
}

export function parseNumber(s: string): number | undefined {
  const t = s.trim().replace(',', '.');
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** "90" → 90 seconds, "1:30" → 90 seconds. */
export function parseDuration(s: string): number | undefined {
  const t = s.trim();
  if (!t) return undefined;
  if (t.includes(':')) {
    const [m, sec] = t.split(':');
    const mm = Number(m || 0);
    const ss = Number(sec || 0);
    return Number.isFinite(mm) && Number.isFinite(ss) && mm >= 0 && ss >= 0 ? mm * 60 + ss : undefined;
  }
  return parseNumber(t);
}

/* ── Icons ────────────────────────────────────────────────── */

const stroke = {
  className: 'ico',
  'aria-hidden': true,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const bold = { ...stroke, strokeWidth: 2.2 };

export const Icon = {
  plan: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  ),
  back: (
    <svg viewBox="0 0 24 24" {...bold}>
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" {...bold}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={2.6}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  ),
  dash: (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={2.6}>
      <path d="M7 12h10" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" {...bold}>
      <path d="M12 6v12M6 12h12" />
    </svg>
  ),
  minus: (
    <svg viewBox="0 0 24 24" {...bold}>
      <path d="M6 12h12" />
    </svg>
  ),
  arrow: (
    <svg viewBox="0 0 24 24" {...bold}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
  chevDown: (
    <svg viewBox="0 0 24 24" {...bold}>
      <path d="M6 9.5l6 6 6-6" />
    </svg>
  ),
  chevRight: (
    <svg viewBox="0 0 24 24" {...bold}>
      <path d="M9.5 5.5 16 12l-6.5 6.5" />
    </svg>
  ),
  chevUp: (
    <svg viewBox="0 0 24 24" {...bold}>
      <path d="M6 14.5l6-6 6 6" />
    </svg>
  ),
  swap: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 10.5v6M14 10.5v6" />
    </svg>
  ),
  play: (
    <svg viewBox="0 0 24 24" className="ico" aria-hidden fill="currentColor">
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  ),
  pause: (
    <svg viewBox="0 0 24 24" className="ico" aria-hidden fill="currentColor">
      <path d="M7 5.5h3.5v13H7zM13.5 5.5H17v13h-3.5z" />
    </svg>
  ),
  skipNext: (
    <svg viewBox="0 0 24 24" className="ico" aria-hidden fill="currentColor">
      <path d="M6 6v12l9-6zM16.5 6H19v12h-2.5z" />
    </svg>
  ),
  skipPrev: (
    <svg viewBox="0 0 24 24" className="ico" aria-hidden fill="currentColor">
      <path d="M18 6v12l-9-6zM5 6h2.5v12H5z" />
    </svg>
  ),
  video: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="5.5" width="18" height="13" rx="3" />
      <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" stroke="none" />
    </svg>
  ),
  pass: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 20h.01M20 14h.01" />
    </svg>
  ),
  scan: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M4 12h16" />
    </svg>
  ),
  route: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6" />
    </svg>
  ),
  copy: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="8" y="8" width="12" height="12" rx="2.5" />
      <path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" />
    </svg>
  ),
  more: (
    <svg viewBox="0 0 24 24" className="ico" aria-hidden fill="currentColor">
      <circle cx="5.5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="18.5" cy="12" r="1.7" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  ),
  bolt: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 7.8v.2" />
    </svg>
  ),
  pencil: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M4 20l1-4L16.5 4.5l3 3L8 19z" />
    </svg>
  ),
  today: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M4 11.5 12 4l8 7.5V20H4z" />
      <path d="M10 20v-5h4v5" />
    </svg>
  ),
  exercises: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M3 12h18M6 8v8M18 8v8M3.5 10v4M20.5 10v4" />
    </svg>
  ),
  timer: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.5v4l2.5 2M9.5 3h5" />
    </svg>
  ),
  library: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M5 4h4v16H5zM10.5 4h4v16h-4zM16 6l3.5-1 3 13.5-3.5 1z" transform="translate(-1.5 0)" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  ),
};
