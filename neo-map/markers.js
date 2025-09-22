// neo-map/markers.js
import { poleKey } from './data.js';

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
const ICON_PX = 22;
const FILL    = 'rgba(148,160,180,0.65)';
const STROKE  = 'rgba(255,255,255,0.92)';
const STROKE_W = 3;

function svgEl(tag, attrs){ const el = document.createElementNS(NS, tag); for(const k in attrs) el.setAttribute(k, attrs[k]); return el; }

function iconSVG(owner){
  const svg = svgEl('svg', { viewBox:'0 0 24 24' });
  const u = String(owner||'').toUpperCase();
  let shape;
  if (u === 'BPUB'){
    shape = svgEl('circle', { cx:'12', cy:'12', r:'8', fill:FILL, stroke:STROKE, 'stroke-width':String(STROKE_W) });
  } else if (u === 'AEP'){
    shape = svgEl('polygon', { points:'12,3 21,21 3,21', fill:FILL, stroke:STROKE, 'stroke-width':String(STROKE_W) });
  } else if (u === 'MVEC'){
    // SQUARE (rounded corners) — this is the change
    shape = svgEl('rect', { x:'4', y:'4', width:'16', height:'16', rx:'4', ry:'4', fill:FILL, stroke:STROKE, 'stroke-width':String(STROKE_W) });
  } else {
    shape = svgEl('circle', { cx:'12', cy:'12', r:'8', fill:FILL, stroke:STROKE, 'stroke-width':String(STROKE_W) });
  }
  svg.appendChild(shape);
  svg.style.width = ICON_PX+'px';
  svg.style.height = ICON_PX+'px';
  svg.style.display = 'inline-block';
  return svg.outerHTML;
}

function makeIcon(owner){
  return L.divIcon({
    className: 'pole-icon',
    html: iconSVG(owner),
    iconSize: [ICON_PX, ICON_PX],
    iconAnchor: [ICON_PX/2, ICON_PX/2],
    popupAnchor: [0, -10]
  });
}

export function buildMarkers(map, cluster, poles, byKey, popupHTML){
  cluster.clearLayers();
  let bounds = null, llb = null;

  for (const p of (poles||[])){
    if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;

    const rel = byKey.get(poleKey(p)) || [];
    const status = dominantStatusFor(rel);

    const m = L.marker([p.lat, p.lon], { icon: makeIcon(p.owner), __status: status });
    if (typeof popupHTML === 'function') m.bindPopup(popupHTML(p, rel));
    cluster.addLayer(m);

    if (!llb) llb = L.latLngBounds([p.lat, p.lon], [p.lat, p.lon]); else llb.extend([p.lat, p.lon]);
  }
  if (llb) bounds = llb;
  return bounds;
}
