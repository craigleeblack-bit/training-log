import { describe, expect, it } from 'vitest';
import type { TrackPoint } from '../db/schema';
import {
  accept,
  bounds,
  formatDistance,
  formatDuration,
  formatPace,
  fromGpx,
  haversine,
  movingSeconds,
  recentPace,
  splits,
  toGpx,
  trackMetres,
} from './track';

/** Points heading due north from a start, `step` metres and `dt` seconds apart. */
function line(count: number, step: number, dt: number, t0 = 1_700_000_000_000): TrackPoint[] {
  const perMetre = 1 / 111_195; // degrees of latitude per metre
  return Array.from({ length: count }, (_, i) => [t0 + i * dt * 1000, 51.5 + i * step * perMetre, -0.12]);
}

describe('distance', () => {
  it('measures a known stretch', () => {
    // One degree of latitude is about 111.2 km.
    expect(haversine([0, 51, 0], [0, 52, 0]) / 1000).toBeCloseTo(111.2, 0);
    expect(trackMetres([line(11, 10, 3)])).toBeCloseTo(100, 0);
  });

  it('never counts the jump across a pause', () => {
    const a = line(11, 10, 3);
    const b = line(11, 10, 3, a[10][0] + 600_000).map((p): TrackPoint => [p[0], p[1] + 0.05, p[2]]);
    expect(trackMetres([a, b])).toBeCloseTo(200, 0);
  });
});

describe('filtering readings', () => {
  const last: TrackPoint = [1000, 51.5, -0.12];
  const at = (metresNorth: number, t: number, acc = 8) => ({ t, lat: 51.5 + metresNorth / 111_195, lon: -0.12, acc });

  it('takes the first good reading and drops vague ones', () => {
    expect(accept(undefined, at(0, 1000), 'run')).toBe(true);
    expect(accept(undefined, at(0, 1000, 60), 'run')).toBe(false);
  });

  it('drops wobble while standing still and impossible jumps', () => {
    expect(accept(last, at(2, 3000), 'run')).toBe(false);
    expect(accept(last, at(10, 3000), 'run')).toBe(true);
    expect(accept(last, at(200, 3000), 'run')).toBe(false); // 100 m/s
    expect(accept(last, at(40, 3000), 'ride')).toBe(true); // 20 m/s is a bike
    expect(accept(last, at(10, 1000), 'run')).toBe(false); // no time has passed
  });
});

describe('time and pace', () => {
  it('leaves out time spent standing', () => {
    const moving = line(11, 10, 3); // 100 m in 30 s
    const afterWait = line(11, 10, 3, moving[10][0] + 120_000).map((p): TrackPoint => [p[0], p[1] + 100 / 111_195, p[2]]);
    const seg = [...moving, ...afterWait]; // one segment with a 2-minute stand in the middle
    expect(movingSeconds([seg])).toBeCloseTo(60, 0);
    expect(trackMetres([seg])).toBeCloseTo(200, 0);
  });

  it('splits by the kilometre, sharing a leg that crosses the line', () => {
    const run = line(251, 10, 3); // 2500 m at 10 m per 3 s
    const s = splits([run]);
    expect(s.map((x) => Math.round(x.metres))).toEqual([1000, 1000, 500]);
    expect(s[0].seconds).toBeCloseTo(300, 0);
    expect(s[2]).toMatchObject({ partial: true });
    expect(splits([run], 1609.344)).toHaveLength(2);
  });

  it('formats for reading at a glance', () => {
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(5230)).toBe('5.23 km');
    expect(formatDistance(1609.344, 'mi')).toBe('1.00 mi');
    expect(formatPace(300, 1000)).toBe('5:00 /km');
    expect(formatPace(300, 1000, 'mi')).toBe('8:03 /mi');
    expect(formatPace(0, 0)).toBe('–');
    expect(formatDuration(3900)).toBe('1:05:00');
    expect(recentPace([line(21, 10, 3)])! * 1000).toBeCloseTo(300, 0);
  });
});

describe('GPX', () => {
  it('round-trips a route with a pause', () => {
    const segments = [line(3, 10, 3), line(2, 10, 3, 1_700_000_600_000)];
    const [t, lat, lon] = segments[0][1];
    segments[0][1] = [t, lat, lon, 42.5];
    const xml = toGpx(segments, 'Morning <run>');
    expect(xml).toContain('<name>Morning &lt;run&gt;</name>');
    const back = fromGpx(xml);
    expect(back).toHaveLength(2);
    expect(back[0][1][3]).toBe(42.5);
    expect(back[0][0][0]).toBe(segments[0][0][0]);
    expect(trackMetres(back)).toBeCloseTo(trackMetres(segments), 1);
  });

  it('reads a file from another app, in either attribute order and without times', () => {
    const xml = `<gpx><trk><trkseg>
      <trkpt lon="-0.1200" lat="51.5000"><ele>10</ele><time>2026-11-24T07:00:00Z</time></trkpt>
      <trkpt lat='51.5010' lon='-0.1200'/>
    </trkseg></trk></gpx>`;
    const [seg] = fromGpx(xml);
    expect(seg).toHaveLength(2);
    expect(seg[1][0] - seg[0][0]).toBe(1000);
    expect(bounds([seg])).toEqual([
      [51.5, -0.12],
      [51.501, -0.12],
    ]);
    expect(() => fromGpx('<gpx></gpx>')).toThrow();
  });
});
