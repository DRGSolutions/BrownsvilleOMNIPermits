// /map3000/js/areas.js — classic working logic, modularized
// Behavior: group strictly by job_name -> concave hull (maxEdge 1.5 km) -> convex fallback
// -> light buffer (≈60m) -> simplify -> draw. Visibility boosted (thicker outline, higher fill).

const PANE = 'areas-pane';

function colorFromString(s){
  let h=0; for(let i=0;i<s.length;i++) h=(h*31 + s.charCodeAt(i))>>>0;
  return `hsl(${h % 360} 70% 50%)`;
}

export function init(map, state){
  // Dedicated pane so areas sit above tiles and below markers
  if (!map.getPane(PANE)) map.createPane(PANE);
  const pane = map.getPane(PANE);
  pane.classList.add('areas-pane');     // your CSS glow targets this class
  pane.style.zIndex = 625;              // markers are usually above this
  pane.style.pointerEvents = 'none';    // never block marker clicks

  state.areas = []; // [{fill:L.GeoJSON, label:L.Marker}]
}

export function rebuild(sample=null){
  const s = state;
  const list = sample || s.poles;

  // 1) group strictly by job_name (matches the original)
  const byJob = new Map();
  for (const p of list){
    const job = (p.job_name ?? '').trim();
    if (!job) continue;
    if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
    if (!byJob.has(job)) byJob.set(job, []);
    byJob.get(job).push([p.lon, p.lat]); // GeoJSON order: [lng, lat]
  }

  // 2) build the same “working” hull you had originally
  const items = [];
  byJob.forEach((pts, job) => {
    if (pts.length < 3) return; // original behavior: skip tiny sets

    const fc = turf.featureCollection(pts.map(c => turf.point(c)));
    // concave first, like before
    let poly = null;
    try { poly = turf.concave(fc, { maxEdge: 1.5, units: 'kilometers' }); } catch(_){}
    if (!poly) {
      try { poly = turf.convex(fc); } catch(_){}
    }
    if (!poly) return;

    // the same “soften/smooth” chain you used: small buffer, then simplify
    let buffered = poly;
    try { buffered = turf.buffer(poly, 0.06, { units: 'kilometers' }); } catch(_){}
    let simplified = buffered;
    try { simplified = turf.simplify(buffered, { tolerance: 0.0001, highQuality: true }); } catch(_){}
    try { simplified = turf.flatten(simplified); } catch(_){}

    items.push({ job, geo: simplified });
  });

  // 3) render (clear old first)
  clear(s.map, s);
  drawAll(s.map, s, items);
}

function clear(map, state){
  state.areas.forEach(a => {
    map.removeLayer(a.fill);
    map.removeLayer(a.label);
  });
  state.areas = [];
}

function drawAll(map, state, items){
  items.forEach(({ job, geo }) => {
    const col = colorFromString(job);

    // Fill + outline in one GeoJSON layer (matching original, but boosted)
    const fill = L.geoJSON(geo, {
      pane: PANE,
      style: {
        color: col,         // stroke
        weight: 2.5,        // thicker than original 1.5 so it’s obvious
        opacity: 1.0,       // full stroke opacity so edges pop
        fillColor: col,
        fillOpacity: 0.25   // higher than original 0.10 for clear visibility
      }
    }).addTo(map);

    // ensure it sits above other overlays
    try { fill.bringToFront(); } catch(_){}

    // label at mass center, falling back to bbox center
    let center;
    try { center = turf.centerOfMass(geo).geometry.coordinates; }
    catch(_){
      const bb = turf.bbox(geo);
      center = turf.center(turf.bboxPolygon(bb)).geometry.coordinates;
    }

    const label = L.marker([center[1], center[0]], {
      pane: PANE, interactive: false,
      icon: L.divIcon({
        className: 'job-label',
        html: `<div style="font-weight:800; letter-spacing:.3px; font-size:14px; color:#dbeafe; text-shadow:0 2px 6px rgba(0,0,0,.6)">${job}</div>`,
        iconSize: [0,0]
      })
    }).addTo(map);

    state.areas.push({ fill, label });
  });

  // honor current toggle
  if (!state.areasVisible){
    state.areas.forEach(a => { state.map.removeLayer(a.fill); state.map.removeLayer(a.label); });
  }
}
