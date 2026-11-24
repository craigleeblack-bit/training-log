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
