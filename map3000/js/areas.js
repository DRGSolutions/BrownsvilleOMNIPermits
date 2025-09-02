import { poleKey } from './config.js';

let paneName = 'areas-pane';

export function init(map, state){
  // create dedicated pane above tiles, below markers
  map.createPane(paneName);
  map.getPane(paneName).classList.add('areas-pane');
  state.areas = [];
}

function colorFromString(s){ let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return `hsl(${h%360} 70% 50%)`; }

function buildRaw(byJob, strict=4){
  const raw=new Map();
  const maxEdge = 0.9 - (strict*0.1); // stricter => tighter hull
  byJob.forEach((pts,job)=>{
    if(pts.length<3) return;
    const fc=turf.featureCollection(pts.map(c=>turf.point(c)));
    let hull=turf.concave(fc,{maxEdge:Math.max(0.15,maxEdge), units:'kilometers'});
    if(!hull) hull=turf.convex(fc);
    if(!hull) return;
    const simple=turf.simplify(hull,{tolerance:0.00004+strict*0.00001, highQuality:true});
    raw.set(job, simple);
  });
  return raw;
}

function clipNonOverlapping(raw){
  const entries=[...raw.entries()].map(([job,poly])=>[job,poly,turf.area(poly)]).sort((a,b)=>b[2]-a[2]);
  const out=[];
  for(let i=0;i<entries.length;i++){
    const [job, poly] = entries[i];
    let clipped = poly;
    for(let j=0;j<i;j++){
      const other = out[j].poly;
      const inter = turf.intersect(clipped, other);
      if(inter){
        if(turf.area(inter) < 30) continue;
        const diff = turf.difference(clipped, other);
        if(diff) clipped = diff;            // keep original if null
      }
    }
    out.push({job, poly:clipped||poly});
  }
  return out;
}

function draw(map, state, polys){
  // clear old
  state.areas.forEach(a=>{ map.removeLayer(a.fill); map.removeLayer(a.label); });
  state.areas=[];

  polys.forEach(({job,poly})=>{
    const col=colorFromString(job);
    const fill=L.geoJSON(poly,{
      pane:paneName,
      style:{color:col, weight:2.5, opacity:1, fillColor:col, fillOpacity:.25}
    }).addTo(map);
    const ctr=turf.centerOfMass(poly).geometry.coordinates;
    const label=L.marker([ctr[1],ctr[0]],{pane:paneName, interactive:false, icon:L.divIcon({className:'', html:`<div style="font-weight:900;letter-spacing:.4px;font-size:14px;color:#e2e8f0;text-shadow:0 2px 6px rgba(0,0,0,.7)">${job}</div>`})}).addTo(map);
    state.areas.push({fill,label});
  });
  if(!state.areasVisible){
    state.areas.forEach(a=>{ map.removeLayer(a.fill); map.removeLayer(a.label); });
  }
}

export function rebuild(sample=null){
  const map = state.map, s = state;
  const strict = Number(s.ui.strict.value||4);
  const list = sample || s.poles;
  const byJob=new Map();
  list.forEach(p=>{
    const job=String(p.job_name||'').trim(); if(!job) return;
    if(!byJob.has(job)) byJob.set(job,[]);
    byJob.get(job).push([p.lon,p.lat]); // [lng,lat]
  });
  const raw=buildRaw(byJob, strict);
  const clipped=clipNonOverlapping(raw);
  draw(map, s, clipped);
}
