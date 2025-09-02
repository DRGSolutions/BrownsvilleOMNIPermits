import { hashColor } from './data.js';

// Build detailed job polygons from pole points using concaveman, then carve overlaps for clarity.
// Returns { polys: Array<{job, feature, centroid:[lon,lat], color}> }
export function buildJobPolygons(ctxs){
  const groups = new Map(); // job => [[lon,lat],...]
  for(const c of ctxs){
    const k = c.pole.job_name || '—';
    if(!groups.has(k)) groups.set(k, []);
    groups.get(k).push([+c.pole.lon, +c.pole.lat]);
  }

  // Step 1: concave hull per job
  const raw = [];
  for(const [job, pts] of groups){
    if (!pts.length) continue;
    let poly;
    if (pts.length===1){
      // tiny circle via turf.buffer(point, ~30m)
      const f = turf.buffer(turf.point(pts[0]), 0.03, { units:'kilometers' });
      poly = f;
    } else {
      const concave = window.concaveman(pts, 2.0, 0); // concavity=2.0 (tighter), lengthThreshold=0
      const ring = concave.concat([concave[0]]);
      poly = turf.polygon([ring]);
      // gentle smooth via buffer+buffer back
      poly = turf.buffer(poly, 0.04, {units:'kilometers'});
      poly = turf.buffer(poly, -0.04, {units:'kilometers'});
      poly = turf.simplify(poly, {tolerance:0.0004, highQuality:true});
    }
    raw.push({ job, feature: poly });
  }

  // Step 2: overlap-aware carving: for each polygon A, subtract union of intersecting Bs (avoid full n^2 via bbox check)
  const carved = [];
  for (let i=0;i<raw.length;i++){
    let base = raw[i].feature;
    const bbA = turf.bbox(base);
    for (let j=0;j<raw.length;j++){
      if (i===j) continue;
      const bbB = turf.bbox(raw[j].feature);
      if (!bboxIntersects(bbA, bbB)) continue;
      const diff = turf.difference(base, raw[j].feature);
      if (diff) base = diff;
    }
    if (base) {
      const center = turf.centerOfMass(base).geometry.coordinates;
      carved.push({ job: raw[i].job, feature: base, centroid: center, color: hashColor(raw[i].job) });
    }
  }
  return { polys: carved };
}

function bboxIntersects(a,b){
  return !(b[0]>a[2] || b[2]<a[0] || b[1]>a[3] || b[3]<a[1]);
}
