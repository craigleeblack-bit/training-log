import type { Activity, TrackPoint } from '../db/schema';

export const ACTIVITY_LABEL: Record<Activity, string> = { run: 'Run', walk: 'Walk', ride: 'Ride', other: 'Other' };

export type DistanceUnit = 'km' | 'mi';
export const UNIT_METRES: Record<DistanceUnit, number> = { km: 1000, mi: 1609.344 };

/** One reading from the phone's GPS. */
export interface Fix {
  t: number;
  lat: number;
  lon: number;
  alt?: number;
  /** How far off the position may be, in metres. */
  acc?: number;
}

const RAD = Math.PI / 180;
const EARTH = 6371008.8;

/** Distance between two points over the ground, in metres. */
export function haversine(a: TrackPoint, b: TrackPoint): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[2] - a[2]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Readings vaguer than this are ignored: they are how a track grows spikes. */
const MAX_ACCURACY = 35;
/** Movement smaller than this is GPS wobble, not travel. */
const MIN_STEP = 4;
/** Faster than this is a glitch, not a person. Metres per second. */
const MAX_SPEED: Record<Activity, number> = { run: 12, walk: 6, ride: 30, other: 30 };
/** Slower than this between two points counts as standing still. Metres per second. */
const MOVING_SPEED: Record<Activity, number> = { run: 0.6, walk: 0.3, ride: 1, other: 0.3 };

/** Whether a new reading should join the track after `last`. */
export function accept(last: TrackPoint | undefined, fix: Fix, activity: Activity): boolean {
  if (fix.acc != null && fix.acc > MAX_ACCURACY) return false;
  if (!last) return true;
  const dt = (fix.t - last[0]) / 1000;
  if (dt <= 0) return false;
  const d = haversine(last, [fix.t, fix.lat, fix.lon]);
  if (d < MIN_STEP) return false;
  return d / dt <= MAX_SPEED[activity];
}

export const toPoint = (f: Fix): TrackPoint => (f.alt != null ? [f.t, f.lat, f.lon, Math.round(f.alt * 10) / 10] : [f.t, f.lat, f.lon]);

/** Every pair of neighbouring points, never across a pause. */
function* legs(segments: TrackPoint[][]): Generator<[TrackPoint, TrackPoint]> {
  for (const seg of segments) for (let i = 1; i < seg.length; i++) yield [seg[i - 1], seg[i]];
}

export function trackMetres(segments: TrackPoint[][]): number {
  let m = 0;
  for (const [a, b] of legs(segments)) m += haversine(a, b);
  return m;
}

/** Time spent actually moving: waiting at a crossing does not count. */
export function movingSeconds(segments: TrackPoint[][], activity: Activity = 'run'): number {
  let s = 0;
  for (const [a, b] of legs(segments)) {
    const dt = (b[0] - a[0]) / 1000;
    if (dt > 0 && haversine(a, b) / dt >= MOVING_SPEED[activity]) s += dt;
  }
  return s;
}

export interface Split {
  n: number;
  metres: number;
  seconds: number;
  /** The last split is usually a part one. */
  partial: boolean;
}

/** Time for each kilometre (or mile) in turn, counting only time spent moving. */
export function splits(segments: TrackPoint[][], every = 1000, activity: Activity = 'run'): Split[] {
  const out: Split[] = [];
  let metres = 0;
  let seconds = 0;
  for (const [a, b] of legs(segments)) {
    let d = haversine(a, b);
    const dt = (b[0] - a[0]) / 1000;
    if (dt <= 0 || d / dt < MOVING_SPEED[activity]) continue;
    let t = dt;
    // A leg can cross a split line: share its time out by distance.
    while (metres + d >= every) {
      const part = every - metres;
      const share = d > 0 ? (part / d) * t : 0;
      out.push({ n: out.length + 1, metres: every, seconds: seconds + share, partial: false });
      d -= part;
      t -= share;
      metres = 0;
      seconds = 0;
    }
    metres += d;
    seconds += t;
  }
  if (metres > 1) out.push({ n: out.length + 1, metres, seconds, partial: true });
  return out;
}

