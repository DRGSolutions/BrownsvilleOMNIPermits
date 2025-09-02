// /map3000/js/areas.js — reliable borders on a dedicated pane (fill + neon outline)

const PANE = 'areas-pane';
function colorFromString(s){ let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return `hsl(${h%360} 70% 52%)`; }
const safeArea = g => { try { return turf.area(g) || 0; } catch { return 0; } };

export function init(map, state){
  // dedicated pane (above tiles, below markers)
  if (!map.getPane(PANE)) map.createPane(PANE);
  const pane = map.getPane(PANE);
  pane.classList.add('areas-pane'); // matches your CSS glow rule
  pane.style.zIndex = 625;
  pane.style.pointerEvents = 'none';

  state.areas = []; // [{fill, outline, label}]
}

export function rebuild(sample=null){
  const s = state, list = sample || s.poles;

  // group strictly by job_name
  const byJob = new Map();
  for (const p of list){
    const job = p.job_name ?? '';
    if (!job) continue;
    if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
    if (!byJob.has(job)) byJob.set(job, []);
    byJob.get(job).push([p.lon, p.lat]);  // [lng,lat]
  }

  const items = [];
  byJob.forEach((pts, job) => {
    const geo = hull(pts);
    if (geo) items.push({ job, geo });
  });

  clear(s.map, s);
  drawAll(s.map, s, items);
}

function hull(pts){
  if (!pts || !pts.length) return null;

  // Try convex if ≥3 points
  let geo = null;
  if (pts.length >= 3) {
    try {
      const fc = turf.featureCollection(pts.map(c=>turf.point(c)));
      geo = turf.convex(fc);
      if (geo && safeArea(geo) < 1) geo = null;
    } catch {}
  }

  // Fallback: bbox around all points (always visible)
  if (!geo) {
    try {
      const fc = turf.featureCollection(pts.map(c=>turf.point(c)));
      const bb = turf.bboxPolygon(turf.bbox(fc));
      geo = bb;
    } catch {}
  }

  // flatten + smooth
  if (geo) {
    try { geo = turf.simplify(geo, { tolerance: 0.00005, highQuality: true }); } catch {}
    try { geo = turf.flatten(geo); } catch {}
  }
  return geo;
}

function clear(map, state){
  state.areas.forEach(a => {
    map.removeLayer(a.fill);
    if (a.outline) map.removeLayer(a.outline);
    map.removeLayer(a.label);
  });
  state.areas = [];
}

function drawAll(map, state, items){
  items.forEach(({job, geo})=>{
    const col = colorFromString(job);

    // FILL — visibly opaque
    const fill = L.geoJSON(geo, {
      pane: PANE,
      style: {
        color: col,
        weight: 0,
        opacity: 0,
        fillColor: col,
        fillOpacity: 0.45   // high on purpose
      }
    }).addTo(map);

    // OUTLINE — thick neon for contrast
    const outline = L.geoJSON(geo, {
      pane: PANE,
      style: {
        color: '#00E5FF',
        weight: 5,
        opacity: 1,
        dashArray: '',
        fillOpacity: 0
      }
    }).addTo(map);

    // LABEL in the middle
    let c;
    try { c = turf.centerOfMass(geo).geometry.coordinates; }
    catch { const bb=turf.bbox(geo); c = turf.center(turf.bboxPolygon(bb)).geometry.coordinates; }
    const label = L.marker([c[1], c[0]], {
      pane: PANE, interactive:false,
      icon: L.divIcon({ className:'', html:`<div style="font-weight:900;letter-spacing:.4px;font-size:14px;color:#e2e8f0;text-shadow:0 2px 6px rgba(0,0,0,.95)">${job}</div>` })
    }).addTo(map);

    // keep reference so the toggle can add/remove all three
    state.areas.push({ fill, outline, label });
  });

  // respect toggle
  if (!state.areasVisible){
    state.areas.forEach(a => {
      map.removeLayer(a.fill);
      if (a.outline) map.removeLayer(a.outline);
      map.removeLayer(a.label);
    });
  }
}
