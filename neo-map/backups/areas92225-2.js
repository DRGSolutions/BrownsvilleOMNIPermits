// neo-map/areas.js
// Simple, robust job hulls (convex + gentle smooth) with status-mix fill.
// - Hull polygons are NON-interactive (so poles above them are always clickable).
// - Every hull shows a job NAME label; clicking the label opens the job-area report.
// - Report counts poles by *dominant* permit status per utility (using byKey).
//
// Requires: turf, Leaflet, and data.js exports: poleKey, statusColor.

import { poleKey, statusColor } from './data.js';

const km = m => m / 1000;

/* ───────────────────── Panes/renderers ───────────────────── */
let SVG_GLOW = null, SVG_EDGE = null;
function ensurePanes(map){
  if (!map.getPane('jobGlow'))  { const p = map.createPane('jobGlow');  p.style.zIndex = 420; p.style.pointerEvents = 'none'; }
  if (!map.getPane('jobEdge'))  { const p = map.createPane('jobEdge');  p.style.zIndex = 430; p.style.pointerEvents = 'none'; } // hulls won't eat clicks
  if (!map.getPane('jobLabel')) { const p = map.createPane('jobLabel'); p.style.zIndex = 640; p.style.pointerEvents = 'auto'; }   // labels are clickable
  if (!SVG_GLOW) SVG_GLOW = L.svg({ pane:'jobGlow' });
  if (!SVG_EDGE) SVG_EDGE = L.svg({ pane:'jobEdge' });
  if (!SVG_GLOW._map) SVG_GLOW.addTo(map);
  if (!SVG_EDGE._map) SVG_EDGE.addTo(map);
}

/* ───────────────────── Hull building (KISS) ───────────────────── */
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

/* ───────────────────── Status bucketing ───────────────────── */
const STATUS_BUCKETS = [
  'Approved',
  'Submitted - Pending',
  'Created - NOT Submitted',
  'Not Approved - Cannot Attach',
  'Not Approved - Other Issues',
  'NONE'
];

function bucketStatus(s){
  const t = String(s||'').trim();
  if (t === 'Approved') return 'Approved';
  if (t === 'Submitted - Pending') return 'Submitted - Pending';
  if (t === 'Created - NOT Submitted') return 'Created - NOT Submitted';
  if (t.startsWith('Not Approved - Cannot Attach')) return 'Not Approved - Cannot Attach';
  if (t.startsWith('Not Approved -')) return 'Not Approved - Other Issues';
  return 'NONE';
}

// Priority for “dominant” status on a pole (same order used elsewhere)
const DOM_PRIORITY = [
  s => s.startsWith('Not Approved - Cannot Attach'),
  s => s.startsWith('Not Approved - PLA Issues'),
  s => s.startsWith('Not Approved - MRE Issues'),
  s => s.startsWith('Not Approved - Other Issues'),
  s => s === 'Submitted - Pending',
  s => s === 'Created - NOT Submitted',
  s => s === 'Approved'
];

function dominantBucketFromPermits(rel){
  if (!rel || !rel.length) return 'NONE';
  const ss = rel.map(r => String(r.permit_status||'').trim());
  for (const pred of DOM_PRIORITY){
    const hit = ss.find(pred);
    if (hit) return bucketStatus(hit);
  }
  return bucketStatus(ss[0] || 'NONE');
}

/* ───────────────────── Owner normalization ───────────────────── */
function normOwner(o){
  const s = String(o||'').trim().toUpperCase();
  if (!s) return null;
  if (s.includes('BPUB') || s.includes('BROWNSVILLE')) return 'BPUB';
  if (s.includes('AEP')) return 'AEP';
  if (s.includes('MVEC')) return 'MVEC';
  return null; // treat unknowns as “not in the 3 utilities”
}

/* ───────────────────── Gradient plumbing ───────────────────── */
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

  const total = Math.max(1, STATUS_BUCKETS.reduce((s,k)=> s + (mix[k]||0), 0));
  let acc = 0;
  for (const k of STATUS_BUCKETS){
    const cnt = mix[k]||0; if (!cnt) continue;
    const frac = cnt/total, col = statusColor(k), a = 0.18;
    const o0 = (acc*100).toFixed(4)+'%', o1 = ((acc+frac)*100).toFixed(4)+'%';
    const s0 = document.createElementNS('http://www.w3.org/2000/svg','stop'); s0.setAttribute('offset',o0); s0.setAttribute('stop-color',col); s0.setAttribute('stop-opacity',String(a));
    const s1 = document.createElementNS('http://www.w3.org/2000/svg','stop'); s1.setAttribute('offset',o1); s1.setAttribute('stop-color',col); s1.setAttribute('stop-opacity',String(a));
    g.appendChild(s0); g.appendChild(s1);
    acc += frac;
  }
}

