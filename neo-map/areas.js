import { hashColor } from './data.js';

function bboxIntersects(a,b){ return !(b[0]>a[2] || b[2]<a[0] || b[1]>a[3] || b[3]<a[1]); }

export function buildJobAreas(map, poles){
  const byJob=new Map();
  for(const p of poles){
    const k=String(p.job_name||'').trim(); if(!k) continue;
    if(!byJob.has(k)) byJob.set(k,[]);
    byJob.get(k).push([p.lon, p.lat]); // [lon,lat]
  }

  const layers=[];
  const raw=[];
  byJob.forEach((pts, job)=>{
    if (pts.length<3){
      // tiny padded circle
      const f=turf.buffer(turf.point(pts[0]||[0,0]), 0.03, {units:'kilometers'});
      raw.push({ job, feature:f });
      return;
    }
    const fc=turf.featureCollection(pts.map(c=>turf.point(c)));
    let poly=turf.concave(fc, { maxEdge:1.2, units:'kilometers' }); // tighter than default
    if (!poly) poly=turf.convex(fc);
    if (!poly) return;
    // butter-smooth outline
    let out=turf.buffer(poly, 0.05, {units:'kilometers'});
    out=turf.buffer(out, -0.03, {units:'kilometers'});
    out=turf.simplify(out,{tolerance:0.0002, highQuality:true});
    raw.push({ job, feature:out });
  });

  // carve overlaps for crisp edges
  const carved=[];
  for(let i=0;i<raw.length;i++){
    let base=raw[i].feature; const bbA=turf.bbox(base);
    for(let j=0;j<raw.length;j++){
      if(i===j) continue;
      const bbB=turf.bbox(raw[j].feature);
      if(!bboxIntersects(bbA,bbB)) continue;
      const diff=turf.difference(base, raw[j].feature);
      if(diff) base=diff;
    }
    if(base){
      const col=hashColor(raw[i].job);
      const center=turf.centerOfMass(base).geometry.coordinates;
      const layer=L.geoJSON(base,{
        style:{ color:col, weight:2, opacity:0.9, fillColor:col, fillOpacity:0.18 } // slightly translucent fill; crisp outline
      }).addTo(map);
      const label=L.marker([center[1],center[0]],{
        interactive:false,
        icon:L.divIcon({className:'job-label', html:`<div style="font-weight:800;letter-spacing:.3px;font-size:14px;color:#dbeafe;text-shadow:0 2px 6px rgba(0,0,0,.6)">${raw[i].job}</div>`})
      }).addTo(map);
      carved.push({ job:raw[i].job, layer, label });
    }
  }
  return carved;
}
