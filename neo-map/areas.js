// neo-map/areas.js
// Builds job areas (concave hulls) + the ORIGINAL CLICKABLE label.
// The label remains clickable to zoom to the area, but its silhouette now matches
// the utility (BPUB=circle, AEP=triangle, MVEC=square) and its ring is segmented
// by the area's permit-status mix.

import { poleKey, statusColor } from './data.js';

// ───────── utilities ─────────
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

// Dedicated pane so the label is always on top and CLICKABLE
function ensureLabelPane(map){
  if (!map.getPane('areaLabelPane')){
    map.createPane('areaLabelPane');
    const pane = map.getPane('areaLabelPane');
    pane.style.zIndex = '650';         // above polygons & clusters, below tooltips/popups
    pane.style.pointerEvents = 'auto'; // allow clicks
  }
}

// Build the clickable label SVG with segmented status ring
function areaLabelSVG(owner, mix, total){
  const W = 64, C = 32, RING_W = 8;

  // Segment order matches legend
  const order = ['Approved','Submitted - Pending','Created - NOT Submitted','Not Approved - Cannot Attach','Not Approved - Other Issues','NONE'];
  const sum = Math.max(1, total || order.reduce((s,k)=> s + (mix[k]||0), 0));

  // Precompute segments as percentage lengths on a unified pathLength=100 outline
  const segs = [];
  let acc = 0;
  for (const k of order){
    const cnt = mix[k] || 0;
    if (!cnt) continue;
    const len = (cnt / sum) * 100;
    segs.push({ color: statusColor(k), len, off: acc });
    acc += len;
  }

  // Choose silhouette by utility
  const sh = String(owner||'').toUpperCase();
  const shape = sh === 'AEP' ? 'triangle' : (sh === 'MVEC' ? 'square' : 'circle');

  const pathAttrs = (stroke, dash, off) => {
    const common = `fill="none" stroke="${stroke}" stroke-width="${RING_W}" stroke-linecap="butt" stroke-linejoin="round" pathLength="100" stroke-dasharray="${dash} ${100-dash}" stroke-dashoffset="${-off}"`;
    if (shape === 'triangle')  return `<polygon points="32,10 52,52 12,52" ${common} />`;
    if (shape === 'square')    return `<rect x="12" y="12" width="40" height="40" rx="7" ry="7" ${common} />`;
    return `<circle cx="32" cy="32" r="24" ${common} />`;
  };
  const outline = (stroke='white') => {
    if (shape === 'triangle')  return `<polygon points="32,10 52,52 12,52" fill="none" stroke="${stroke}" stroke-width="2"/>`;
    if (shape === 'square')    return `<rect x="12" y="12" width="40" height="40" rx="7" ry="7" fill="none" stroke="${stroke}" stroke-width="2"/>`;
    return `<circle cx="32" cy="32" r="24" fill="none" stroke="${stroke}" stroke-width="2"/>`;
  };

  const segments = segs.map(s => pathAttrs(s.color, s.len, s.off)).join('');
  const count    = `<text x="${C}" y="${C+4}" text-anchor="middle" font-size="14" font-weight="700" fill="#e5e7eb">${sum}</text>`;

  return `<svg viewBox="0 0 ${W} ${W}" width="${W}" height="${W}" aria-hidden="true">
    ${segments}
    ${outline('white')}
    ${count}
  </svg>`;
}

// ───────── main export ─────────
export function buildJobAreas(map, poles, byKey) {
  ensureLabelPane(map);

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

    // Majority owner decides silhouette
    const ownerCount = {};
    for (const p of pts){ const o = String(p.owner||'').toUpperCase(); ownerCount[o]=(ownerCount[o]||0)+1; }
    const owner = Object.entries(ownerCount).sort((a,b)=> b[1]-a[1])[0]?.[0] || 'BPUB';

    // Build status mix for this area
    const mix = { 'Approved':0,'Submitted - Pending':0,'Created - NOT Submitted':0,'Not Approved - Cannot Attach':0,'Not Approved - Other Issues':0,'NONE':0 };
    for (const p of pts){
      const rel = byKey?.get(poleKey(p)) || [];
      const d = bucket(dominantStatus(rel));
      mix[d] = (mix[d]||0) + 1;
    }
    const areaStatus = Object.entries(mix).sort((a,b)=> b[1]-a[1])[0][0];
    const col = statusColor(areaStatus);

    // Polygon (same as before)
    const layer = L.polygon(rings, { color: col, weight: 3, fillColor: col, fillOpacity: 0.15, interactive:true });
    const glow  = L.polygon(rings, { color: col, weight: 8, opacity: 0.12, fillOpacity: 0, interactive:false });
    layer.addTo(map); glow.addTo(map);

    // CLICK polygon to fit to itself (unchanged UX)
    layer.on('click', () => map.fitBounds(layer.getBounds().pad(0.12)));

    // CLICKABLE label — lives in its own pane, sits above everything, always clickable
    const icon = L.divIcon({
      className: 'area-label',
      html: areaLabelSVG(owner, mix, pts.length),
      iconSize: [64,64],
      iconAnchor: [32,32]
    });
    const label = L.marker(center, {
      icon,
      pane: 'areaLabelPane',
      riseOnHover: true,
      zIndexOffset: 1000
    });
    label.addTo(map);
    label.on('click', () => map.fitBounds(layer.getBounds().pad(0.12)));

    // return same shape as before so app.js clean-up works
    result.push({ job, owner, layer, glow, label });
  }

  return result;
}
