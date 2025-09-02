// /map3000/js/areas.js — force-visible job borders (overlayPane, outline+fill, convex+bbox)

const USE_DEBUG_TEST = true; // set false to hide the UI button (kept on for now)

function colorFromString(s){ let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return `hsl(${h%360} 70% 52%)`; }
const safeArea = g => { try { return turf.area(g) || 0; } catch { return 0; } };
const toFeatures = g =>
  g?.type === "FeatureCollection" ? g.features :
  g?.type === "GeometryCollection" ? turf.flatten(g).features :
  g ? [g] : [];

// We’ll use the default overlayPane to avoid any pane/CSS surprises.
const PANE = "overlayPane";

export function init(map, state){
  state.areas = [];        // [{ fill, outline, label, debug }]
  state._areasDebug = null;

  // Optional debug button in the Tools panel
  if (USE_DEBUG_TEST) {
    const tools = document.getElementById("tools");
    if (tools && !document.getElementById("btnTestBoxes")) {
      const row = document.createElement("div");
      row.className = "row";
      row.style.marginTop = "6px";
      row.innerHTML = `<button id="btnTestBoxes" class="btn">SHOW TEST BOXES</button>`;
      tools.appendChild(row);
      document.getElementById("btnTestBoxes").onclick = () => drawTestBoxes(map, state);
    }
  }
}

export function rebuild(sample=null){
  const s = state;
  const list = sample || s.poles;

  // group strictly by job_name
  const byJob = new Map();
  for (const p of list){
    const job = p.job_name ?? "";
    if (!job) continue;
    if (typeof p.lat !== "number" || typeof p.lon !== "number") continue;
    if (!byJob.has(job)) byJob.set(job, []);
    byJob.get(job).push([p.lon, p.lat]);    // [lng,lat]
  }

  // make geometries (convex -> bbox fallback)
  const items = [];
  byJob.forEach((pts, job) => {
    const geo = buildConvexOrBBox(pts);
    if (geo) items.push({ job, geo, pts });
  });

  // draw
  clear(map, s);
  drawAll(map, s, items);
}

function buildConvexOrBBox(ptsLngLat){
  if (!ptsLngLat || ptsLngLat.length === 0) return null;

  let geo = null;

  if (ptsLngLat.length >= 3) {
    try {
      const fc = turf.featureCollection(ptsLngLat.map(c=>turf.point(c)));
      geo = turf.convex(fc);
      if (geo && safeArea(geo) < 1) geo = null;
    } catch {}
  }
  if (!geo) {
    try {
      const fcPts = turf.featureCollection(ptsLngLat.map(c=>turf.point(c)));
      const bb = turf.bbox(fcPts);
      geo = turf.bboxPolygon(bb);
    } catch {}
  }

  // flatten and lightly simplify
  if (geo) {
    try { geo = turf.simplify(geo, { tolerance: 0.00005, highQuality: true }); } catch {}
    try { geo = turf.flatten(geo); } catch {}
  }

  return geo;
}

function clear(map, state){
  state.areas.forEach(a=>{
    map.removeLayer(a.fill);
    map.removeLayer(a.outline);
    map.removeLayer(a.label);
    if(a.debug) map.removeLayer(a.debug);
  });
  state.areas = [];
  if (state._areasDebug) { map.removeLayer(state._areasDebug); state._areasDebug = null; }
}

function drawAll(map, state, items){
  for (const {job, geo, pts} of items){
    const col = colorFromString(job);

    // 1) semi-opaque FILL (very visible)
    const fill = L.geoJSON(geo, {
      pane: PANE,
      style: {
        fill: true,
        fillColor: col,
        fillOpacity: 0.55,     // HIGH ON PURPOSE
        color: col,
        weight: 0,
        opacity: 0
      }
    }).addTo(map);

    // 2) thick OUTLINE (always visible)
    const outline = L.geoJSON(geo, {
      pane: PANE,
      style: {
        color: "#00E5FF",      // neon cyan outline for maximum contrast
        weight: 4.5,
        opacity: 1.0,
        dashArray: "",         // solid; make "6,3" if you prefer dashed
        fillOpacity: 0
      }
    }).addTo(map);

    // 3) label in center
    let center;
    try { center = turf.centerOfMass(geo).geometry.coordinates; }
    catch {
      const bb = turf.bbox(geo);
      center = turf.center(turf.bboxPolygon(bb)).geometry.coordinates;
    }
    const label = L.marker([center[1], center[0]], {
      pane: PANE, interactive:false,
      icon: L.divIcon({
        className: "",
        html: `<div style="font-weight:900;letter-spacing:.4px;font-size:14px;color:#e2e8f0;text-shadow:0 2px 6px rgba(0,0,0,.95)">${job}</div>`
      })
    }).addTo(map);

    // push
    state.areas.push({ fill, outline, label });
  }

  // Hide if toggled off
  if (!state.areasVisible){
    state.areas.forEach(a=>{
      map.removeLayer(a.fill);
      map.removeLayer(a.outline);
      map.removeLayer(a.label);
    });
  }
}

// ===== Debug helpers =====
function drawTestBoxes(map, state){
  if (state._areasDebug) { map.removeLayer(state._areasDebug); state._areasDebug = null; return; }

  const fg = L.featureGroup([], { pane: PANE }).addTo(map);
  const poles = state.poles || [];
  if (!poles.length) return;

  // global bbox of all poles (magenta)
  try {
    const fc = turf.featureCollection(poles.map(p=>turf.point([p.lon, p.lat])));
    const bb = turf.bboxPolygon(turf.bbox(fc));
    L.geoJSON(bb, { pane:PANE, style:{ color:"#FF39D1", weight:4, dashArray:"8,4", fillOpacity:0.1 } }).addTo(fg);
  } catch {}

  // for each job’s bbox (yellow)
  const byJob = new Map();
  for (const p of poles){
    const j = p.job_name || "";
    if (!j || typeof p.lat!=="number" || typeof p.lon!=="number") continue;
    if (!byJob.has(j)) byJob.set(j, []);
    byJob.get(j).push([p.lon, p.lat]);
  }
  byJob.forEach((pts, job)=>{
    try {
      const fc = turf.featureCollection(pts.map(c=>turf.point(c)));
      const bb = turf.bboxPolygon(turf.bbox(fc));
      L.geoJSON(bb, { pane:PANE, style:{ color:"#eab308", weight:3, dashArray:"6,3", fillOpacity:0 } })
        .bindTooltip(job, {permanent:false})
        .addTo(fg);
    } catch {}
  });

  state._areasDebug = fg;
}
