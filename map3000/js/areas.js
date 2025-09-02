// /map3000/js/areas.js — back to basics (original grouping) + clearer styling

const PANE_NAME = 'areas-pane';

export function init(map, state){
  // Create a dedicated pane so areas sit above tiles and below markers
  map.createPane(PANE_NAME);
  const pane = map.getPane(PANE_NAME);
  pane.classList.add('areas-pane');
  pane.style.zIndex = 625;            // markers are typically > 650
  pane.style.pointerEvents = 'none';  // do not block clicks on markers

  state.areas = [];                   // [{ fill: L.GeoJSON, label: L.Marker }]
}

/**
 * Build a single polygon for a set of points:
 * - Try concave (tighter) hull
 * - Fallback to convex hull
 * - Light simplify so edges look clean
 */
function buildHull(pointsLngLat){
  if (!pointsLngLat || pointsLngLat.length < 3) return null; // ORIGINAL behavior

  const fc = turf.featureCollection(pointsLngLat.map(c => turf.point(c)));

  // Original-ish settings: slightly generous maxEdge so shapes don't overfit
  let poly = null;
  try { poly = turf.concave(fc, { maxEdge: 0.6, units: 'kilometers' }); } catch (_){}
  if (!poly) {
    try { poly = turf.convex(fc); } catch (_){}
  }
  if (!poly) return null;

  // Small simplify for smooth edges (keeps shape close to original)
  try { poly = turf.simplify(poly, { tolerance: 0.00005, highQuality: true }); } catch (_){}

  // Ensure Leaflet gets a simple Polygon/MultiPolygon
  try { poly = turf.flatten(poly); } catch (_){}

  return poly;
}

/**
 * Draw all job areas (no inter-job clipping).
 * Grouping is strictly by p.job_name with no normalization (ORIGINAL).
 */
export function rebuild(sample=null){
  const s = state;
  const list = sample || s.poles;

  // 1) Group strictly by job_name (no case/space normalization — ORIGINAL)
  const byJob = new Map();
  for (const p of list){
    const job = (p.job_name ?? '');
    if (!job) continue;
    if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;

    if (!byJob.has(job)) byJob.set(job, []);
    byJob.get(job).push([p.lon, p.lat]); // GeoJSON order: [lng, lat]
  }

  // 2) Build one hull per job
  const toDraw = [];
  byJob.forEach((pts, job) => {
    const hull = buildHull(pts);
    if (hull) toDraw.push({ job, geo: hull });
  });

  // 3) Render (clear old first)
  clearLayers(s.map, s);
  draw(s.map, s, toDraw);
}

function clearLayers(map, state){
  state.areas.forEach(a => { map.removeLayer(a.fill); map.removeLayer(a.label); });
  state.areas = [];
}

function colorFromString(s){
  let h=0; for(let i=0;i<s.length;i++) h=(h*31 + s.charCodeAt(i))>>>0;
  return `hsl(${h%360} 70% 52%)`;
}

function draw(map, state, list){
  for (const {job, geo} of list){
    const col = colorFromString(job);

    // Slightly bolder so it’s unmistakable on dark tiles
    const fill = L.geoJSON(geo, {
      pane: PANE_NAME,
      style: {
        color: col,
        weight: 3,          // thicker edge for visibility
        opacity: 0.95,      // bright stroke
        fillColor: col,
        fillOpacity: 0.34   // higher fill so it reads clearly
      }
    }).addTo(map);

    try { fill.bringToFront(); } catch (_){}

    // Center label at mass center; fallback to bbox center
    let center;
    try {
      center = turf.centerOfMass(geo).geometry.coordinates;
    } catch (_){
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
