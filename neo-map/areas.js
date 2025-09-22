// Hulls with LOD + decluttered labels.
//  - mode 'coarse': ONE convex+smooth hull per job (fast, clean), light fill by mix, few labels
//  - mode 'fine'  : concave+smooth per job (split by DBSCAN+long-edge), optional carve removed for speed/robustness
//  - Label culling: keep at most N labels in viewport; one label per screen grid cell.

import { poleKey, statusColor } from './data.js';
import { LOD } from './app.js'; // for thresholds (optional; remove if cyclic)

// ---------- misc helpers ----------
const km = m => m / 1000;

function medianNN(poles){
  if (poles.length < 2) return 80;
  const pts = poles.map(p => turf.point([+p.lon, +p.lat]));
  const dists = [];
  for (let i=0;i<pts.length;i++){
    let best = Infinity;
    for (let j=0;j<pts.length;j++){
      if (i===j) continue;
      const d = turf.distance(pts[i], pts[j], { units:'meters' });
      if (d < best) best = d;
    }
    if (best < Infinity) dists.push(best);
  }
  dists.sort((a,b)=>a-b);
  return dists.length ? dists[Math.floor(dists.length*0.5)] : 80;
}

function jobMix(plist, byKey){
  const mix = { 'Approved':0,'Submitted - Pending':0,'Created - NOT Submitted':0,'Not Approved - Cannot Attach':0,'Not Approved - Other Issues':0,'NONE':0 };
  for (const p of plist){
    const rel = byKey?.get(poleKey(p)) || [];
    let s = 'NONE';
    if (rel && rel.length){
      const ss = rel.map(r => String(r.permit_status||'').trim());
      const order = [
        t => t.startsWith('Not Approved - Cannot Attach'),
        t => t.startsWith('Not Approved - PLA Issues'),
        t => t.startsWith('Not Approved - MRE Issues'),
        t => t.startsWith('Not Approved - Other Issues'),
        t => t === 'Submitted - Pending',
        t => t === 'Created - NOT Submitted',
        t => t === 'Approved'
      ];
      for (const pred of order){ const hit = ss.find(pred); if (hit){ s = hit.startsWith('Not Approved -') && !hit.startsWith('Not Approved - Cannot Attach') ? 'Not Approved - Other Issues' : hit; break; } }
    }
    mix[s] = (mix[s]||0)+1;
  }
  const dominant = Object.entries(mix).sort((a,b)=>b[1]-a[1])[0][0];
  return { mix, dominant };
}

// convex + smooth (single hull)
function convexSmooth(plist){
  const pts = plist.map(p=>[+p.lon,+p.lat]);
  if (pts.length === 1) return turf.buffer(turf.point(pts[0]), 0.05, { units:'kilometers' });
  const fc = turf.featureCollection(pts.map(p=>turf.point(p)));
  let hull = turf.convex(fc);
  if (!hull) return null;
  // light smooth
  let poly = turf.buffer(hull, 0.06, { units:'kilometers' });
  poly     = turf.buffer(poly, -0.04, { units:'kilometers' });
  poly     = turf.simplify(poly, { tolerance: 0.00012, highQuality: true });
  return turf.cleanCoords(poly);
}

// concave + smooth (single hull)
function concaveSmooth(plist, scaleM){
  const pts = plist.map(p=>[+p.lon,+p.lat]);
  if (pts.length === 1) return turf.buffer(turf.point(pts[0]), km(scaleM*0.6), { units:'kilometers' });
  const fc = turf.featureCollection(pts.map(p=>turf.point(p)));
  const maxEdgeKm = Math.max(km(scaleM)*6.0, 0.15);
  let hull = turf.concave(fc, { maxEdge: maxEdgeKm, units:'kilometers' });
  if (!hull) hull = turf.convex(fc);
  if (!hull) return null;
  const outKm = Math.max(km(scaleM*0.9), 0.06);
  const inKm  = Math.max(km(scaleM*0.7), 0.04);
  let poly = turf.buffer(hull, outKm, { units:'kilometers' });
  poly     = turf.buffer(poly, -inKm, { units:'kilometers' });
  poly     = turf.simplify(poly, { tolerance: 0.00012, highQuality: true });
  return turf.cleanCoords(poly);
}

