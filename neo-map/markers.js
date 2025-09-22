// Per-pole markers with LOD + compact sizes.
// mode: 'none' | 'dots' | 'shapes'
// opts: { dotRadius:number, shapePx:number }
// Shapes by owner: BPUB=circle, AEP=triangle, MVEC=square
// Fill color = dominant permit status for that pole.

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
const STROKE   = 'rgba(255,255,255,0.92)';
const STROKE_W = 3;
const CANVAS = L.canvas({ padding: 0.4 });

// cache icons by owner|fill|px to keep redraws cheap
const iconCache = new Map();
function cacheKey(owner, fill, px){ return `${String(owner||'').toUpperCase()}|${fill}|${px}`; }

function svg(tag, attrs){ const el = document.createElementNS(NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); return el; }

function iconSVG(owner, fillColor, px){
  const key = cacheKey(owner, fillColor, px);
  const hit = iconCache.get(key);
  if (hit) return hit;

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
  root.style.width  = px + 'px';
  root.style.height = px + 'px';
  root.style.display = 'inline-block';

  const html = root.outerHTML;
  iconCache.set(key, html);
  return html;
}

function makeIcon(owner, status, px){
  const fill = statusColor(status);
  return L.divIcon({
    className: 'pole-icon',
    html: iconSVG(owner, fill, px),
    iconSize: [px, px],
    iconAnchor: [px/2, px/2],
    popupAnchor: [0, -10]
  });
}

export function buildMarkers(map, layer, poles, byKey, popupHTML, mode='shapes', opts={}){
  const dotR = Number(opts.dotRadius || 0);
  const px   = Number(opts.shapePx || 16);

  if (layer && layer.clearLayers) layer.clearLayers();

  let bounds = null, llb = null;

  if (mode === 'none'){
    for (const p of (poles||[])){
      if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      if (!llb) llb = L.latLngBounds([p.lat, p.lon], [p.lat, p.lon]); else llb.extend([p.lat, p.lon]);
    }
    return llb || null;
  }

  if (mode === 'dots'){
    for (const p of (poles||[])){
      if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      const rel = byKey.get(poleKey(p)) || [];
      const status = dominantStatusFor(rel);
      const fill = statusColor(status);

      const dot = L.circleMarker([p.lat, p.lon], {
        renderer: CANVAS,
        radius: dotR || 2.0,
        stroke: false,
        fill: true,
        fillOpacity: 0.9,
        fillColor: fill,
        interactive: false
      });
      if (layer) layer.addLayer(dot); else dot.addTo(map);

      if (!llb) llb = L.latLngBounds([p.lat, p.lon], [p.lat, p.lon]); else llb.extend([p.lat, p.lon]);
    }
    return llb || null;
  }

  // shapes
  for (const p of (poles||[])){
    if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;

    const rel = byKey.get(poleKey(p)) || [];
    const status = dominantStatusFor(rel);

    const m = L.marker([p.lat, p.lon], {
      icon: makeIcon(p.owner, status, px),
      alt: `${p.job_name || ''} ${p.tag || ''} ${p.SCID || ''}`
    });

    if (typeof popupHTML === 'function') m.bindPopup(popupHTML(p, rel));
    if (layer) layer.addLayer(m); else m.addTo(map);

    if (!llb) llb = L.latLngBounds([p.lat, p.lon], [p.lat, p.lon]); else llb.extend([p.lat, p.lon]);
  }

  return llb || null;
}