/** Pace over the most recent stretch of a recording, in seconds per metre. */
export function recentPace(segments: TrackPoint[][], windowSeconds = 30): number | undefined {
  const seg = segments[segments.length - 1];
  if (!seg || seg.length < 2) return undefined;
  const end = seg[seg.length - 1];
  let metres = 0;
  let i = seg.length - 1;
  while (i > 0 && (end[0] - seg[i - 1][0]) / 1000 <= windowSeconds) {
    metres += haversine(seg[i - 1], seg[i]);
    i--;
  }
  const seconds = (end[0] - seg[i][0]) / 1000;
  return metres > 5 && seconds > 0 ? seconds / metres : undefined;
}

/** "5.23 km", or "850 m" under a kilometre. Miles always show as miles. */
export function formatDistance(metres: number, unit: DistanceUnit = 'km'): string {
  if (unit === 'km' && metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / UNIT_METRES[unit]).toFixed(2)} ${unit}`;
}

/** "5:32 /km" from a time and a distance; a dash when there is nothing to divide. */
export function formatPace(seconds: number, metres: number, unit: DistanceUnit = 'km'): string {
  if (!(metres > 5) || !(seconds > 0)) return '–';
  const per = (seconds / metres) * UNIT_METRES[unit];
  if (per > 3600) return '–';
  const m = Math.floor(per / 60);
  const s = Math.round(per % 60);
  return `${s === 60 ? m + 1 : m}:${String(s === 60 ? 0 : s).padStart(2, '0')} /${unit}`;
}

/** "42:10", or "1:05:00" past the hour. */
export function formatDuration(total: number): string {
  const t = Math.max(0, Math.round(total));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** South-west and north-east corners of a route, for fitting a map to it. */
export function bounds(segments: TrackPoint[][]): [[number, number], [number, number]] | undefined {
  const pts = segments.flat();
  if (!pts.length) return undefined;
  const lats = pts.map((p) => p[1]);
  const lons = pts.map((p) => p[2]);
  return [
    [Math.min(...lats), Math.min(...lons)],
    [Math.max(...lats), Math.max(...lons)],
  ];
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A route as a GPX file, the format every running and mapping app reads. */
export function toGpx(segments: TrackPoint[][], name: string): string {
  const seg = (points: TrackPoint[]) =>
    `    <trkseg>\n${points
      .map(
        ([t, lat, lon, alt]) =>
          `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">${alt != null ? `<ele>${alt}</ele>` : ''}<time>${new Date(t).toISOString()}</time></trkpt>`,
      )
      .join('\n')}\n    </trkseg>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Training Log" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <trk>',
    `    <name>${esc(name)}</name>`,
    ...segments.filter((s) => s.length).map(seg),
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n');
}

const attr = (tag: string, name: string): number => Number(tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`))?.[1]);

/**
 * Read the track out of a GPX file from a watch or another app. Plain text matching, so it needs
 * no XML parser. Points without a time are given one second each, which keeps the distance right.
 */
export function fromGpx(xml: string): TrackPoint[][] {
  const out: TrackPoint[][] = [];
  const blocks = xml.match(/<trkseg\b[\s\S]*?<\/trkseg>/g) ?? (xml.includes('<trkpt') ? [xml] : []);
  let clock = 0;
  for (const block of blocks) {
    const seg: TrackPoint[] = [];
    for (const m of block.matchAll(/<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/g)) {
      const lat = attr(m[1], 'lat');
      const lon = attr(m[1], 'lon');
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const body = m[2] ?? '';
      const when = Date.parse(body.match(/<time>\s*([^<]+?)\s*<\/time>/)?.[1] ?? '');
      const ele = Number(body.match(/<ele>\s*([^<]+?)\s*<\/ele>/)?.[1]);
      clock = Number.isFinite(when) ? when : clock + 1000;
      seg.push(Number.isFinite(ele) ? [clock, lat, lon, ele] : [clock, lat, lon]);
    }
    if (seg.length) out.push(seg);
  }
  if (!out.length) throw new Error('That file has no GPS track in it.');
  return out;
}
