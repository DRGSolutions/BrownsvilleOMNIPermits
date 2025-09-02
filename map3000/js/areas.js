// /map3000/js/areas.js — back-to-basics + bulletproof + debugable

const PANE_NAME = "areas-pane";
const DEBUG = /[?&]areas_debug=1\b/.test(location.search || "");

// lightweight color hash (stable per job)
function colorFromString(s){ let h=0; for(let i=0;i<s.length;i++) h=(h*31 + s.charCodeAt(i))>>>0; return `hsl(${h%360} 70% 52%)`; }
const safeArea = g => { try { return turf.area(g) || 0; } catch { return 0; } };
const toFeatures = g =>
  g?.type === "FeatureCollection" ? g.features :
  g?.type === "GeometryCollection" ? turf.flatten(g).features :
  g ? [g] : [];

export function init(map, state){
  // Dedicated pane above overlays, below markers
  map.createPane(PANE_NAME);
  const pane = map.getPane(PANE_NAME);
  pane.classList.add("areas-pane");
  pane.style.zIndex = 625;           // markers ~600; keep just above overlays
  pane.style.pointerEvents = "none"; // never block marker clicks

  state.areas = []; // [{fill, label, debugFG?}]
}

export function rebuild(sample=null){
  const s = state;
  const list = sample || s.poles;

  // 1) Group strictly by job_name (original behavior)
  const byJob = new Map();
  for(const p of list){
    const job = (p.job_name ?? "");
    if(!job) continue;
    if(typeof p.lat !== "number" || typeof p.lon !== "number") continue;
    if(!byJob.has(job)) byJob.set(job, []);
    byJob.get(job).push([p.lon, p.lat]); // GeoJSON order: [lng, lat]
  }

  console.info("[areas] jobs found:", byJob.size);

  // 2) Build hull per job with robust fallbacks
  const toDraw = [];
  byJob.forEach((pts, job) => {
    const hull = buildHull(pts, job);
    if(hull) toDraw.push({ job, geo: hull, pts });
  });

  // 3) Render
  clearLayers(s.map, s);
  drawAll(s.map, s, toDraw);
}

function buildHull(ptsLngLat, job){
  if(!ptsLngLat || ptsLngLat.length === 0) return null;

  let chosen = "none";
  let geo = null;

  // ORIGINAL rule: need at least 3 points for hulls
  if(ptsLngLat.length >= 3){
    const fc = turf.featureCollection(ptsLngLat.map(c => turf.point(c)));
    try {
      geo = turf.concave(fc, { maxEdge: 0.6, units: "kilometers" }); // tighter but safe
      if(geo){ chosen = "concave"; }
    } catch {}

    if(!geo){
      try { geo = turf.convex(fc); if(geo) chosen = "convex"; } catch {}
    }

    // If hull is crazy small/invalid, fall through to buffer/union/bbox
    if(geo && safeArea(geo) < 1) { geo = null; chosen = "none"; }
  }

  // Fallback 1: buffered union of points (visually obvious blob)
  if(!geo){
    try {
      const rings = ptsLngLat.map(c => turf.buffer(turf.point(c), 0.03, { units: "kilometers" }));
      geo = rings.length === 1 ? rings[0] : turf.union(...rings);
      if(geo) chosen = "buffer-union";
    } catch {}
  }

  // Fallback 2: bbox polygon around all points (last resort, always visible)
  if(!geo){
    try {
      const fcPts = turf.featureCollection(ptsLngLat.map(c => turf.point(c)));
      const bb = turf.bbox(fcPts);
      geo = turf.bboxPolygon(bb);
      chosen = "bbox";
    } catch {}
  }

  // Smooth & flatten for Leaflet
  if(geo){
    try { geo = turf.simplify(geo, { tolerance: 0.00005, highQuality: true }); } catch {}
    try { geo = turf.flatten(geo); } catch {}
  }

  const a = safeArea(geo);
  console.info(`[areas] ${job}: points=${ptsLngLat.length}, hull=${chosen}, area=${a.toFixed(1)} m²`);
  return geo;
}

function clearLayers(map, state){
  state.areas.forEach(a => {
    map.removeLayer(a.fill);
    map.removeLayer(a.label);
    if(a.debugFG) map.removeLayer(a.debugFG);
  });
  state.areas = [];
}

function drawAll(map, state, items){
  for(const {job, geo, pts} of items){
    const col = colorFromString(job);

    // Main filled border
    const fill = L.geoJSON(geo, {
      pane: PANE_NAME,
      style: {
        color: col,
        weight: 3.2,       // brighter edge
        opacity: 0.98,
        fillColor: col,
        fillOpacity: 0.40  // HIGH so you can’t miss it
      }
    }).addTo(map);
    try { fill.bringToFront(); } catch {}

    // Label at center of mass (fallback bbox center)
    let center;
    try { center = turf.centerOfMass(geo).geometry.coordinates; }
    catch {
      const bb = turf.bbox(geo);
      center = turf.center(turf.bboxPolygon(bb)).geometry.coordinates;
    }
    const label = L.marker([center[1], center[0]], {
      pane: PANE_NAME, interactive:false,
      icon: L.divIcon({
        className: "",
        html: `<div style="font-weight:900;letter-spacing:.4px;font-size:14px;color:#e2e8f0;text-shadow:0 2px 6px rgba(0,0,0,.95)">${job}</div>`
      })
    }).addTo(map);

    // Optional DEBUG overlays (raw points + bbox outline)
    let debugFG = null;
    if(DEBUG){
      const fcPts = turf.featureCollection(pts.map(c => turf.point(c)));
      const bb = turf.bboxPolygon(turf.bbox(fcPts));
      debugFG = L.featureGroup([], { pane: PANE_NAME }).addTo(map);
      // raw points
      pts.forEach(([lng,lat])=>{
        L.circleMarker([lat,lng], {
          pane: PANE_NAME, radius: 3, color: "#60a5fa", fillColor:"#60a5fa", fillOpacity: 0.9, weight: 1
        }).addTo(debugFG);
      });
      // bbox outline
      L.geoJSON(bb, {
        pane: PANE_NAME,
        style: { color: "#eab308", weight: 2, dashArray: "6,4", fillOpacity: 0 }
      }).addTo(debugFG);
    }

    state.areas.push({ fill, label, debugFG });
  }

  if(!state.areasVisible){
    state.areas.forEach(a => { map.removeLayer(a.fill); map.removeLayer(a.label); if(a.debugFG) map.removeLayer(a.debugFG); });
  }
}
