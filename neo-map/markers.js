// neo-map/markers.js
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

const CANVAS_MARKERS = L.canvas({ padding: 0.4, pane: 'markerPane' });

function hasView(map){ return map && typeof map._zoom === 'number'; }

function svgFor(owner, fill, px){
  const u = String(owner||'').toUpperCase();
  const w = px, h = px;
  if (u === 'AEP')  return `<svg viewBox="0 0 24 24" width="${w}" height="${h}"><polygon points="12,3 21,21 3,21" fill="${fill}"/></svg>`;
  if (u === 'MVEC') return `<svg viewBox="0 0 24 24" width="${w}" height="${h}"><rect x="4" y="4" width="16" height="16" rx="4" ry="4" fill="${fill}"/></svg>`;
  return `<svg viewBox="0 0 24 24" width="${w}" height="${h}"><circle cx="12" cy="12" r="8" fill="${fill}"/></svg>`;
}

export function buildMarkers(map, layer, poles, byKey, popupHTML, mode='shapes', opts={}){
  const dotR = Number(opts.dotRadius || 2.0);
  const px   = Number(opts.shapePx || 14);

  let llb = null;
  const addB = (lat, lon) => { llb ? llb.extend([lat,lon]) : (llb = L.latLngBounds([lat,lon],[lat,lon])); };

  if (!poles || !poles.length) return null;

  if (!hasView(map) || mode === 'none'){
    for (const p of poles){ if (Number.isFinite(p.lat)&&Number.isFinite(p.lon)) addB(p.lat,p.lon); }
    return llb;
  }

  layer?.clearLayers();

  if (mode === 'dots'){
    for (const p of poles){
      if (!Number.isFinite(p.lat)||!Number.isFinite(p.lon)) continue;
      const rel = byKey.get(poleKey(p)) || [];
      const fill = statusColor(dominantStatusFor(rel));
      const dot = L.circleMarker([p.lat, p.lon], {
        renderer: CANVAS_MARKERS, pane:'markerPane',
        radius: dotR, stroke:false, fill:true, fillOpacity:0.95, fillColor:fill,
        interactive:false, bubblingMouseEvents:false
      });
      layer.addLayer(dot);
      addB(p.lat,p.lon);
    }
    return llb;
  }

  // shapes (owner silhouettes), culled to viewport
  const z = map.getZoom(), pad = 256;
  let pb; try { pb = map.getPixelBounds(); } catch { pb = {min:{x:-1e9,y:-1e9},max:{x:1e9,y:1e9}}; }
  const min = L.point(pb.min.x - pad, pb.min.y - pad), max = L.point(pb.max.x + pad, pb.max.y + pad);
  const inView = (lat, lon) => { const pt = map.project([lat,lon], z); return pt.x>=min.x && pt.x<=max.x && pt.y>=min.y && pt.y<=max.y; };

  for (const p of poles){
    if (!Number.isFinite(p.lat)||!Number.isFinite(p.lon)) continue;
    if (inView(p.lat, p.lon)){
      const rel = byKey.get(poleKey(p)) || [];
      const fill = statusColor(dominantStatusFor(rel));
      const html = svgFor(p.owner, fill, px);
      const m = L.marker([p.lat, p.lon], {
        pane:'markerPane',
        icon: L.divIcon({ className:'pole-icon', html, iconSize:[px,px], iconAnchor:[px/2,px/2] }),
        interactive:true
      });
      if (typeof popupHTML === 'function'){
        m.on('click', ()=> m.bindPopup(popupHTML(p, rel)).openPopup());
      }
      layer.addLayer(m);
    }
    addB(p.lat, p.lon);
  }

  return llb;
}