/* ───────────────────── Area report (counts by pole dominant status) ───────────────────── */
function computeJobStats(job, polesOfJob, byKey){
  const OWNERS = ['BPUB','AEP','MVEC'];

  const stats = {
    owners: {
      BPUB: { poles:0, byStatus: Object.fromEntries(STATUS_BUCKETS.map(s=>[s,0])) },
      AEP:  { poles:0, byStatus: Object.fromEntries(STATUS_BUCKETS.map(s=>[s,0])) },
      MVEC: { poles:0, byStatus: Object.fromEntries(STATUS_BUCKETS.map(s=>[s,0])) }
    },
    all:   { poles:0, byStatus: Object.fromEntries(STATUS_BUCKETS.map(s=>[s,0])) }
  };

  for (const p of polesOfJob){
    const rel = byKey?.get(poleKey(p)) || [];
    const bucket = dominantBucketFromPermits(rel);
    const owner  = normOwner(p.owner);

    stats.all.poles += 1;
    stats.all.byStatus[bucket] += 1;

    if (owner && stats.owners[owner]){
      stats.owners[owner].poles += 1;
      stats.owners[owner].byStatus[bucket] += 1;
    }
  }

  return stats;
}

function areaPopupHTML(job, stats){
  const statuses = STATUS_BUCKETS;
  function row(label, rec){
    const n = rec.poles || 0;
    const cells = statuses.map(s=>{
      const c = rec.byStatus[s]||0, pct = n? Math.round((c*1000)/n)/10 : 0;
      return `<td style="text-align:right; white-space:nowrap;">
                <span style="color:${statusColor(s)}">${c}</span>
                <span class="muted small"> (${pct}%)</span>
              </td>`;
    }).join('');
    return `<tr>
      <th style="text-align:left; padding-right:8px">${label}</th>
      <td style="text-align:right; font-weight:700; padding-right:8px">${n}</td>
      ${cells}
    </tr>`;
  }

  return `
    <div class="pp" style="min-width:540px">
      <div class="pp-title">${job}</div>
      <div class="pp-sub muted">Area report</div>
      <div class="pp-line">Total poles: <b>${stats.all.poles}</b></div>
      <div class="pp-sep"></div>
      <div style="overflow-x:auto;">
        <table class="small" style="border-collapse:separate; border-spacing:6px 3px; width:max-content;">
          <thead>
            <tr>
              <th></th>
              <th style="text-align:right; padding-right:8px">Poles</th>
              ${statuses.map(s=>`<th class="muted small" style="text-align:right; white-space:nowrap">${s}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${row('BPUB', stats.owners.BPUB)}
            ${row('AEP',  stats.owners.AEP)}
            ${row('MVEC', stats.owners.MVEC)}
            <tr><td colspan="${2+statuses.length}"><div class="pp-sep"></div></td></tr>
            ${row('<span style="font-weight:700">All utilities</span>', stats.all)}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* ───────────────────── Main ───────────────────── */
export function buildJobAreas(map, poles, byKey){
  ensurePanes(map);

  // group all poles by job (from JSON; NOT by hull contents)
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

    // compute stats from actual poles + permits via byKey (dominant status per pole)
    const stats = computeJobStats(job, plist, byKey);

    // dominant color for outline & mix for fill
    const dominant = Object.entries(stats.all.byStatus).sort((a,b)=>b[1]-a[1])[0][0];
    const col = statusColor(dominant);

    // render (non-interactive) hull
    const rings = feature.geometry.coordinates[0].map(([x,y])=>[y,x]);
    const glow = L.polygon(rings, { pane:'jobGlow', renderer:SVG_GLOW, color:col, weight:8, opacity:0.12, fillOpacity:0, interactive:false }).addTo(map);
    const edge = L.polygon(rings, { pane:'jobEdge', renderer:SVG_EDGE, color:col, weight:3, fillColor:col, fillOpacity:0.18, interactive:false }).addTo(map);

    // gradient fill by mix
    const gid = gradId(job);
    setMixGradient(map, gid, stats.all.byStatus);
    edge.eachLayer ? edge.eachLayer(l=>{ if(l._path){ l._path.setAttribute('fill',`url(#${gid})`); l._path.style.fillOpacity='1'; } })
                   : (edge._path && (edge._path.setAttribute('fill',`url(#${gid})`), edge._path.style.fillOpacity='1'));

    // label (CLICK → area popup)
    const c = turf.centerOfMass(feature).geometry.coordinates;
    const label = L.marker([c[1], c[0]], {
      pane:'jobLabel', interactive:true,
      icon: L.divIcon({
        className:'job-label',
        html:`<div class="job-label-chip">${job}</div>`
      })
    }).addTo(map);

    label.on('click', (e)=> {
      L.popup({ autoPan:true, maxWidth: 880, className: 'area-popup' })
        .setLatLng(e.latlng)
        .setContent(areaPopupHTML(job, stats))
        .openOn(map);
    });

    layers.push({ job, layer: edge, glow, label });
  }
  return layers;
}
