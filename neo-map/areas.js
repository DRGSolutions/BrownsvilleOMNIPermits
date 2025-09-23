// neo-map/areas.js
// Job areas with smooth hulls + gradient fill by status MIX.
// - Poles always click (polygons are below markers; labels are above).
// - Every hull shows a label when zoomed in.
// - Clicking a hull opens a rich popup with utility/status breakdowns.

import { poleKey, statusColor } from './data.js';

const km = m => m/1000;

// panes/renderers (SVG so ordering wins even with preferCanvas:true)
let SVG_GLOW = null, SVG_EDGE = null;
function ensurePanes(map){
  if (!map.getPane('jobGlow'))  { const glow = map.createPane('jobGlow');  glow.style.zIndex = 420; glow.style.pointerEvents = 'none'; }
  if (!map.getPane('jobEdge'))  { const edge = map.createPane('jobEdge');  edge.style.zIndex = 430; edge.style.pointerEvents = 'auto'; } // clickable hull
  if (!map.getPane('jobLabel')) { const lbl  = map.createPane('jobLabel'); lbl.style.zIndex = 640; lbl.style.pointerEvents = 'none'; }   // above polygons
  if (!SVG_GLOW) SVG_GLOW = L.svg({ pane:'jobGlow' });
  if (!SVG_EDGE) SVG_EDGE = L.svg({ pane:'jobEdge' });
  if (!SVG_GLOW._map) SVG_GLOW.addTo(map);
  if (!SVG_EDGE._map) SVG_EDGE.addTo(map);
}

// simple, robust smoothing: convex if spread; concave when compact
function medianNN(plist){
  if (plist.length < 2) return 80;
  const pts = plist.map(p=>turf.point([+p.lon,+p.lat]));
  const d = [];
  for (let i=0;i<pts.length;i++){
    let best=Infinity;
    for (let j=0;j<pts.length;j++){
      if(i===j) continue;
      const dd = turf.distance(pts[i], pts[j], { units:'meters' });
      if (dd<best) best=dd;
    }
    if (best<Infinity) d.push(best);
  }
  d.sort((a,b)=>a-b);
  return d.length ? d[Math.floor(d.length*0.5)] : 80;
}
function smoothHull(plist){
  const pts = plist.map(p=>[+p.lon,+p.lat]);
  if (!pts.length) return null;
  if (pts.length===1) return turf.buffer(turf.point(pts[0]), 0.05, { units:'kilometers' });

  const fc = turf.featureCollection(pts.map(p=>turf.point(p)));
  const bb = turf.bbox(fc);
  const diagKm = turf.distance([bb[0],bb[1]],[bb[2],bb[3]], {units:'kilometers'});
  let hull;

  if (diagKm > 5){ // very spread → convex is cleaner
    hull = turf.convex(fc);
  }else{
    const scaleM = medianNN(plist);
    const maxEdgeKm = Math.max(km(scaleM)*6.0, 0.15);
    hull = turf.concave(fc, { maxEdge:maxEdgeKm, units:'kilometers' }) || turf.convex(fc);
  }
  if (!hull) return null;

  // gentle close (out/in) to remove notches
  let poly = turf.buffer(hull, 0.06, { units:'kilometers' });
  poly     = turf.buffer(poly, -0.04, { units:'kilometers' });
  poly     = turf.simplify(poly, { tolerance: 0.00012, highQuality:true });
  return turf.cleanCoords(poly);
}

