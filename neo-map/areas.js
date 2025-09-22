// Cleaner job hulls + proportional status-mix shading.
// Strategy:
//   1) Group by job.
//   2) For each job, split spatially with DBSCAN.
//   3) Within each DBSCAN group, split again by long-edge pruning:
//        - Build a graph connecting points whose pairwise distance ≤ τ * scaleM
//        - Connected components become refined sub-clusters (avoids “bridges”).
//   4) Concave hull per sub-cluster, morphologically smoothed (buffer out/in).
//   5) Carve overlaps (largest-first difference) for crisp borders.
//   6) Stroke = dominant status color; Fill = linear gradient by status mix.
//   7) Keep your original job label.

import { poleKey, statusColor } from './data.js';

// ---------- helpers ----------
const km = m => m/1000;
const bboxIntersects = (a,b) => !(b[0]>a[2] || b[2]<a[0] || b[3]<a[1] || b[1]>a[3]);

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

/* First pass: DBSCAN split */
function splitByDbscan(poles, scaleM){
  const epsKm = Math.max(km(scaleM*3.2), 0.12);
  const fc = turf.featureCollection(poles.map((p,i)=>turf.point([+p.lon, +p.lat], { i })));
  const clustered = turf.clustersDbscan(fc, epsKm, { minPoints: 4 });
  const groups = new Map();
  for (const f of clustered.features){
    const id = f.properties.cluster;
    const idx = f.properties.i;
    const key = (id === undefined || id === null || id === 'noise') ? '__noise__' : `c${id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(poles[idx]);
  }
  if (!groups.size) groups.set('all', poles.slice());
  return Array.from(groups.values());
}

/* Second pass: prune long edges inside a DBSCAN group */
function splitByLongEdges(poles, scaleM){
  if (poles.length <= 3) return [poles.slice()];
  const CUT = 2.4 * scaleM; // 2.4× NN median — tweakable
  const n = poles.length;
  const adj = Array.from({length:n}, ()=>[]);
  const pts = poles.map(p => turf.point([+p.lon, +p.lat]));
  for (let i=0;i<n;i++){
    for (let j=i+1;j<n;j++){
      const d = turf.distance(pts[i], pts[j], { units:'meters' });
      if (d <= CUT) { adj[i].push(j); adj[j].push(i); }
    }
  }
  const seen = new Array(n).fill(false), comps = [];
  for (let i=0;i<n;i++){
    if (seen[i]) continue;
    const q=[i]; seen[i]=true; const comp=[poles[i]];
    while(q.length){
      const v=q.pop();
      for (const w of adj[v]) if(!seen[w]){ seen[w]=true; q.push(w); comp.push(poles[w]); }
    }
    comps.push(comp);
  }
  return comps;
}

/* Hull smoothing: concave hull + morphological close (buffer out/in) */
function smoothHull(lngLat, scaleM){
  if (!lngLat.length) return null;
  if (lngLat.length === 1){
    return turf.buffer(turf.point(lngLat[0]), km(scaleM*0.6), { units:'kilometers' });
  }
  const fc = turf.featureCollection(lngLat.map(p=>turf.point(p)));
  const maxEdgeKm = Math.max(km(scaleM)*6.0, 0.15);
  let hull = turf.concave(fc, { maxEdge: maxEdgeKm, units:'kilometers' });
  if (!hull) hull = turf.convex(fc);
  if (!hull) return null;

  const outKm = Math.max(km(scaleM*0.9), 0.06);
  const inKm  = Math.max(km(scaleM*0.7), 0.04);
  let poly = turf.buffer(hull, outKm, { units:'kilometers' });
  poly     = turf.buffer(poly, -inKm, { units:'kilometers' });
  poly     = turf.simplify(poly, { tolerance: 0.00012, highQuality: true });
  poly     = turf.cleanCoords(poly);
  return poly;
}

// gradient plumbing (one <defs> reused for all hulls)
function overlaySVG(map){ return map.getPanes().overlayPane.querySelector('svg'); }
function ensureDefs(svg){
  let defs = svg.querySelector('defs');
  if (!defs){ defs = document.createElementNS('http://www.w3.org/2000/svg','defs'); svg.prepend(defs); }
  return defs;
}
function idFor(name){
  let h=0; for(let i=0;i<name.length;i++) h=(h*31 + name.charCodeAt(i))>>>0;
  return 'grad-' + h.toString(16);
}
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
    const a    = 0.18;  // subtle area fill
    const o0 = (acc*100).toFixed(4) + '%';
    const o1 = ((acc+frac)*100).toFixed(4) + '%';
    const s0 = document.createElementNS('http://www.w3.org/2000/svg','stop');
    s0.setAttribute('offset', o0); s0.setAttribute('stop-color', col); s0.setAttribute('stop-opacity', String(a));
    const s1 = document.createElementNS('http://www.w3.org/2000/svg','stop');
    s1.setAttribute('offset', o1); s1.setAttribute('stop-color', col); s1.setAttribute('stop-opacity', String(a));
    g.appendChild(s0); g.appendChild(s1);
    acc += frac;
  }
  return g;
}

// panes/renderers (SVG so ordering wins even with preferCanvas:true)
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

// ---------- main ----------
export function buildJobAreas(map, poles, byKey){
  ensurePanesAndRenderers(map);

  // group poles by job (store full pole objs)
  const byJob = new Map();
  for (const p of poles){
    const job = String(p.job_name || '').trim(); if (!job) continue;
    const lng = +p.lon, lat = +p.lat;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (!byJob.has(job)) byJob.set(job, []);
    byJob.get(job).push(p);
  }

  // raw sub-hulls per job
  const raw = [];
  byJob.forEach((plist, job)=>{
    const scaleM = medianNN(plist);
    const dbGroups = splitByDbscan(plist, scaleM);
    for (const g of dbGroups){
      const comps = splitByLongEdges(g, scaleM);  // prune bridges
      for (const comp of comps){
        const pts = comp.map(p=>[+p.lon, +p.lat]);
        const hull = smoothHull(pts, scaleM);
        if (hull) raw.push({ job, feature: hull, poles: comp });
      }
    }
  });

  // carve overlaps (largest-first)
  const carved = [];
  const byAreaDesc = raw.slice().sort((a,b)=> turf.area(b.feature)-turf.area(a.feature));
  let unionSoFar = null;
  for (const item of byAreaDesc){
    let geom = item.feature;
    if (unionSoFar){
      const diff = turf.difference(geom, unionSoFar);
      if (!diff) continue;
      geom = diff;
    }
    carved.push({ job:item.job, feature:geom, poles:item.poles });
    unionSoFar = unionSoFar ? turf.union(unionSoFar, geom) : geom;
  }

  // render (glow + edge + label), gradient fill by mix
  const layers = [];
  for (const { job, feature, poles: plist } of carved){
    // compute mix from poles in this sub-hull
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
      mix[s] = (mix[s]||0) + 1;
    }
    const dominant = Object.entries(mix).sort((a,b)=> b[1]-a[1])[0][0];
    const col = statusColor(dominant);

    const glow = L.geoJSON(feature, {
      pane: 'jobGlow',
      renderer: SVG_GLOW,
      style: { color: col, weight: 10, opacity: 0.20, fillColor: col, fillOpacity: 0.10 }
    }).addTo(map);

    const edge = L.geoJSON(feature, {
      pane: 'jobEdge',
      renderer: SVG_EDGE,
      style: { color: col, weight: 2.25, opacity: 0.98, fillOpacity: 1 }
    }).addTo(map);

    const gradId = idFor(job + '__' + turf.area(feature).toFixed(0));
    upsertGradient(map, gradId, mix);
    edge.eachLayer(l => {
      if (l._path){
        l._path.setAttribute('fill', `url(#${gradId})`);
        l._path.style.fillOpacity = '1';
      }
    });

    // keep your original label style
    const center = turf.centerOfMass(feature).geometry.coordinates;
    const label = L.marker([center[1], center[0]], {
      pane: 'jobLabel',
      interactive: false,
      icon: L.divIcon({
        className: 'job-label',
        html: `<div style="font-weight:800;letter-spacing:.3px;font-size:14px;color:#e6efff;text-shadow:0 2px 10px rgba(0,0,0,.7)">${job}</div>`
      })
    }).addTo(map);

    layers.push({ job, layer: edge, glow, label });
  }

  return layers;
}
