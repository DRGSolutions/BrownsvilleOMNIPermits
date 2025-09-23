// High-performance pole rendering with LOD and no outlines.
// Modes:
//   'none'   → draw nothing (compute bounds only)
//   'dots'   → ultra-fast Canvas dots (non-interactive)
//   'shapes' → small Canvas circleMarkers (interactive), culled to viewport
//
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

const CANVAS = L.canvas({ padding: 0.4 }); // shared renderer

function hasView(map){
  // Leaflet sets _zoom once the map has a view (setView/fitBounds/etc.)
  return map && typeof map._zoom === 'number';
}

export function buildMarkers(
  map,
  layer,            // L.LayerGroup
  poles,
  byKey,
  popupHTML,
  mode = 'shapes',  // 'none' | 'dots' | 'shapes'
  opts = {}         // { dotRadius:number, shapePx:number }
){
  const dotR = Number(opts.dotRadius || 2.0);
  const px   = Number(opts.shapePx || 14);

  // Always compute bounds, even if we don’t draw
  let llb = null;
  const addToBounds = (lat, lon) => {
    if (!llb) llb = L.latLngBounds([lat, lon], [lat, lon]); else llb.extend([lat, lon]);
  };

  if (!poles || !poles.length) return null;

  // When map has no view yet (first paint), just compute bounds and return.
  if (!hasView(map) || mode === 'none'){
    for (const p of poles){
      if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      addToBounds(p.lat, p.lon);
    }
    return llb;
  }

  // From here on, a view exists — safe to draw
  if (layer && layer.clearLayers) layer.clearLayers();

  if (mode === 'dots'){
    // ultra-fast, non-interactive dots drawn on Canvas
    for (const p of poles){
      const lat = p.lat, lon = p.lon;
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;

      const rel = byKey.get(poleKey(p)) || [];
      const fill = statusColor(dominantStatusFor(rel));

      const dot = L.circleMarker([lat, lon], {
        renderer: CANVAS,
        radius: dotR,
        stroke: false,
        fill: true, fillOpacity: 0.95, fillColor: fill,
        interactive: false, bubblingMouseEvents: false
      });
      layer.addLayer(dot);
      addToBounds(lat, lon);
    }
    return llb;
  }

  // mode === 'shapes'  (interactive tiny circles, culled to viewport)
  const z = map.getZoom();
  const pad = 256; // pad by one tile to avoid pop-in at edges
  let pb;
  try { pb = map.getPixelBounds(); }
  catch { pb = { min:{x:-Infinity,y:-Infinity}, max:{x:Infinity,y:Infinity} }; }
  const min = pb.min ? pb.min.subtract([pad,pad]) : { x:-Infinity, y:-Infinity };
  const max = pb.max ? pb.max.add([pad,pad])     : { x: Infinity, y: Infinity };
  const inView = (lat, lon) => {
    const pt = map.project([lat, lon], z);
    return pt.x >= min.x && pt.x <= max.x && pt.y >= min.y && pt.y <= max.y;
  };

  const radiusPx = Math.max(2, Math.round(px / 2.2));
  for (const p of poles){
    const lat = p.lat, lon = p.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;

    if (inView(lat, lon)){
      const rel = byKey.get(poleKey(p)) || [];
      const fill = statusColor(dominantStatusFor(rel));

      const m = L.circleMarker([lat, lon], {
        renderer: CANVAS,
        radius: radiusPx,
        stroke: false,
        fill: true, fillOpacity: 0.95, fillColor: fill,
        interactive: true, bubblingMouseEvents: false
      });

      // Lazy popup (created only when needed)
      if (typeof popupHTML === 'function'){
        m.on('click', () => m.bindPopup(popupHTML(p, rel)).openPopup());
      }

      layer.addLayer(m);
    }

    addToBounds(lat, lon);
  }

  return llb;
}
