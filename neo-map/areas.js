// Clickable job areas (concave hulls) + the ORIGINAL clickable circle label.
// - Label fill = dominant permit status color for that area.
// - Polygon fill shows the status MIX proportionally using an SVG linearGradient.

import { poleKey, statusColor } from './data.js';

// ───────── status helpers ─────────
function bucket(status) {
  const s = String(status || '').trim();
  if (s === 'Approved') return 'Approved';
  if (s === 'Submitted - Pending') return 'Submitted - Pending';
  if (s === 'Created - NOT Submitted') return 'Created - NOT Submitted';
  if (s.startsWith('Not Approved - Cannot Attach')) return 'Not Approved - Cannot Attach';
  if (s.startsWith('Not Approved -')) return 'Not Approved - Other Issues';
  return 'NONE';
}
function dominantStatus(permits) {
  if (!permits || !permits.length) return 'NONE';
  const ss = permits.map(r => String(r.permit_status || '').trim());
  const order = [
    s => s.startsWith('Not Approved - Cannot Attach'),
    s => s.startsWith('Not Approved - PLA Issues'),
    s => s.startsWith('Not Approved - MRE Issues'),
    s => s.startsWith('Not Approved - Other Issues'),
    s => s === 'Submitted - Pending',
    s => s === 'Created - NOT Submitted',
    s => s === 'Approved'
  ];
  for (const pred of order) {
    const hit = ss.find(pred);
    if (hit) {
      return hit.startsWith('Not Approved -') && !hit.startsWith('Not Approved - Cannot Attach')
        ? 'Not Approved - Other Issues'
        : hit;
    }
  }
  return ss[0] || 'NONE';
}

// ───────── SVG helpers (gradient + label) ─────────
function overlaySVG(map) {
  return map.getPanes().overlayPane.querySelector('svg');
}
function ensureDefs(svg) {
  let defs = svg.querySelector('defs');
  if (!defs) { defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs'); svg.prepend(defs); }
  return defs;
}
function idFor(name) {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return 'grad-' + h.toString(16);
}
function upsertGradient(map, id, mix) {
  const svg = overlaySVG(map); if (!svg) return null;
  const defs = ensureDefs(svg);
  let g = defs.querySelector('#' + id);
  if (!g) {
    g = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    g.setAttribute('id', id);
    g.setAttribute('x1', '0'); g.setAttribute('y1', '0'); g.setAttribute('x2', '1'); g.setAttribute('y2', '0');
    g.setAttribute('gradientUnits', 'objectBoundingBox');
    defs.appendChild(g);
  }
  const order = ['Approved', 'Submitted - Pending', 'Created - NOT Submitted', 'Not Approved - Cannot Attach', 'Not Approved - Other Issues', 'NONE'];
  const total = Math.max(1, order.reduce((s, k) => s + (mix[k] || 0), 0));

  while (g.firstChild) g.removeChild(g.firstChild);

  let acc = 0;
  for (const k of order) {
    const count = mix[k] || 0;
    if (!count) continue;
    const frac = count / total;
    const col = statusColor(k);
    const a = 0.18; // stop opacity

    const o0 = (acc * 100).toFixed(4) + '%';
    const o1 = ((acc + frac) * 100).toFixed(4) + '%';

    const s0 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    s0.setAttribute('offset', o0); s0.setAttribute('stop-color', col); s0.setAttribute('stop-opacity', String(a));
    const s1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    s1.setAttribute('offset', o1); s1.setAttribute('stop-color', col); s1.setAttribute('stop-opacity', String(a));

    g.appendChild(s0); g.appendChild(s1);
    acc += frac;
  }
  return g;
}

function circleLabelSVG(fillColor, count) {
  const W = 64, C = 32;
  return `
  <svg viewBox="0 0 ${W} ${W}" width="${W}" height="${W}" aria-hidden="true">
    <circle cx="${C}" cy="${C}" r="24" fill="${fillColor}" stroke="white" stroke-width="3" />
    <circle cx="${C}" cy="${C}" r="24" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="1" />
    <text x="${C}" y="${C + 4}" text-anchor="middle" font-size="14" font-weight="700" fill="#e5e7eb">${count}</text>
  </svg>`;
}

// ───────── main export ─────────
export function buildJobAreas(map, poles, byKey) {
  // Group poles by job
  const groups = new Map();
  for (const p of (poles || [])) {
    if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
    const job = p.job_name || '(unknown job)';
    if (!groups.has(job)) groups.set(job, []);
    groups.get(job).push(p);
  }

  const result = [];

  for (const [job, pts] of groups.entries()) {
    if (!pts.length) continue;

    // Turf input
    const fc = turf.points(pts.map(p => [p.lon, p.lat]));

    // Concave hull → fallback to convex if needed
    let poly = turf.concave(fc, { maxEdge: 1.2, units: 'kilometers' });
    if (!poly) poly = turf.convex(fc);
    if (!poly) continue;

    // Leaflet polygon coordinates
    const rings = poly.geometry.coordinates[0].map(([x, y]) => [y, x]);

    // Area centroid (label position)
    const cen = turf.centroid(fc).geometry.coordinates;
    const center = [cen[1], cen[0]];

    // Mix + area-dominant status (for outline + label fill)
    const mix = { 'Approved': 0, 'Submitted - Pending': 0, 'Created - NOT Submitted': 0, 'Not Approved - Cannot Attach': 0, 'Not Approved - Other Issues': 0, 'NONE': 0 };
    for (const p of pts) {
      const rel = byKey?.get(poleKey(p)) || [];
      const d = bucket(dominantStatus(rel));
      mix[d] = (mix[d] || 0) + 1;
    }
    const areaStatus = Object.entries(mix).sort((a, b) => b[1] - a[1])[0][0];
    const col = statusColor(areaStatus);

    // Polygon (stroke = dominant; fill = gradient mix)
    const layer = L.polygon(rings, { color: col, weight: 3, fillColor: col, fillOpacity: 0.18, interactive: true });
    const glow = L.polygon(rings, { color: col, weight: 8, opacity: 0.12, fillOpacity: 0, interactive: false });
    layer.addTo(map); glow.addTo(map);

    // Replace fill with gradient reflecting the mix
    const gradId = idFor(job);
    upsertGradient(map, gradId, mix);
    if (layer._path) {
      layer._path.setAttribute('fill', `url(#${gradId})`);
      layer._path.style.fillOpacity = '1';
    }

    // CLICK polygon to zoom
    layer.on('click', () => map.fitBounds(layer.getBounds().pad(0.12)));

    // CLICKABLE circle label (dominant status color)
    const icon = L.divIcon({
      className: 'area-label',
      html: circleLabelSVG(col, pts.length),
      iconSize: [64, 64],
      iconAnchor: [32, 32]
    });
    const label = L.marker(center, {
      icon,
      pane: 'markerPane',
      interactive: true,
      riseOnHover: true,
      zIndexOffset: 100000
    }).addTo(map);

    // Label drives zoom; stop event so polygon under it can’t steal the click
    label.on('click', (e) => {
      L.DomEvent.stop(e);
      map.fitBounds(layer.getBounds().pad(0.12));
    });
    label.on('mousedown touchstart', (e) => L.DomEvent.stop(e));

    result.push({ job, layer, glow, label });
  }

  return result;
}
