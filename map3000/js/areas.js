// /map3000/js/areas.js — robust job borders (always-visible)
import { poleKey } from './config.js';

const PANE_NAME = 'areas-pane';

// ---- helpers ----------------------------------------------------
const normJob = (s) => String(s ?? '')
  .normalize('NFKC')
  .replace(/\s+/g, ' ')      // collapse runs of whitespace
  .trim();                   // trim edges
const colorFromString = (s) => { let h=0; for (let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return `hsl(${h%360} 70% 52%)`; };

// Build a visible shape even for sparse jobs:
// - 1 point  -> point buffer (~35m)
// - 2 points -> line buffer  (~35m)
// - 3+       -> concave hull (tight), fallback to convex
function makeHull(ptsLngLat){
  if (!ptsLngLat || !ptsLngLat.length) return null;

  if (ptsLngLat.length === 1) {
    return turf.buffer(turf.point(ptsLngLat[0]), 0.035, { units:'kilometers' });
  }
  if (ptsLngLat.length === 2) {
    return turf.buffer(turf.lineString(ptsLngLat), 0.035, { units:'kilometers' });
  }

  const fc = turf.featureCollection(ptsLngLat.map(c => turf.point(c)));
  let poly = null;

  try {
    poly = turf.concave(fc, { maxEdge: 0.45, units: 'kilometers' });  // tighter than default
  } catch (_) {}

  if (!poly) {
    try { poly = turf.convex(fc); } catch (_) {}
  }
  if (!poly) {
    // extremely scattered — union small point buffers
    const rings = ptsLngLat.map(c => turf.buffer(turf.point(c), 0.03, { units: 'kilometers' }));
    try { poly = turf.union(...rings); } catch (_) { poly = rings[0]; }
  }

  // Smooth and flatten to guarantee Polygon/MultiPolygon only
  let simplified = poly;
  try { simplified = turf.simplify(poly, { tolerance: 0.00004, highQuality: true }); } catch (_) {}
  try { simplified = turf.flatten(simplified); } catch (_) {}

  return simplified;
}

// Clip overlaps so neighboring jobs don’t “violate” each other.
// We sort by area (big first), then subtract earlier ones from later ones.
// We ignore microscopic overlaps; if subtraction erases a feature, we keep it.
function clipOverlaps(jobToGeo){
  const entries = [...jobToGeo.entries()]
    .map(([job, geo]) => [job, geo, safeArea(geo)])
    .sort((a,b) => b[2] - a[2]);

  const out = [];
  for (let i=0; i<entries.length; i++){
    const [job, geo] = entries[i];
    const feats = toFeatures(geo);
    let cur = feats;

    for (let j=0; j<i; j++){
      const other = out[j].geo; // previously placed geometry
      cur = cur.flatMap(f => {
        try {
          const inter = turf.intersect(f, other);
          if (!inter || safeArea(inter) < 15) return [f]; // ignore tiny overlaps
          const diff = turf.difference(f, other);
          return diff ? toFeatures(diff) : [f];           // never lose the piece entirely
        } catch (_) {
          return [f];
        }
      });
    }

    const fc = turf.featureCollection(cur);
    out.push({ job, geo: fc.features.length ? fc : geo });
  }
  return out;
}

const toFeatures = g =>
  (g?.type === 'FeatureCollection') ? g.features
  : (g?.type === 'GeometryCollection') ? turf.flatten(g).features
  : (g ? [g] : []);

const safeArea = g => { try { return turf.area(g) || 0; } catch (_) { return 0; } };

// ---- lifecycle ---------------------------------------------------
export function init(map, state){
  // Create pane above overlays but below markers
  map.createPane(PANE_NAME);
  const pane = map.getPane(PANE_NAME);
  pane.classList.add('areas-pane');
  pane.style.zIndex = 625;            // markers are usually ~650
  pane.style.pointerEvents = 'none';  // don’t intercept clicks

  state.areas = [];                   // [{fill: L.GeoJSON, label: L.Marker}]
}

// Draw everything for the current dataset (or a provided sample)
export function rebuild(sample=null){
  const s = state;
  const list = sample || s.poles;

  // 1) Group by normalized job name and collect [lng,lat]
  const byJob = new Map();
  for (const p of list){
    const job = normJob(p.job_name);
    if (!job) continue;
    if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
    if (!byJob.has(job)) byJob.set(job, []);
    byJob.get(job).push([p.lon, p.lat]);
  }

  if (byJob.size === 0){
    // Nothing to render — clear layers if any
    clearLayers(s.map, s);
    return;
  }

  // 2) Create per-job hulls
  const raw = new Map();
  byJob.forEach((pts, job) => {
    const hull = makeHull(pts);
    if (hull) raw.set(job, hull);
  });

  // 3) De-overlap
  const clipped = clipOverlaps(raw);

  // 4) Render
  draw(s.map, s, clipped);
}

function clearLayers(map, state){
  state.areas.forEach(a => { map.removeLayer(a.fill); map.removeLayer(a.label); });
  state.areas = [];
}

function draw(map, state, list){
  clearLayers(map, state);

  for (const {job, geo} of list){
    const col = colorFromString(job);

    const fill = L.geoJSON(geo, {
      pane: PANE_NAME,
      style: {
        color: col,
        weight: 3.2,          // thicker neon edge
        opacity: 0.98,        // bright stroke
        fillColor: col,
        fillOpacity: 0.36     // clearly visible on dark tiles
      }
    }).addTo(map);

    // Ensure it sits above other overlays
    try { fill.bringToFront(); } catch (_) {}

    // Center label
    let center;
    try {
      center = turf.centerOfMass(geo).geometry.coordinates;
    } catch (_) {
      const bb = turf.bbox(geo);
      center = turf.center(turf.bboxPolygon(bb)).geometry.coordinates;
    }

    const label = L.marker([center[1], center[0]], {
      pane: PANE_NAME, interactive:false,
      icon: L.divIcon({
        className: '',
        html: `<div style="font-weight:900;letter-spacing:.4px;font-size:14px;color:#e2e8f0;text-shadow:0 2px 6px rgba(0,0,0,.9)">${job}</div>`
      })
    }).addTo(map);

    state.areas.push({ fill, label });
  }

  if (!state.areasVisible){
    state.areas.forEach(a => { map.removeLayer(a.fill); map.removeLayer(a.label); });
  }
}
