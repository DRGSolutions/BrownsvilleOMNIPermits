// Build per-pole markers (no clustering) and return bounds.
// Shapes by owner: BPUB = circle, AEP = triangle, MVEC = square.
// Marker FILL = dominant PERMIT STATUS color for that pole (so max zoom reads right).

import { poleKey, statusColor } from './data.js';

function dominantStatusFor(permits){
  if(!permits || !permits.length) return 'NONE';
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
  for (const pred of order){ const hit = ss.find(pred); if (hit) return hit; }
  return ss[0] || 'NONE';
}

const NS = 'http://www.w3.org/2000/svg';
const ICON_PX  = 22;
const STROKE   = 'rgba(255,255,255,0.92)';
const STROKE_W = 3;

function svg(tag, attrs){ const el = document.createElementNS(NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); return el; }

function iconSVG(owner, fillColor){
  const u = String(owner || '').toUpperCase();
  const root = svg('svg', { viewBox:'0 0 24 24' });
  let shape;
  if (u === 'BPUB'){
    shape = svg('circle', { cx:'12', cy:'12', r:'8', fill:fillColor, stroke:STROKE, 'stroke-width':String(STROKE_W) });
  } else if (u === 'AEP'){
    shape = svg('polygon', { points:'12,3 21,21 3,21', fill:fillColor, stroke:STROKE, 'stroke-width':String(STROKE_W) });
  } else if (u === 'MVEC'){
    shape = svg('rect', { x:'4', y:'4', width:'16', height:'16', rx:'4', ry:'4', fill:fillColor, stroke:STROKE, 'stroke-width':String(STROKE_W) });
  } else {
    shape = svg('circle', { cx:'12', cy:'12', r:'8', fill:fillColor, stroke:STROKE, 'stroke-width':String(STROKE_W) });
  }
  root.appendChild(shape);
  root.style.width  = ICON_PX + 'px';
  root.style.height = ICON_PX + 'px';
  root.style.display = 'inline-block';
  return root.outerHTML;
}

function makeIcon(owner, status){
  const fill = statusColor(status);
  return L.divIcon({
    className: 'pole-icon',
    html: iconSVG(owner, fill),
    iconSize: [ICON_PX, ICON_PX],
    iconAnchor: [ICON_PX/2, ICON_PX/2],
    popupAnchor: [0, -10]
  });
}

export function buildMarkers(map, layer, poles, byKey, popupHTML){
  if (layer && layer.clearLayers) layer.clearLayers();
  let bounds = null, llb = null;

  for (const p of (poles||[])){
    if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;

    const rel = byKey.get(poleKey(p)) || [];
    const status = dominantStatusFor(rel);

    const m = L.marker([p.lat, p.lon], {
      icon: makeIcon(p.owner, status),
      alt: `${p.job_name || ''} ${p.tag || ''} ${p.SCID || ''}`
    });

    if (typeof popupHTML === 'function') m.bindPopup(popupHTML(p, rel));
    if (layer) layer.addLayer(m); else m.addTo(map);

    if (!llb) llb = L.latLngBounds([p.lat, p.lon], [p.lat, p.lon]); else llb.extend([p.lat, p.lon]);
  }

  if (llb) bounds = llb;
  return bounds;
}
