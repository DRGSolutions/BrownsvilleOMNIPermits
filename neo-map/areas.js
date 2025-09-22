// neo-map/areas.js
// Builds job areas (concave hulls) + the original clickable label per area.
// The label is a segmented ring that shows the permit-status mix for that area,
// and the silhouette matches the utility: BPUB=circle, AEP=triangle, MVEC=square.

import { poleKey, statusColor } from './data.js';

// ───────── helpers ─────────
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
  const ss = permits.map(r => String(r.permit_status||'').trim());
  const order = [
    s => s.startsWith('Not Approved - Cannot Attach'),
    s => s.startsWith('Not Approved - PLA Issues'),
    s => s.startsWith('Not Approved - MRE Issues'),
    s => s.startsWith('Not Approved - Other Issues'),
    s => s === 'Submitted - Pending',
    s => s === 'Created - NOT Submitted',
    s => s === 'Approved'
  ];
  for (const pred of order){
    const hit = ss.find(pred);
    if (hit){
      // Collapse all NA-* except CANNOT ATTACH into "Other Issues"
      return hit.startsWith('Not Approved -') && !hit.startsWith('Not Approved - Cannot Attach')
        ? 'Not Approved - Other Issues'
        : hit;
    }
  }
  return ss[0] || 'NONE';
}

// Create the original clickable label (divIcon) with segmented ring
function areaLabelSVG(owner, mix, total){
  const W = 64, C = 32, RING_W = 8;
  const order = ['Approved','Submitted - Pending','Created - NOT Submitted','Not Approved - Cannot Attach','Not Approved - Other Issues','NONE'];
  const sum = total || order.reduce((s,k)=> s + (mix[k]||0), 0);

  // Each segment is a separate stroke on the same outline, using pathLength=100
  let offset = 0;
  const segments = [];
  for (const key of order){
    const count = mix[key] || 0;
    if (!count) continue;
    const len = (count / sum) * 100;
    const color = statusColor(key);
    segments.push({ len, color, off: offset });
    offset += len;
  }

  // Which shape outline to stroke?
  const sh = String(owner||'').toUpperCase();
  const shape = sh === 'AEP' ? 'triangle' : (sh === 'MVEC' ? 'square' : 'circle');

  const common = attrs => Object.entries(attrs).map(([k,v]) => `${k}="${v}"`).join(' ');
  const outline = (stroke='white') => {
    if (shape === 'triangle')  return `<polygon points="32,10 52,52 12,52" fill="none" stroke="${stroke}" stroke-width="2"/>`;
    if (shape === 'square')    return `<rect x="12" y="12" width="40" height="40" rx="7" ry="7" fill="none" stroke="${stroke}" stroke-width="2"/>`;
    return `<circle cx="32" cy="32" r="24" fill="none" stroke="${stroke}" stroke-width="2"/>`;
  };
  const segFor = (color, dash, off) => {
    const base = { fill:'none', stroke:color, 'stroke-width':RING_W, 'stroke-linecap':'butt', 'stroke-linejoin':'round', pathLength:'100', 'stroke-dasharray':`${dash} ${100-dash}`, 'stroke-dashoffset':String(-off) };
    if (shape === 'triangle')  return `<polygon points="32,10 52,52 12,52" ${common(base)} />`;
    if (shape === 'square')    return `<rect x="12" y="12" width="40" height="40" rx="7" ry="7" ${common(base)} />`;
    return `<circle cx="32" cy="32" r="24" ${common(base)} />`;
  };

  const segHTML = segments.map(s => segFor(s.color, s.len, s.off)).join('');
  const text    = `<text x="${C}" y="${C+4}" text-anchor="middle" font-size="14" font-weight="700" fill="#e5e7eb">${sum}</text>`;

  return `<svg viewBox="0 0 ${W} ${W}" width="${W}" height="${W}" aria-hidden="true">
    ${segHTML}
    ${outline('white')}
    ${text}
  </svg>`;
}

// ───────── main export ─────────
export function buildJobAreas(map, poles, byKey) {
  // Group poles by job
  const groups = new Map();
  for (const p of (poles||[])){
    if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
    const job = p.job_name || '(unknown job)';
    if (!groups.has(job)) groups.set(job, []);
    groups.get(job).push(p);
  }

  const result = [];

  for (const [job, pts] of groups.entries()){
    if (!pts.length) continue;

    // Turf input
    const fc = turf.points(pts.map(p => [p.lon, p.lat]));

    // Concave hull → fallback to convex if needed
    let poly = turf.concave(fc, { maxEdge: 1.2, units: 'kilometers' });
    if (!poly) poly = turf.convex(fc);
    if (!poly) continue;

    // Leaflet polygon coordinates
    const rings = poly.geometry.coordinates[0].map(([x,y]) => [y,x]);

    // Area centroid (label position)
    const cen = turf.centroid(fc).geometry.coordinates;
    const center = [cen[1], cen[0]];

    // Majority owner decides the silhouette
    const ownerCount = {};
    for (const p of pts){ const o = String(p.owner||'').toUpperCase(); ownerCount[o]=(ownerCount[o]||0)+1; }
    const owner = Object.entries(ownerCount).sort((a,b)=> b[1]-a[1])[0]?.[0] || 'BPUB';

    // Mix + area-dominant status (used for polygon color, as before)
    const mix = { 'Approved':0,'Submitted - Pending':0,'Created - NOT Submitted':0,'Not Approved - Cannot Attach':0,'Not Approved - Other Issues':0,'NONE':0 };
    for (const p of pts){
      const rel = byKey?.get(poleKey(p)) || [];
      const d = bucket(dominantStatus(rel));
      mix[d] = (mix[d]||0) + 1;
    }
    const areaStatus = Object.entries(mix).sort((a,b)=> b[1]-a[1])[0][0];
    const col = statusColor(areaStatus);

    // Polygon (same behavior; subtle glow layer for readability)
    const layer = L.polygon(rings, { color: col, weight: 3, fillColor: col, fillOpacity: 0.15, interactive:true });
    const glow  = L.polygon(rings, { color: col, weight: 8, opacity: 0.12, fillOpacity: 0, interactive:false });
    layer.addTo(map); glow.addTo(map);

    // Click polygon to fit to itself (keeps prior UX sane)
    layer.on('click', () => map.fitBounds(layer.getBounds().pad(0.12)));

    // Label (CLICKABLE) — this replaces your old “circle” label
    const icon = L.divIcon({
      className: 'area-label',
      html: areaLabelSVG(owner, mix, pts.length),
      iconSize: [64,64],
      iconAnchor: [32,32]
    });
    const label = L.marker(center, { icon, riseOnHover:true });
    label.addTo(map);
    label.on('click', () => map.fitBounds(layer.getBounds().pad(0.12)));

    result.push({ job, owner, layer, glow, label });
  }

  return result;
}
