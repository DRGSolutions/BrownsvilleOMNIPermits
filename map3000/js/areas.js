// /map3000/js/areas.js — guaranteed visible borders via L.polygon (no GeoJSON rendering surprises)

function colorFromString(s){ let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return `hsl(${h%360} 70% 52%)`; }
const safeArea = g => { try { return turf.area(g) || 0; } catch { return 0; } };

// Convert a GeoJSON Polygon/MultiPolygon into an array of rings in Leaflet [lat,lng] format
function toLatLngRings(geo){
  try{
    const feats = (geo?.type === 'FeatureCollection') ? geo.features
               : (geo?.type === 'GeometryCollection') ? turf.flatten(geo).features
               : [geo];
    const rings = [];
    feats.forEach(f=>{
      if(!f || !f.geometry) return;
      if(f.geometry.type === 'Polygon'){
        f.geometry.coordinates.forEach(ring=>{
          rings.push(ring.map(([lng,lat])=>[lat,lng]));
        });
      }else if(f.geometry.type === 'MultiPolygon'){
        f.geometry.coordinates.forEach(poly=>{
          poly.forEach(ring=>{
            rings.push(ring.map(([lng,lat])=>[lat,lng]));
          });
        });
      }
    });
    return rings;
  }catch(e){ return []; }
}

export function init(map, state){
  state.areas = [];   // [{fill, outline, label}]
  // Add a tiny debug button to verify vectors render at all
  const tools = document.getElementById('tools');
  if(tools && !document.getElementById('btnGlobalBox')){
    const row = document.createElement('div');
    row.className = 'row'; row.style.marginTop='6px';
    row.innerHTML = `<button id="btnGlobalBox" class="btn">Test Global Box</button>`;
    tools.appendChild(row);
    document.getElementById('btnGlobalBox').onclick = ()=> drawGlobalTestBox(map, state);
  }
}

export function rebuild(sample=null){
  const s = state;
  const list = sample || s.poles;

  // group strictly by job_name
  const byJob = new Map();
  for(const p of list){
    const job = p.job_name ?? '';
    if(!job) continue;
    if(typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
    if(!byJob.has(job)) byJob.set(job, []);
    byJob.get(job).push([p.lon, p.lat]); // [lng,lat]
  }

  // make a simple hull per job
  const items = [];
  byJob.forEach((pts, job)=>{
    const geo = buildHullBasic(pts, job);
    if(geo) items.push({job, geo});
  });

  // draw
  clear(state.map, s);
  drawAll(state.map, s, items);
}

function buildHullBasic(ptsLngLat, job){
  if(!ptsLngLat || ptsLngLat.length === 0) return null;

  let geo = null, picked = 'none';
  // try concave if 3+ points
  if(ptsLngLat.length >= 3){
    try{
      const fc = turf.featureCollection(ptsLngLat.map(c=>turf.point(c)));
      geo = turf.concave(fc, { maxEdge: 0.6, units: 'kilometers' });
      if(geo && safeArea(geo) >= 1) picked='concave'; else geo=null;
    }catch{}
    // fallback convex
    if(!geo){
      try{
        const fc = turf.featureCollection(ptsLngLat.map(c=>turf.point(c)));
        geo = turf.convex(fc);
        if(geo && safeArea(geo) >= 1) picked='convex'; else geo=null;
      }catch{}
    }
  }
  // fallback bbox
  if(!geo){
    try{
      const fc = turf.featureCollection(ptsLngLat.map(c=>turf.point(c)));
      const bb = turf.bbox(fc);
      geo = turf.bboxPolygon(bb);
      picked='bbox';
    }catch{}
  }

  // light simplify + flatten
  if(geo){
    try{ geo = turf.simplify(geo, { tolerance: 0.00005, highQuality: true }); }catch{}
    try{ geo = turf.flatten(geo); }catch{}
  }

  console.info(`[areas] ${job}: pts=${ptsLngLat.length}, hull=${picked}, area=${safeArea(geo).toFixed(1)} m²`);
  return geo;
}

function clear(map, state){
  state.areas.forEach(a=>{
    map.removeLayer(a.fill);
    map.removeLayer(a.outline);
    map.removeLayer(a.label);
  });
  state.areas = [];
  if(state.__globalBox){ map.removeLayer(state.__globalBox); state.__globalBox=null; }
}

function drawAll(map, state, items){
  items.forEach(({job, geo})=>{
    const rings = toLatLngRings(geo);
    if(!rings.length) return;

    // FILL (very visible)
    const fill = L.polygon(rings, {
      color: colorFromString(job),
      weight: 0,
      fillColor: colorFromString(job),
      fillOpacity: 0.50   // deliberately high so you SEE it
    }).addTo(map);

    // OUTLINE (thick neon cyan for contrast)
    const outline = L.polygon(rings, {
      color: '#00E5FF',
      weight: 5,
      opacity: 1.0,
      fillOpacity: 0
    }).addTo(map);

    // LABEL
    let center;
    try { center = turf.centerOfMass(geo).geometry.coordinates; }
    catch {
      const bb = turf.bbox(geo);
      center = turf.center(turf.bboxPolygon(bb)).geometry.coordinates;
    }
    const label = L.marker([center[1], center[0]], {
      interactive:false,
      icon: L.divIcon({
        className:'',
        html:`<div style="font-weight:900;letter-spacing:.4px;font-size:14px;color:#e2e8f0;text-shadow:0 2px 6px rgba(0,0,0,.95)">${job}</div>`
      })
    }).addTo(map);

    state.areas.push({fill, outline, label});
  });

  if(!state.areasVisible){
    state.areas.forEach(a=>{
      map.removeLayer(a.fill);
      map.removeLayer(a.outline);
      map.removeLayer(a.label);
    });
  }
}

// Debug helper: draw a big magenta bbox covering ALL poles to verify polygons render
function drawGlobalTestBox(map, state){
  if(state.__globalBox){ map.removeLayer(state.__globalBox); state.__globalBox=null; return; }
  try{
    const pts = (state.poles||[]).filter(p=>typeof p.lat==='number'&&typeof p.lon==='number').map(p=>turf.point([p.lon,p.lat]));
    if(!pts.length){ alert('No poles loaded.'); return; }
    const bb = turf.bboxPolygon(turf.bbox(turf.featureCollection(pts)));
    const rings = toLatLngRings(bb);
    state.__globalBox = L.polygon(rings, { color:'#FF39D1', weight:6, opacity:1, fillColor:'#FF39D1', fillOpacity:.15 }).addTo(map);
  }catch(e){
    console.error('global test box error', e);
  }
}
