import { hashColor } from './data.js';

// tiny helper
const km = (m)=> m/1000;
function bboxIntersects(a,b){ return !(b[0]>a[2] || b[2]<a[0] || b[3]<a[1] || b[1]>a[3]); }

// Estimate a robust distance scale from median nearest-neighbor distance (meters)
function medianNN(pointsLngLat){
  if (pointsLngLat.length < 2) return 80; // ~80m default
  const pts = pointsLngLat.map(p => turf.point(p));
  const tree = turf.featureCollection(pts);
  const dists = [];
  for (let i=0;i<pts.length;i++){
    // brutish but OK for hundreds/thousands; we just need a robust scale
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

// Build one polished polygon from a set of [lon,lat] points
function polishedHull(pts, scaleM){
  if (!pts.length) return null;
  if (pts.length === 1){
    return turf.buffer(turf.point(pts[0]), km(scaleM*0.6), { units:'kilometers' });
  }
  // concave tuned by local spacing; fallback to convex
  const fc = turf.featureCollection(pts.map(p=>turf.point(p)));
  const maxEdgeKm = Math.max(km(scaleM)*6, 0.15); // dynamic, but not too small
  let hull = turf.concave(fc, { maxEdge: maxEdgeKm, units:'kilometers' });
  if (!hull) hull = turf.convex(fc);
  if (!hull) return null;

  // Smooth proportional to spacing
  const padKmOut = Math.max(km(scaleM)*0.8, 0.05);
  const padKmIn  = Math.max(km(scaleM)*0.5, 0.03);
  let poly = turf.buffer(hull, padKmOut, { units:'kilometers' });
  poly = turf.buffer(poly, -padKmIn, { units:'kilometers' });
  poly = turf.simplify(poly, { tolerance: 0.00020, highQuality:true });
  return poly;
}

// Split disjoint jobs into spatial clusters (DBSCAN) using an adaptive radius
function splitClusters(pts, scaleM){
  // Use ~3x median NN as eps; min 4 points to form a cluster
  const epsKm = Math.max(km(scaleM*3.2), 0.12);
  const fc = turf.featureCollection(pts.map(p=>turf.point(p)));
  const clustered = turf.clustersDbscan(fc, epsKm, { minPoints: 4 });
  const groups = new Map(); // id => [[lon,lat]...]
  for (const f of clustered.features){
    const id = f.properties.cluster;
    const lng = f.geometry.coordinates[0], lat = f.geometry.coordinates[1];
    if (id === 'noise' || id === undefined || id === null){
      // keep noise; we’ll bundle later
      const k = '__noise__';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push([lng,lat]);
    } else {
      const k = `c${id}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push([lng,lat]);
    }
  }
  // if everything was noise, just return one group so we still draw an area
  if (!groups.size) groups.set('all', pts.slice());
  return Array.from(groups.values());
}

export function buildJobAreas(map, poles){
  // Group points by job
  const byJob = new Map();
  for (const p of poles){
    const job = String(p.job_name||'').trim(); if (!job) continue;
    if (!byJob.has(job)) byJob.set(job, []);
    byJob.get(job).push([+p.lon, +p.lat]);
  }

  // Phase 1: build raw hulls (possibly multiple per job if split)
  const raw = [];
  byJob.forEach((pts, job)=>{
    const scaleM = medianNN(pts);
    for (const sub of splitClusters(pts, scaleM)){
      const hull = polishedHull(sub, scaleM);
      if (hull) raw.push({ job, feature: hull });
    }
  });

  // Phase 2: carve overlaps so edges are crisp and unambiguous
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
    if (base){
      carved.push({ job: raw[i].job, feature: base });
    }
  }

  // Phase 3: render with a neon halo + crisp outline + center label
  const layers = [];
  carved.forEach(({ job, feature })=>{
    const col = hashColor(job);
    const center = turf.centerOfMass(feature).geometry.coordinates;

    // 3a) soft glow (bigger, translucent)
    const glow = L.geoJSON(feature, {
      style: { color: col, weight: 10, opacity: 0.15, fillColor: col, fillOpacity: 0.08 }
    }).addTo(map);

    // 3b) crisp outline
    const edge = L.geoJSON(feature, {
      style: { color: col, weight: 2, opacity: 0.95, fillColor: col, fillOpacity: 0.20 }
    }).addTo(map);

    // 3c) label
    const label = L.marker([center[1], center[0]], {
      interactive: false,
      icon: L.divIcon({
        className: 'job-label',
        html: `<div style="font-weight:800;letter-spacing:.3px;font-size:14px;color:#e6efff;text-shadow:0 2px 10px rgba(0,0,0,.7)">${job}</div>`
      })
    }).addTo(map);

    layers.push({ job, layer: edge, glow, label });
  });

  return layers;
}