/* DBSCAN split + long-edge pruning, but keep 1 hull per job at this zoom */
function refineJobHull(plist){
  const scaleM = medianNN(plist);
  // If very spread, just use convex; otherwise concave
  const fc = turf.featureCollection(plist.map(p=>turf.point([+p.lon,+p.lat])));
  const bb = turf.bbox(fc);
  const diagKm = turf.distance([bb[0], bb[1]], [bb[2], bb[3]], { units:'kilometers' });
  if (diagKm > 5) return convexSmooth(plist);
  return concaveSmooth(plist, scaleM);
}

// gradient plumbing
function overlaySVG(map){ return map.getPanes().overlayPane.querySelector('svg'); }
function ensureDefs(svg){ let defs = svg.querySelector('defs'); if (!defs){ defs = document.createElementNS('http://www.w3.org/2000/svg','defs'); svg.prepend(defs); } return defs; }
function idFor(name){ let h=0; for(let i=0;i<name.length;i++) h=(h*31 + name.charCodeAt(i))>>>0; return 'grad-' + h.toString(16); }
function upsertGradient(map, id, mix){
  const svg = overlaySVG(map); if (!svg) return null;
  const defs = ensureDefs(svg);
  let g = defs.querySelector('#'+id);
  if (!g){
    g = document.createElementNS('http://www.w3.org/2000/svg','linearGradient');
    g.setAttribute('id', id);
    g.setAttribute('x1','0'); g.setAttribute('y1','0'); g.setAttribute('x2','1'); g.setAttribute('y2','0');
    g.setAttribute('gradientUnits','objectBoundingBox');
    defs.appendChild(g);
  }
  const order = ['Approved','Submitted - Pending','Created - NOT Submitted','Not Approved - Cannot Attach','Not Approved - Other Issues','NONE'];
  const total = Math.max(1, order.reduce((s,k)=> s + (mix[k]||0), 0));
  while (g.firstChild) g.removeChild(g.firstChild);
  let acc = 0;
  for (const k of order){
    const cnt = mix[k] || 0; if (!cnt) continue;
    const frac = cnt / total;
    const col  = statusColor(k);
    const a    = 0.18;
    const o0 = (acc*100).toFixed(4) + '%';
    const o1 = ((acc+frac)*100).toFixed(4) + '%';
    const s0 = document.createElementNS('http://www.w3.org/2000/svg','stop'); s0.setAttribute('offset', o0); s0.setAttribute('stop-color', col); s0.setAttribute('stop-opacity', String(a));
    const s1 = document.createElementNS('http://www.w3.org/2000/svg','stop'); s1.setAttribute('offset', o1); s1.setAttribute('stop-color', col); s1.setAttribute('stop-opacity', String(a));
    g.appendChild(s0); g.appendChild(s1);
    acc += frac;
  }
  return g;
}

// panes/renderers
let SVG_GLOW = null, SVG_EDGE = null;
function ensurePanesAndRenderers(map){
  if (!map.getPane('jobGlow'))  { const glow = map.createPane('jobGlow');  glow.style.zIndex = 420; glow.style.pointerEvents = 'none'; }
  if (!map.getPane('jobEdge'))  { const edge = map.createPane('jobEdge');  edge.style.zIndex = 430; edge.style.pointerEvents = 'none'; }
  if (!map.getPane('jobLabel')) { const lbl  = map.createPane('jobLabel'); lbl.style.zIndex = 440; lbl.style.pointerEvents = 'none'; }
  if (!SVG_GLOW) SVG_GLOW = L.svg({ pane:'jobGlow' });
  if (!SVG_EDGE) SVG_EDGE = L.svg({ pane:'jobEdge' });
  if (!SVG_GLOW._map) SVG_GLOW.addTo(map);
  if (!SVG_EDGE._map) SVG_EDGE.addTo(map);
}

