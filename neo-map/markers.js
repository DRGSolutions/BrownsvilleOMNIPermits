// High-performance pole rendering with LOD and no outlines.
// Modes:
//   'none'   → draw nothing (compute bounds only)
//   'dots'   → ultra-fast Canvas dots (non-interactive)
//   'shapes' → small Canvas circleMarkers (interactive popups), culled to viewport
//
// Fill color = dominant permit status for that pole.
// Owner silhouettes are dropped for performance (all circles); we keep them tiny.

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

const CANVAS = L.canvas({ padding: 0.4 }); // shared renderer for everything

export function buildMarkers(
  map,
  layer,            // L.LayerGroup (will be cleared in 'dots'/'shapes')
  poles,
  byKey,
  popupHTML,
  mode = 'shapes',  // 'none' | 'dots' | 'shapes'
  opts = {}         // { dotRadius:number, shapePx:number }
){
  const dotR = Number(opts.dotRadius || 2.0);
  const px   = Number(opts.shapePx || 16);
  const z    = map.getZoom();

  // compute bounds always
  let llb = null;
  const addToBounds = (lat, lon) => {
    if (!llb) llb = L.latLngBounds([lat, lon], [lat, lon]); else llb.extend([lat, lon]);
  };

  if (mode === 'none'){
    for (const p of (poles||[])){
      if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      addToBounds(p.lat, p.lon);
    }
    return llb || null;
  }

  // Clear target layer before drawing this mode
  if (layer && layer.clearLayers) layer.clearLayers();

  // FAST DOTS (non-interactive, single Canvas pass)
  if (mode === 'dots'){
    // Draw visible poles as cheap canvas circleMarkers (no stroke, no events)
    for (const p of (poles||[])){
      const lat = p.lat, lon = p.lon;
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;

      const rel = byKey.get(poleKey(p)) || [];
      const status = dominantStatusFor(rel);
      const fill = statusColor(status);

      const dot = L.circleMarker([lat, lon], {
        renderer: CANVAS,
        radius: dotR,       // small
        stroke: false,      // ← no white outline
        fill: true,
        fillOpacity: 0.95,
        fillColor: fill,
        interactive: false, // fastest
        bubblingMouseEvents: false
      });

      if (layer) layer.addLayer(dot); else dot.addTo(map);
      addToBounds(lat, lon);
    }
    return llb || null;
  }

  // INTERACTIVE CANVAS CIRCLES (still tiny, but clickable with lazy popups)
  // Only create shapes for what’s on screen (viewport culling) to keep count low.
  const pad = 256; // 1 tile padding for smooth panning
  const pb  = map.getPixelBounds();
  const min = pb.min.subtract([pad,pad]);
  const max = pb.max.add([pad,pad]);

  const inView = (lat, lon) => {
    const pt = map.project([lat, lon], z);
    return pt.x >= min.x && pt.x <= max.x && pt.y >= min.y && pt.y <= max.y;
  };

  const radiusPx = Math.max(2, Math.round(px / 2.2)); // compact, readable
  for (const p of (poles||[])){
    const lat = p.lat, lon = p.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    if (!inView(lat, lon)) { addToBounds(lat, lon); continue; }

    const rel = byKey.get(poleKey(p)) || [];
    const status = dominantStatusFor(rel);
    const fill = statusColor(status);

    const m = L.circleMarker([lat, lon], {
      renderer: CANVAS,
      radius: radiusPx,
      stroke: false,            // ← no outline (big perf win)
      fill: true,
      fillOpacity: 0.95,
      fillColor: fill,
      interactive: true,
      bubblingMouseEvents: false
    });

    // Lazy popup (created only when needed)
    if (typeof popupHTML === 'function'){
      m.on('click', () => { m.bindPopup(popupHTML(p, rel)).openPopup(); });
    }

    if (layer) layer.addLayer(m); else m.addTo(map);
    addToBounds(lat, lon);
  }

  return llb || null;
}
