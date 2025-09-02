// /map3000/js/areas.js — FORCE-VISIBLE BORDERS (neon outline + semi-opaque fill)

const PANE = 'areas-pane';

// loud, impossible-to-miss defaults
const OUTLINE_COLOR = '#00FFFF';   // neon cyan
const OUTLINE_WEIGHT = 6;
const FILL_COLOR    = '#FF39D1';   // neon magenta
const FILL_OPACITY  = 0.55;        // deliberately high

function colorFromString(s){ let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return `hsl(${h%360} 70% 52%)`; }
const safeArea = g => { try { return turf.area(g) || 0; } catch { return 0; } };

// Convert a GeoJSON Polygon/MultiPolygon to Leaflet [lat,lng] rings
function toLatLngRings(geo){
  try{
    const feats = (geo?.type === 'FeatureCollection') ? geo.features
               : (geo?.type === 'GeometryCollection') ? turf.flatten(geo).features
               : [geo];
    const rings = [];
    feats.forEach(f=>{
      if(!f || !f.geometry) return;
      if(f.geometry.type === 'Polygon'){
        f.geometry.coordinates.forEach(ring => rings.push(ring.map(([lng,lat])=>[lat,lng])));
      }else if(f.geometry.type === 'MultiPolygon'){
        f.geometry.coordinates.forEach(poly => poly.forEach(
          ring => rings.push(ring.map(([lng,lat])=>[lat,lng]))
        ));
      }
    });
    return rings;
  }catch{ return []; }
}

export function init(map, state){
  // Dedicated pane above tiles, below markers; CSS targets this pane too
  if (!map.getPane(PANE)) map.createPane(PANE);
  const pane = map.getPane(PANE);
  pane.classList.add('areas-pane');
  pane.style.zIndex = 625;
  pane.style.pointerEvents = 'none';

  state.areas = []; // [{fill, outline, label}]
}

export function rebuild(sample=null){
  const s = state;
  const list = sample || s.poles;

  const byJob = new Map();
  for(const p of list){
    const job = p.job_name ?? '';
    if(!job) continue;
    if(typeof p.lat!=='number' || typeof p.lon!=='number') continue;
    if(!byJob.has(job)) byJob.set(job, []);
    byJob.get(job).push([p.lon, p.lat]); // [lng,lat]
  }

  const items = [];
  byJob.forEach((pts, job)=>{
    const geo = buildHull(pts);
    if(geo) items.push({ job, geo });
  });

  clear(s.map, s);
  drawAll(s.map, s, items);

  // draw a one-time debug polygon so we can visually confirm the pane renders
  if (!state.__areasDebugInit) {
    state.__areasDebugInit = true;
    try {
      const pts = (s.poles||[]).slice(0,20).map(p=>[p.lat,p.lon]).filter(([la,lo])=>Number.isFinite(la)&&Number.isFinite(lo));
      if (pts.length >= 3) {
        const tri = [pts[0], pts[1], pts[2]];
        const dbg = L.polygon(tri, {
          pane: PANE, color:'#FFFF00', weight: 4, opacity: 1, fillColor:'#FFFF00', fillOpacity:.2
        }).addTo(s.map);
        setTimeout(()=> s.map.removeLayer(dbg), 2500);
      }
    } catch {}
  }
}

function buildHull(pts){
  if(!pts || !pts.length) return null;

  let geo = null;

  if(pts.length >= 3){
    try{
      const fc = turf.featureCollection(pts.map(c=>turf.point(c)));
      geo = turf.convex(fc);
      if(geo && safeArea(geo) < 1) geo = null;
    }catch{}
  }

  // bbox fallback (always visible)
  if(!geo){
    try{
      const fc = turf.featureCollection(pts.map(c=>turf.point(c)));
      const bb = turf.bboxPolygon(turf.bbox(fc));
      geo = bb;
    }catch{}
  }

  if(geo){
    try{ geo = turf.simplify(geo, { tolerance: 0.00005, highQuality: true }); }catch{}
    try{ geo = turf.flatten(geo); }catch{}
  }
  return geo;
}

function clear(map, state){
  state.areas.forEach(a=>{
    map.removeLayer(a.fill);
    if(a.outline) map.removeLayer(a.outline);
    map.removeLayer(a.label);
  });
  state.areas = [];
}

function drawAll(map, state, items){
  items.forEach(({job, geo})=>{
    const rings = toLatLngRings(geo);
    if(!rings.length) return;

    // Fill (high opacity, fixed neon color to remove any palette/opacity doubts)
    const fill = L.polygon(rings, {
      pane: PANE,
      color: FILL_COLOR,
      weight: 0,
      opacity: 0,
      fillColor: FILL_COLOR,
      fillOpacity: FILL_OPACITY
    }).addTo(map);

    // Outline (thick neon cyan, always on top)
    const outline = L.polygon(rings, {
      pane: PANE,
      color: OUTLINE_COLOR,
      weight: OUTLINE_WEIGHT,
      opacity: 1,
      fillOpacity: 0
    }).addTo(map);

    try { outline.bringToFront(); fill.bringToFront(); } catch {}

    // Label
    let c;
    try { c = turf.centerOfMass(geo).geometry.coordinates; }
    catch { const bb = turf.bbox(geo); c = turf.center(turf.bboxPolygon(bb)).geometry.coordinates; }
    const label = L.marker([c[1], c[0]], {
      pane: PANE, interactive:false,
      icon: L.divIcon({
        className:'',
        html:`<div style="font-weight:900;letter-spacing:.4px;font-size:14px;color:#e2e8f0;text-shadow:0 2px 6px rgba(0,0,0,.95)">${job}</div>`
      })
    }).addTo(map);

    state.areas.push({ fill, outline, label });
  });

  if(!state.areasVisible){
    state.areas.forEach(a=>{
      state.map.removeLayer(a.fill);
      if(a.outline) state.map.removeLayer(a.outline);
      state.map.removeLayer(a.label);
    });
  }
}
