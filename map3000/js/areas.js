// /map3000/js/areas.js — classic working job areas (default pane, {layer,label})
// Pipeline: group by job_name → concave (maxEdge 1.5km) → convex fallback
// → buffer (~60m) → simplify → draw with thicker stroke + higher fill.

function colorFromString(s){
  let h=0; for(let i=0;i<s.length;i++) h=(h*31 + s.charCodeAt(i))>>>0;
  return `hsl(${h % 360} 70% 50%)`;
}

export function init(map, state){
  // Use the default overlay pane (matches the first working single-file page)
  state.areas = []; // [{ layer: L.GeoJSON, label: L.Marker }]
}

export function rebuild(sample=null){
  const s = state;
  const list = sample || s.poles;

  // 1) Strict grouping by job_name
  const byJob = new Map();
  for (const p of list){
    const job = (p.job_name ?? '').trim();
    if (!job) continue;
    if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
    if (!byJob.has(job)) byJob.set(job, []);
    byJob.get(job).push([p.lon, p.lat]); // [lng,lat] for GeoJSON
  }

  // 2) Build hulls (concave → convex → buffer → simplify)
  const items = [];
  byJob.forEach((pts, job) => {
    if (pts.length < 3) return;

    const fc = turf.featureCollection(pts.map(c => turf.point(c)));
    let poly = null;

    try { poly = turf.concave(fc, { maxEdge: 1.5, units: 'kilometers' }); } catch(_){}
    if (!poly) { try { poly = turf.convex(fc); } catch(_){} }
    if (!poly) return;

    let buffered = poly;
    try { buffered = turf.buffer(poly, 0.06, { units: 'kilometers' }); } catch(_){}

    let simplified = buffered;
    try { simplified = turf.simplify(buffered, { tolerance: 0.0001, highQuality: true }); } catch(_){}
    try { simplified = turf.flatten(simplified); } catch(_){}

    items.push({ job, geo: simplified });
  });

  // 3) Draw (clear previous)
  clear(s.map, s);
  items.forEach(({ job, geo }) => {
    const col = colorFromString(job);

    const layer = L.geoJSON(geo, {
      // default pane
      style: {
        color: col,
        weight: 2.5,        // stronger than original 1.5
        opacity: 1.0,       // full stroke opacity
        fillColor: col,
        fillOpacity: 0.25   // higher than original 0.10
      }
    }).addTo(s.map);
    try { layer.bringToFront(); } catch(_){}

    let center;
    try { center = turf.centerOfMass(geo).geometry.coordinates; }
    catch(_){ const bb = turf.bbox(geo); center = turf.center(turf.bboxPolygon(bb)).geometry.coordinates; }

    const label = L.marker([center[1], center[0]], {
      interactive:false,
      icon: L.divIcon({
        className:'job-label',
        html:`<div style="font-weight:800; letter-spacing:.3px; font-size:14px; color:#dbeafe; text-shadow:0 2px 6px rgba(0,0,0,.6)">${job}</div>`,
        iconSize:[0,0]
      })
    }).addTo(s.map);

    s.areas.push({ layer, label });
  });

  if (!s.areasVisible){
    s.areas.forEach(a => { s.map.removeLayer(a.layer); s.map.removeLayer(a.label); });
  }
}

function clear(map, state){
  state.areas.forEach(a => { map.removeLayer(a.layer); map.removeLayer(a.label); });
  state.areas = [];
}