/* label declutter: keep at most N labels; 1 per grid cell */
function pixelArea(map, feature){
  try{
    const ring = feature.geometry.coordinates[0];
    const pts = ring.map(([x,y]) => map.latLngToLayerPoint([y,x]));
    let a=0; for(let i=0,j=pts.length-1;i<pts.length;j=i++){
      a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
    }
    return Math.abs(a/2);
  }catch{ return 0; }
}
function chooseLabels(map, entries, opts){
  const { maxLabels=40, cell=220, minArea=8000 } = opts || {};
  const kept = [];
  const used = new Set();
  // largest areas first
  entries.sort((a,b)=> b.areaPx - a.areaPx);
  for (const e of entries){
    if (e.areaPx < minArea) continue;
    const p = map.latLngToLayerPoint(e.center);
    const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
    const key = gx + ':' + gy;
    if (used.has(key)) continue;
    used.add(key);
    kept.push(e);
    if (kept.length >= maxLabels) break;
  }
  return kept;
}

// ---------- main ----------
export function buildJobAreas(map, poles, byKey, { mode } = { mode: 'coarse' }){
  ensurePanesAndRenderers(map);

  // group poles by job (keep pole objs)
  const byJob = new Map();
  for (const p of poles){
    const job = String(p.job_name || '').trim(); if (!job) continue;
    const lng = +p.lon, lat = +p.lat;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (!byJob.has(job)) byJob.set(job, []);
    byJob.get(job).push(p);
  }

  const entries = [];
  const layers  = [];

  byJob.forEach((plist, job) => {
    if (!plist.length) return;
    let feature = null;

    if (mode === 'coarse'){
      feature = convexSmooth(plist);
    } else {
      feature = refineJobHull(plist);
    }
    if (!feature) return;

    const { mix, dominant } = jobMix(plist, byKey);
    const col = statusColor(dominant);

    const glow = L.geoJSON(feature, {
      pane: 'jobGlow',
      renderer: SVG_GLOW,
      style: { color: col, weight: 10, opacity: 0.16, fillColor: col, fillOpacity: 0.08 }
    }).addTo(map);

    const edge = L.geoJSON(feature, {
      pane: 'jobEdge',
      renderer: SVG_EDGE,
      style: { color: col, weight: 2.2, opacity: 0.95, fillOpacity: 1 }
    }).addTo(map);

    // gradient fill proportional to mix
    const gradId = 'grad-' + job.replace(/[^a-z0-9]+/gi,'_');
    upsertGradient(map, gradId, mix);
    edge.eachLayer(l => {
      if (l._path){
        l._path.setAttribute('fill', `url(#${gradId})`);
        l._path.style.fillOpacity = '1';
      }
    });

    const center = turf.centerOfMass(feature).geometry.coordinates;
    const areaPx = pixelArea(map, feature);
    entries.push({ job, center: [center[1], center[0]], areaPx, col });

    layers.push({ job, layer: edge, glow });
  });

  // declutter labels depending on zoom
  const z = map.getZoom();
  const opts = (z < LOD.HULL_FINE_MIN)
    ? { maxLabels: 28, cell: 260, minArea: 12000 }   // wide zoom: few labels
    : { maxLabels: 60, cell: 200, minArea: 6000 };   // close zoom: more labels

  const keep = chooseLabels(map, entries, opts);
  for (const e of keep){
    const label = L.marker(e.center, {
      pane: 'jobLabel',
      interactive: false,
      icon: L.divIcon({
        className: 'job-label',
        html: `<div style="font-weight:800;letter-spacing:.3px;font-size:${z<LOD.HULL_FINE_MIN?12:14}px;color:#e6efff;text-shadow:0 2px 10px rgba(0,0,0,.7)">${e.job}</div>`
      })
    }).addTo(map);
    const rec = layers.find(x => x.job === e.job);
    if (rec) rec.label = label;
  }

  return layers;
}