// gradient plumbing (reuse a single <defs>)
function overlaySVG(map){ return map.getPanes().overlayPane.querySelector('svg'); }
function ensureDefs(svg){ let d = svg.querySelector('defs'); if(!d){ d=document.createElementNS('http://www.w3.org/2000/svg','defs'); svg.prepend(d); } return d; }
function gradId(job){ let h=0; for(let i=0;i<job.length;i++) h=(h*31+job.charCodeAt(i))>>>0; return 'grad-'+h.toString(16); }
function setMixGradient(map, id, mix){
  const svg = overlaySVG(map); if (!svg) return;
  const defs = ensureDefs(svg);
  let g = defs.querySelector('#'+id);
  if (!g){
    g = document.createElementNS('http://www.w3.org/2000/svg','linearGradient');
    g.setAttribute('id', id);
    g.setAttribute('x1','0'); g.setAttribute('y1','0'); g.setAttribute('x2','1'); g.setAttribute('y2','0');
    g.setAttribute('gradientUnits','objectBoundingBox');
    defs.appendChild(g);
  }
  while (g.firstChild) g.removeChild(g.firstChild);
  const order = ['Approved','Submitted - Pending','Created - NOT Submitted','Not Approved - Cannot Attach','Not Approved - Other Issues','NONE'];
  const total = Math.max(1, order.reduce((s,k)=> s + (mix[k]||0), 0));
  let acc=0;
  for (const k of order){
    const cnt = mix[k]||0; if (!cnt) continue;
    const frac = cnt/total, col = statusColor(k), a=0.18;
    const o0 = (acc*100).toFixed(4)+'%', o1=((acc+frac)*100).toFixed(4)+'%';
    const s0 = document.createElementNS('http://www.w3.org/2000/svg','stop'); s0.setAttribute('offset',o0); s0.setAttribute('stop-color',col); s0.setAttribute('stop-opacity',String(a));
    const s1 = document.createElementNS('http://www.w3.org/2000/svg','stop'); s1.setAttribute('offset',o1); s1.setAttribute('stop-color',col); s1.setAttribute('stop-opacity',String(a));
    g.appendChild(s0); g.appendChild(s1);
    acc += frac;
  }
}

