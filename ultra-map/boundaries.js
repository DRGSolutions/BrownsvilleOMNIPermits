import { hashColor } from './data.js';

// Resolve concaveman safely if present (UMD or weird globals)
function getConcaveman(){
  const g = (typeof self !== 'undefined' ? self : window);
  const c = g && (g.concaveman || (g.default && g.default.concaveman));
  return (typeof c === 'function') ? c : null;
}
const concavemanFn = getConcaveman();

function buildHullFromPoints(pts){
  // pts: [[lon,lat], ...]
  if (pts.length === 1){
    return turf.buffer(turf.point(pts[0]), 0.03, { units:'kilometers' });
  }

  // Prefer concaveman (fast + tight)
  if (concavemanFn){
    const ring = concavemanFn(pts, 2.0, 0).concat([pts[0]]);
    let poly = turf.polygon([ring]);
    // subtle smooth (buffer out then in), then simplify
    poly = turf.buffer(poly, 0.04, { units:'kilometers' });
    poly = turf.buffer(poly, -0.04, { units:'kilometers' });
    poly = turf.simplify(poly, { tolerance: 0.0004, highQuality: true });
    return poly;
  }

  // Fallback: Turf concave → convex
  const fc = turf.featureCollection(pts.map(p => turf.point(p)));
  let hull = turf.concave(fc, { maxEdge: 0.6, units: 'kilometers' });
  if (!hull) hull = turf.convex(fc);
  if (!hull) return null;

  let poly = turf.buffer(hull, 0.04, { units:'kilometers' });
  poly = turf.buffer(poly, -0.04, { units:'kilometers' });
  poly = turf.simplify(poly, { tolerance: 0.0004, highQuality: true });
  return poly;
}

function bboxIntersects(a,b){
  return !(b[0]>a[2] || b[2]<a[0] || b[1]>a[3] || b[3]<a[1]);
}

// Build detailed job polygons from pole points; carve overlaps for clarity
export function buildJobPolygons(ctxs){
  const groups = new Map(); // job => [[lon,lat],...]
  for (const c of ctxs){
    const k = c.pole.job_name || '—';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push([+c.pole.lon, +c.pole.lat]);
  }

  // Step 1: hull per job
  const raw = [];
  for (const [job, pts] of groups){
    const poly = buildHullFromPoints(pts);
    if (poly) raw.push({ job, feature: poly });
  }

  // Step 2: overlap-aware carving
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
      const center = turf.centerOfMass(base).geometry.coordinates;
      carved.push({ job: raw[i].job, feature: base, centroid: center, color: hashColor(raw[i].job) });
    }
  }

  return { polys: carved };
}
