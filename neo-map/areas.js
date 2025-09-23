// neo-map/areas.js
// Simple, robust job hulls + gradient fill by permit-status mix.
// - One smooth hull per job (convex + gentle buffer in/out).
// - Hull polygons are NON-interactive (so poles above them are always clickable).
// - Every hull shows a job NAME label; clicking the label opens the job-area report.

import { poleKey, statusColor } from './data.js';

const km = m => m / 1000;

// ── panes/renderers (labels sit ABOVE everything, so they can be clicked)
let SVG_GLOW = null, SVG_EDGE = null;
function ensurePanes(map){
  if (!map.getPane('jobGlow'))  { const p = map.createPane('jobGlow');  p.style.zIndex = 420; p.style.pointerEvents = 'none'; }
  if (!map.getPane('jobEdge'))  { const p = map.createPane('jobEdge');  p.style.zIndex = 430; p.style.pointerEvents = 'none'; } // hulls won't intercept clicks
  if (!map.getPane('jobLabel')) { const p = map.createPane('jobLabel'); p.style.zIndex = 640; p.style.pointerEvents = 'auto'; }   // labels are clickable
  if (!SVG_GLOW) SVG_GLOW = L.svg({ pane:'jobGlow' });
  if (!SVG_EDGE) SVG_EDGE = L.svg({ pane:'jobEdge' });
  if (!SVG_GLOW._map) SVG_GLOW.addTo(map);
  if (!SVG_EDGE._map) SVG_EDGE.addTo(map);
}

// ── very simple, robust hull
function simpleHull(plist){
  const pts = plist
    .map(p=>[+p.lon,+p.lat])
    .filter(([x,y])=>Number.isFinite(x)&&Number.isFinite(y));
  if (!pts.length) return null;
  if (pts.length === 1) return turf.buffer(turf.point(pts[0]), 0.06, { units:'kilometers' });
  if (pts.length === 2) return turf.buffer(turf.lineString(pts), 0.06, { units:'kilometers' });

  const fc = turf.featureCollection(pts.map(p=>turf.point(p)));
  let hull = turf.convex(fc);
  if (!hull) return null;

  // Gentle morphological close (out then in) — smooth & clean
  let poly = turf.buffer(hull, 0.08, { units:'kilometers' });
  poly     = turf.buffer(poly, -0.06, { units:'kilometers' });
  poly     = turf.simplify(poly, { tolerance: 0.00012, highQuality: true });
  return turf.cleanCoords(poly);
}

// ── gradient plumbing (re-used defs)
function overlaySVG(map){ return map.getPanes().overlayPane.querySelector('svg'); }
function ensureDefs(svg){ let d = svg.querySelector('defs'); if(!d){ d = document.createElementNS('http://www.w3.org/2000/svg','defs'); svg.prepend(d); } return d; }
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
  let acc = 0;
  for (const k of order){
    const cnt = mix[k]||0; if (!cnt) continue;
    const frac = cnt/total, col = statusColor(k), a = 0.18;
    const o0 = (acc*100).toFixed(4)+'%', o1 = ((acc+frac)*100).toFixed(4)+'%';
    const s0 = document.createElementNS('http://www.w3.org/2000/svg','stop'); s0.setAttribute('offset',o0); s0.setAttribute('stop-color',col); s0.setAttribute('stop-opacity',String(a));
    const s1 = document.createElementNS('http://www.w3.org/2000/svg','stop'); s1.setAttribute('offset',o1); s1.setAttribute('stop-color',col); s1.setAttribute('stop-opacity',String(a));
    g.appendChild(s0); g.appendChild(s1);
    acc += frac;
  }
}

// ── popup (click on LABEL opens this)
function areaPopupHTML(job, poles, byKey){
  const owners = ['BPUB','AEP','MVEC'];
  const statuses = ['Approved','Submitted - Pending','Created - NOT Submitted','Not Approved - Cannot Attach','Not Approved - Other Issues','NONE'];

  const totals = { ALL:{ count:0, byStatus:Object.fromEntries(statuses.map(s=>[s,0])) } };
  for (const o of owners) totals[o] = { count:0, byStatus:Object.fromEntries(statuses.map(s=>[s,0])) };

  for (const p of poles){
    const o = String(p.owner||'').toUpperCase();
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
    totals.ALL.count++; totals.ALL.byStatus[s]++;
    if (owners.includes(o)){ totals[o].count++; totals[o].byStatus[s]++; }
  }

  function row(name, t){
    const n = t.count||0;
    const cells = statuses.map(s=>{
      const c = t.byStatus[s]||0, pct = n? Math.round((c*1000)/n)/10 : 0;
      return `<td style="text-align:right"><span style="color:${statusColor(s)}">${c}</span><span class="muted small"> (${pct}%)</span></td>`;
    }).join('');
    return `<tr><th style="text-align:left">${name}</th><td style="text-align:right;font-weight:700">${n}</td>${cells}</tr>`;
  }

  return `
    <div class="pp">
      <div class="pp-title">${job}</div>
      <div class="pp-sub muted">Area report</div>
      <div class="pp-line">Total poles: <b>${totals.ALL.count}</b></div>
      <div class="pp-sep"></div>
      <table class="small" style="border-collapse:separate;border-spacing:6px 3px">
        <thead>
          <tr><th></th><th style="text-align:right">Poles</th>
            ${['Approved','Submitted - Pending','Created - NOT Submitted','Not Approved - Cannot Attach','Not Approved - Other Issues','NONE']
              .map(s=>`<th class="muted small" style="text-align:right">${s}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${row('BPUB', totals.BPUB)}
          ${row('AEP',  totals.AEP)}
          ${row('MVEC', totals.MVEC)}
          <tr><td colspan="${2+6}"><div class="pp-sep"></div></td></tr>
          ${row('<span style="font-weight:700">All utilities</span>', totals.ALL)}
        </tbody>
      </table>
    </div>`;
}

// ── main
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
  for (const [job, plist] of byJob.entries()){
    const feature = simpleHull(plist);
    if (!feature) continue;

    // mix + dominant color
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

    // render hull (GLOW under, EDGE above; both NON-interactive)
    const rings = feature.geometry.coordinates[0].map(([x,y])=>[y,x]);
    const glow = L.polygon(rings, { pane:'jobGlow', renderer:SVG_GLOW, color:col, weight:8, opacity:0.12, fillOpacity:0, interactive:false }).addTo(map);
    const edge = L.polygon(rings, { pane:'jobEdge', renderer:SVG_EDGE, color:col, weight:3, fillColor:col, fillOpacity:0.18, interactive:false }).addTo(map);

    // gradient fill (by mix)
    const gid = gradId(job);
    setMixGradient(map, gid, mix);
    edge.eachLayer ? edge.eachLayer(l=>{ if(l._path){ l._path.setAttribute('fill',`url(#${gid})`); l._path.style.fillOpacity='1'; } })
                   : (edge._path && (edge._path.setAttribute('fill',`url(#${gid})`), edge._path.style.fillOpacity='1'));

    // label (CLICKABLE → area report)
    const c = turf.centerOfMass(feature).geometry.coordinates;
    const label = L.marker([c[1], c[0]], {
      pane:'jobLabel', interactive:true,
      icon: L.divIcon({
        className:'job-label',
        html:`<div class="job-label-chip">${job}</div>`
      })
    }).addTo(map);
    label.on('click', (e)=> {
      L.popup({ autoPan:true }).setLatLng(e.latlng).setContent(areaPopupHTML(job, plist, byKey)).openOn(map);
    });

    layers.push({ job, layer: edge, glow, label });
  }
  return layers;
}
