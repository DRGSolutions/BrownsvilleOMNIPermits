import { hashColor } from './data.js';

// ---------- internal helpers ----------
const km = m => m/1000;
const bboxIntersects = (a,b) => !(b[0]>a[2] || b[2]<a[0] || b[3]<a[1] || b[1]>a[3]);

function ensurePanes(map){
  // Create once; safe to call multiple times
  if (!map.getPane('jobGlow')) {
    const glow = map.createPane('jobGlow');
    glow.style.zIndex = 420;          // above tiles
    glow.style.pointerEvents = 'none';
  }
  if (!map.getPane('jobEdge')) {
    const edge = map.createPane('jobEdge');
    edge.style.zIndex = 430;          // above glow, below markers/clusters (Leaflet default marker pane ~600)
    edge.style.pointerEvents = 'none';
  }
  if (!map.getPane('jobLabel')) {
    const lbl = map.createPane('jobLabel');
    lbl.style.zIndex = 440;
    lbl.style.pointerEvents = 'none';
  }
}

// median nearest-neighbor spacing (meters) → robust scale for hulls
function medianNN(pointsLngLat){
  if (pointsLngLat.length < 2) return 80; // ~80 m default
  const pts = pointsLngLat.map(p => turf.point(p));
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

// build single polished hull from a set of [lon,lat]
function polishedHull(pts, scaleM){
  if (!pts.length) return null;
  if (pts.length === 1){
    return turf.buffer(turf.point(pts[0]), km(scaleM*0.6), { units:'kilometers' });
  }
  const fc = turf.featureCollection(pts.map(p=>turf.point(p)));
  const maxEdgeKm = Math.max(km(scaleM)*6, 0.15); // adaptive, never too tiny
  let hull = turf.concave(fc, { maxEdge: maxEdgeKm, units:'kilometers' });
  if (!hull) hull = turf.convex(fc);
  if (!hull) return null;

  const padKmOut = Math.max(km(scaleM)*0.8, 0.05);
  const padKmIn  = Math.max(km(scaleM)*0.5, 0.03);
  let poly = turf.buffer(hull, padKmOut, { units:'kilometers' });
  poly     = turf.buffer(poly, -padKmIn,  { units:'kilometers' });
  poly     = turf.simplify(poly, { tolerance: 0.00020, highQuality: true });
  return poly;
}

// split widely-separated points into spatial clusters using DBSCAN
function splitClusters(pts, scaleM){
  const epsKm = Math.max(km(scaleM*3.2), 0.12);   // adaptive radius
  const fc = turf.featureCollection(pts.map(p=>turf.point(p)));
  const clustered = turf.clustersDbscan(fc, epsKm, { minPoints: 4 });
  const groups = new Map();
  for (const f of clustered.features){
    const id = f.properties.cluster;
    const [lng,lat] = f.geometry.coordinates;
    const key = (id === undefined || id === null || id === 'noise') ? '__noise__' : `c${id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push([lng,lat]);
  }
  if (!groups.size) groups.set('all', pts.slice());
  return Array.from(groups.values());
}

// ---------- public API ----------
export function buildJobAreas(map, poles){
  ensurePanes(map);

  // group by job
  const byJob = new Map();
  for (const p of poles){
    const job = String(p.job_name || '').trim(); if (!job) continue;
    const lng = +p.lon, lat = +p.lat;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (!byJob.has(job)) byJob.set(job, []);
    byJob.get(job).push([lng, lat]);
  }

  // step 1: raw hulls (multiple per job if split)
  const raw = [];
  byJob.forEach((pts, job)=>{
    const scaleM = medianNN(pts);
    for (const sub of splitClusters(pts, scaleM)){
      const hull = polishedHull(sub, scaleM);
      if (hull) raw.push({ job, feature: hull });
    }
  });

  // step 2: carve overlaps so borders are crisp
  const carved = [];
  for (let i=0; i<raw.length; i++){
    let base = raw[i].feature;
    const bbA = turf.bbox(base);
    for (let j=0; j<raw.length; j++){
      if (i===j) continue;
      const bbB = turf.bbox(raw[j].feature);
      if (!bboxIntersects(bbA, bbB)) continue;
      const diff = turf.difference(base, raw[j].feature);
      if (diff) base = diff;
    }
    if (base) carved.push({ job: raw[i].job, feature: base });
  }

  // step 3: render (glow + edge + label) on dedicated panes
  const layers = [];
  for (const { job, feature } of carved){
    const col = hashColor(job);
    const center = turf.centerOfMass(feature).geometry.coordinates;

    const glow = L.geoJSON(feature, {
      pane: 'jobGlow',
      style: { color: col, weight: 10, opacity: 0.22, fillColor: col, fillOpacity: 0.12 }
    }).addTo(map);

    const edge = L.geoJSON(feature, {
      pane: 'jobEdge',
      style: { color: col, weight: 2.25, opacity: 0.98, fillColor: col, fillOpacity: 0.24 }
    }).addTo(map);

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