// tabular popup for an area
function areaPopupHTML(job, poles, byKey){
  const totals = { ALL: {count:0, statuses:{}} };
  const owners = ['BPUB','AEP','MVEC'];
  const statuses = ['Approved','Submitted - Pending','Created - NOT Submitted','Not Approved - Cannot Attach','Not Approved - Other Issues','NONE'];

  for (const o of owners){ totals[o] = { count:0, statuses:{} }; }
  for (const s of statuses){ totals.ALL.statuses[s]=0; for (const o of owners) totals[o].statuses[s]=0; }

  for (const p of poles){
    const o = owners.includes(String(p.owner||'').toUpperCase()) ? String(p.owner).toUpperCase() : 'ALL'; // bucket unknown into ALL only
    const rel = byKey?.get(poleKey(p)) || [];
    let s = 'NONE';
    if (rel.length){
      const ss = rel.map(r => String(r.permit_status||'').trim());
      s = ss.includes('Approved') ? 'Approved'
        : ss.includes('Submitted - Pending') ? 'Submitted - Pending'
        : ss.includes('Created - NOT Submitted') ? 'Created - NOT Submitted'
        : ss.find(x=>x.startsWith('Not Approved - Cannot Attach')) ? 'Not Approved - Cannot Attach'
        : ss.find(x=>x.startsWith('Not Approved -')) ? 'Not Approved - Other Issues'
        : 'NONE';
    }
    totals.ALL.count++; totals.ALL.statuses[s]++;

    if (owners.includes(o)){ totals[o].count++; totals[o].statuses[s]++; }
  }

  function row(label, t){
    const n = t.count || 0;
    const cells = statuses.map(s=>{
      const c = t.statuses[s]||0, pct = n? Math.round((c*1000)/n)/10 : 0;
      const col = statusColor(s);
      return `<td style="text-align:right"><span style="color:${col}">${c}</span><span class="muted small"> (${pct}%)</span></td>`;
    }).join('');
    return `<tr><th style="text-align:left">${label}</th><td style="text-align:right;font-weight:700">${n}</td>${cells}</tr>`;
  }

  const table = `
    <div class="pp">
      <div class="pp-title">${job}</div>
      <div class="pp-sub muted">Area details</div>
      <div class="pp-line">Total poles: <b>${totals.ALL.count}</b></div>
      <div class="pp-sep"></div>
      <table class="small" style="border-collapse:separate;border-spacing:6px 3px">
        <thead>
          <tr><th></th><th style="text-align:right">Poles</th>
            ${statuses.map(s=>`<th class="muted small" style="text-align:right">${s}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${row('BPUB', totals.BPUB)}
          ${row('AEP',  totals.AEP)}
          ${row('MVEC', totals.MVEC)}
          <tr><td colspan="${2+statuses.length}"><div class="pp-sep"></div></td></tr>
          ${row('<span style="font-weight:700">All utilities</span>', totals.ALL)}
        </tbody>
      </table>
    </div>
  `;
  return table;
}

export function buildJobAreas(map, poles, byKey){
  ensurePanes(map);

  // group by job
  const byJob = new Map();
  for (const p of (poles||[])){
    const job = String(p.job_name||'').trim(); if (!job) continue;
    if (!Number.isFinite(+p.lon) || !Number.isFinite(+p.lat)) continue;
    if (!byJob.has(job)) byJob.set(job, []);
    byJob.get(job).push(p);
  }

  const layers = [];
  byJob.forEach((plist, job)=>{
    const feature = smoothHull(plist);
    if (!feature) return;

    // status mix + dominant for color
    const mix = { 'Approved':0,'Submitted - Pending':0,'Created - NOT Submitted':0,'Not Approved - Cannot Attach':0,'Not Approved - Other Issues':0,'NONE':0 };
    for (const p of plist){
      const rel = byKey?.get(poleKey(p)) || [];
      let s = 'NONE';
      if (rel.length){
        const ss = rel.map(r=>String(r.permit_status||'').trim());
        s = ss.includes('Approved') ? 'Approved'
          : ss.includes('Submitted - Pending') ? 'Submitted - Pending'
          : ss.includes('Created - NOT Submitted') ? 'Created - NOT Submitted'
          : ss.find(x=>x.startsWith('Not Approved - Cannot Attach')) ? 'Not Approved - Cannot Attach'
          : ss.find(x=>x.startsWith('Not Approved -')) ? 'Not Approved - Other Issues'
          : 'NONE';
      }
      mix[s] = (mix[s]||0)+1;
    }
    const dominant = Object.entries(mix).sort((a,b)=>b[1]-a[1])[0][0];
    const col = statusColor(dominant);

    // render hulls
    const rings = feature.geometry.coordinates[0].map(([x,y])=>[y,x]);
    const glow = L.polygon(rings, {
      pane:'jobGlow', renderer:SVG_GLOW,
      color:col, weight:8, opacity:0.12, fillOpacity:0, interactive:false
    }).addTo(map);

    const layer = L.polygon(rings, {
      pane:'jobEdge', renderer:SVG_EDGE,
      color:col, weight:3, fillColor:col, fillOpacity:0.18, interactive:true
    }).addTo(map);

    // gradient fill → proportional to mix
    const gid = gradId(job);
    setMixGradient(map, gid, mix);
    layer.eachLayer ? layer.eachLayer(l => { if (l._path){ l._path.setAttribute('fill', `url(#${gid})`); l._path.style.fillOpacity='1'; } })
                    : (layer._path && (layer._path.setAttribute('fill',`url(#${gid})`), layer._path.style.fillOpacity='1'));

    // HULL POPUP (click the polygon)
    layer.on('click', (e) => {
      L.popup({ autoPan:true })
        .setLatLng(e.latlng)
        .setContent(areaPopupHTML(job, plist, byKey))
        .openOn(map);
    });

    // Always show a label (above polygons)
    const center = turf.centerOfMass(feature).geometry.coordinates;
    const label = L.marker([center[1], center[0]], {
      pane:'jobLabel', interactive:false,
      icon: L.divIcon({
        className:'job-label',
        html:`<div style="font-weight:800;letter-spacing:.3px;font-size:14px;color:#e6efff;text-shadow:0 2px 10px rgba(0,0,0,.7)">${job}</div>`
      })
    }).addTo(map);

    layers.push({ job, layer, glow, label });
  });

  return layers;
}
