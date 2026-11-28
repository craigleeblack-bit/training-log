import { useState } from 'react';

export interface Point {
  /** Short text under the axis, shown for the first and last points only. */
  label: string;
  /** Full text for the read-out when the point is touched: "Week of 16 Nov". */
  title: string;
  value: number;
}

const W = 320;
const H = 140;
const PAD = { l: 8, r: 8, t: 14, b: 22 };

const tidy = (n: number): string => (Math.abs(n) >= 100 ? Math.round(n).toLocaleString('en-GB') : String(Math.round(n * 10) / 10));

/** The line under a chart that names the point being touched, or the latest when none is. */
function ReadOut({ point, unit, format, onOpen }: { point: Point | undefined; unit?: string; format: (n: number) => string; onOpen?: () => void }) {
  if (!point) return null;
  return (
    <div className="chart-read" aria-live="polite">
      <span>{point.title}</span>
      <b>
        {format(point.value)}
        {unit ? ` ${unit}` : ''}
      </b>
      {onOpen && (
        <button type="button" className="chart-open" onClick={onOpen}>
          Open
        </button>
      )}
    </div>
  );
}

interface ChartProps {
  points: Point[];
  /** What is being measured: names the chart for screen readers. */
  name: string;
  unit?: string;
  format?: (n: number) => string;
  /** Open what a point stands for, such as its session. Offered beside the read-out. */
  onOpen?: (index: number) => void;
}

/** One series as bars from a zero baseline: good for totals per week. Touch a bar to read it. */
export function BarChart({ points, name, unit, format = tidy }: ChartProps) {
  const [at, setAt] = useState<number>();
  if (!points.length) return null;
  const max = Math.max(...points.map((p) => p.value), 1);
  const slot = (W - PAD.l - PAD.r) / points.length;
  const bar = Math.max(2, Math.min(28, slot - 2));
  const base = H - PAD.b;
  const y = (v: number) => PAD.t + (1 - v / max) * (base - PAD.t);
  const shown = points[at ?? points.length - 1];
  return (
    <div className="chart-wrap">
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${name}, ${points.length} weeks. Latest: ${format(points[points.length - 1].value)}${unit ? ` ${unit}` : ''}`} onPointerLeave={() => setAt(undefined)}>
        <line className="axis" x1={PAD.l} x2={W - PAD.r} y1={base} y2={base} />
        {points.map((p, i) => {
          const x = PAD.l + i * slot + (slot - bar) / 2;
          const top = y(p.value);
          const h = base - top;
          const r = Math.min(4, bar / 2, h);
          return (
            <g key={i}>
              {p.value > 0 && (
                // Rounded at the data end only, square on the baseline.
                <path
                  className={`bar${i === (at ?? points.length - 1) ? ' on' : ''}`}
                  d={`M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + bar - r}Q${x + bar},${top} ${x + bar},${top + r}V${base}Z`}
                />
              )}
              {/* The touch target is the whole column, far easier to hit than the bar. */}
              <rect className="hit" x={PAD.l + i * slot} y={0} width={slot} height={H} onPointerEnter={() => setAt(i)} onPointerDown={() => setAt(i)} />
            </g>
          );
        })}
        <text x={PAD.l} y={H - 6}>{points[0].label}</text>
        {points.length > 1 && (
          <text x={W - PAD.r} y={H - 6} textAnchor="end">
            {points[points.length - 1].label}
          </text>
        )}
      </svg>
      <ReadOut point={shown} unit={unit} format={format} />
    </div>
  );
}

/** One series as a line: good for a measure that moves from session to session. Touch a point to read it. */
export function LineChart({ points, name, unit, format = tidy, onOpen }: ChartProps) {
  const [at, setAt] = useState<number>();
  if (points.length < 2) return null;
  const lo = Math.min(...points.map((p) => p.value));
  const hi = Math.max(...points.map((p) => p.value));
  const span = hi - lo || 1;
  const left = PAD.l + 30; // room for the two scale numbers
  const base = H - PAD.b;
  const x = (i: number) => left + (i / (points.length - 1)) * (W - left - PAD.r - 4);
  const y = (v: number) => PAD.t + (1 - (v - lo) / span) * (base - PAD.t - 6);
  const cur = at ?? points.length - 1;
  const slot = (W - left - PAD.r) / points.length;
  return (
    <div className="chart-wrap">
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${name} over ${points.length} sessions, from ${format(points[0].value)} to ${format(points[points.length - 1].value)}${unit ? ` ${unit}` : ''}`} onPointerLeave={() => setAt(undefined)}>
        <line className="axis" x1={left} x2={W - PAD.r} y1={base} y2={base} />
        <text x={left - 6} y={y(hi) + 4} textAnchor="end">{format(hi)}</text>
        {hi !== lo && <text x={left - 6} y={y(lo) + 4} textAnchor="end">{format(lo)}</text>}
        <text x={left} y={H - 6}>{points[0].label}</text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end">{points[points.length - 1].label}</text>
        <line className="cross" x1={x(cur)} x2={x(cur)} y1={PAD.t - 6} y2={base} />
        <polyline className="line" points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} />
        {points.map((p, i) => (
          <g key={i}>
            <circle className={`pt${i === cur ? ' on' : ''}`} cx={x(i)} cy={y(p.value)} r={i === cur ? 5 : 3.5} />
            <rect className="hit" x={x(i) - slot / 2} y={0} width={slot} height={H} onPointerEnter={() => setAt(i)} onPointerDown={() => setAt(i)} />
          </g>
        ))}
      </svg>
      <ReadOut point={points[cur]} unit={unit} format={format} onOpen={onOpen && (() => onOpen(cur))} />
    </div>
  );
}
