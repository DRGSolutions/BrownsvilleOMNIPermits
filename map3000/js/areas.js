// /map3000/js/areas.js — boundaries: bold & undeniable
import { poleKey } from './config.js';

const PANE_NAME = 'areas-pane';

export function init(map, state){
  // Dedicated pane with high z-index (tiles ~200, overlay ~400, markers ~600)
  map.createPane(PANE_NAME);
  const pane = map.getPane(PANE_NAME);
  pane.classList.add('areas-pane');
  pane.style.zIndex = 625;              // sits under markers, over overlays
  pane.style.pointerEvents = 'none';    // never block clicks on markers

  state.areas = [];
}

function colorFromString(s){ let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return `hsl(${h%360} 70% 52%)`; }

// Create a tight hull; if concave fails or points are sparse, fallback to convex;
// if both fail or <3 points, synthesize a buffered hull so you still see a boundary.
function hullForPoints(pts){
  if(!pts || pts.length === 0) return null;
  if(pts.length === 1){
    // single point → small circle (~30m)
    return turf.buffer(turf.point(pts[0]), 0.03, { units: 'kilometers' });
  }
  if(pts.length === 2){
    // two points → buffer their midpoint line (~30m)
    const line = turf.lineString(pts);
    return turf.buffer(line, 0.03, { units: 'kilometers' });
  }
  const fc = turf.featureCollection(pts.map(c=>turf.point(c)));
  let poly = turf.concave(fc, { maxEdge: 0.5, units: 'kilometers' });
  if(!poly) poly = turf.convex(fc);
  if(!poly){
    // wildly scattered → very light buffer around all points
    const u = turf.union(...pts.map(c=>turf.buffer(turf.point(c), 0.02, {units:'kilometers'})));
    poly = u || null;
  }
  if(!poly) return null;
  // Smooth but keep shape — tiny tolerance, then ensure Polygon/MultiPolygon only
  const simplified = turf.simplify(poly,{tolerance:0.00004,highQuality:true});
  const flattened = turf.flatten(simplified || poly);  // handles GeometryCollection
  return flattened;
}

// clip earlier/larger areas out of later ones to avoid overlap “violations”
function clipOverlaps(jobPolys){
  // sort by area (desc) so big keeps shape, smalls are clipped
  const entries = [...jobPolys.entries()]
    .map(([job,geo])=>[job, geo, turf.area(geo)])
    .sort((a,b)=>b[2]-a[2]);

  const out = [];
  for(let i=0;i<entries.length;i++){
    const [job, geo] = entries[i];

    // turf.flatten returns FeatureCollection; iterate features
    const feats = geo.type === 'FeatureCollection' ? geo.features : [geo];
    let current = feats;

    for(let j=0;j<i;j++){
      const other = out[j].geo;

      current = current.map(f=>{
        try{
          const inter = turf.intersect(f, other);
          if(!inter) return f;
          // ignore microscopic overlaps
          if(turf.area(inter) < 20) return f;
          const diff = turf.difference(f, other);
          return diff || f;
        }catch(e){ return f; }
      }).flatMap(f=> (f?.type === 'GeometryCollection')
        ? turf.flatten(f).features
        : [f]);
    }

    // recompose
    const fc = turf.featureCollection(current.filter(Boolean));
    // if everything got clipped away, keep original to *ensure visible*
    out.push({ job, geo: (fc.features.length ? fc : geo) });
  }
  return out;
}

function draw(map, state, clipped){
  // clear old
  state.areas.forEach(a=>{ map.removeLayer(a.fill); map.removeLayer(a.label); });
  state.areas = [];

  clipped.forEach(({job, geo})=>{
    const col = colorFromString(job);

    const layer = L.geoJSON(geo, {
      pane: PANE_NAME,
      style: {
        color: col,
        weight: 3,                 // thicker edge
        opacity: 0.95,             // bright line
        fillColor: col,
        fillOpacity: 0.38          // clearly visible on dark tiles
      }
    }).addTo(map);

    // Bring above any other overlays on the same pane
    try { layer.bringToFront(); } catch(e){}

    // center label
    let center;
    try { center = turf.centerOfMass(geo).geometry.coordinates; }
    catch(e){ center = turf.center(turf.bboxPolygon(turf.bbox(geo))).geometry.coordinates; }

    const label = L.marker([center[1], center[0]], {
      pane: PANE_NAME, interactive:false,
      icon: L.divIcon({
        className: '',
        html: `<div style="font-weight:900;letter-spacing:.4px;font-size:14px;color:#e2e8f0;text-shadow:0 2px 6px rgba(0,0,0,.85)">
                 ${job}
               </div>`
      })
    }).addTo(map);

    state.areas.push({ fill: layer, label });
  });

  if(!state.areasVisible){
    state.areas.forEach(a=>{ map.removeLayer(a.fill); map.removeLayer(a.label); });
  }
}

export function rebuild(sample=null){
  const s = state, list = sample || s.poles;

  // group points by job (GeoJSON wants [lng,lat])
  const byJob = new Map();
  for(const p of list){
    const job = String(p.job_name||'').trim();
    if(!job || typeof p.lat!=='number' || typeof p.lon!=='number') continue;
    if(!byJob.has(job)) byJob.set(job, []);
    byJob.get(job).push([p.lon, p.lat]);
  }

  // build hulls
  const raw = new Map();
  byJob.forEach((pts, job)=>{
    const hull = hullForPoints(pts);
    if(hull) raw.set(job, hull);
  });

  if(raw.size === 0){
    // nothing to draw; silently return (avoids console noise)
    return;
  }

  const clipped = clipOverlaps(raw);
  draw(s.map, s, clipped);
}
