import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { TrackPoint } from '../db/schema';
import { bounds } from '../lib/track';

/**
 * A route drawn on an OpenStreetMap map. The map pictures come from the network as you look at
 * them; without a signal the line still draws, on a blank background.
 */
export default function TrackMap({ segments, follow }: { segments: TrackPoint[][]; /** Keep the latest point in view. */ follow?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>();
  const drawn = useRef<L.LayerGroup>();
  const placed = useRef(false);

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: false }).setView([54, -2], 5);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
    }).addTo(m);
    map.current = m;
    drawn.current = L.layerGroup().addTo(m);
    return () => {
      m.remove();
      map.current = undefined;
      placed.current = false;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const layer = drawn.current;
    if (!m || !layer || !el.current) return;
    const color = getComputedStyle(el.current).getPropertyValue('--accent').trim() || '#c2553b';
    layer.clearLayers();
    for (const seg of segments) {
      if (seg.length > 1) L.polyline(seg.map((p): [number, number] => [p[1], p[2]]), { color, weight: 5, opacity: 0.9 }).addTo(layer);
    }
    const all = segments.flat();
    const last = all[all.length - 1];
    if (!last) return;
    if (follow) {
      L.circleMarker([last[1], last[2]], { radius: 8, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 }).addTo(layer);
      // Zoom in once, then leave the zoom to the user and only keep the point centred.
      m.setView([last[1], last[2]], placed.current ? m.getZoom() : 16, { animate: placed.current });
      placed.current = true;
    } else {
      const first = all[0];
      L.circleMarker([first[1], first[2]], { radius: 6, color: '#fff', weight: 2, fillColor: '#3f7d4e', fillOpacity: 1 }).addTo(layer);
      L.circleMarker([last[1], last[2]], { radius: 6, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(layer);
      const box = bounds(segments);
      if (box) m.fitBounds(box, { padding: [24, 24], maxZoom: 17 });
    }
  }, [segments, follow]);

  return <div ref={el} className="track-map" role="img" aria-label="Map of the route" />;
}
