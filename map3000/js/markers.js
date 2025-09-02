import { statusColor, STATUS_ORDER, poleKey, iconSizePx } from './config.js';

export function init(map, state){
  state.cluster = makeCluster(state);
  map.addLayer(state.cluster);
  state.singlesLayer = L.layerGroup();
}

function pieSVG(counts, total){
  const R=20, C=R+2, S=2*R+4;
  let start=0, paths='';
  STATUS_ORDER.forEach(st=>{
    const n = counts[st]||0; if(!n) return;
    const frac = n/total, end = start + frac*2*Math.PI;
    const x1=C + R*Math.cos(start), y1=C + R*Math.sin(start);
    const x2=C + R*Math.cos(end  ), y2=C + R*Math.sin(end  );
    const large = (end-start)>Math.PI ? 1:0;
    paths += `<path d="M${C},${C} L${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} z" fill="${statusColor(st).trim()}"/>`;
    start=end;
  });
  return `<svg class="cluster-pie" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
            ${paths}
            <circle cx="${C}" cy="${C}" r="${R-7}" fill="rgba(7,11,18,.95)" stroke="white" stroke-width="1.2"></circle>
            <text x="${C}" y="${C+4}" text-anchor="middle" font-weight="800" font-size="13" fill="#e5e7eb">${total}</text>
          </svg>`;
}
function makeCluster(state){
  return L.markerClusterGroup({
    disableClusteringAtZoom: 18, spiderfyOnMaxZoom:true,
    iconCreateFunction: cluster=>{
      const children = cluster.getAllChildMarkers();
      const counts = {}; const total=children.length;
      children.forEach(m=>{ const st=m.options.__dominant||'NONE'; counts[st]=(counts[st]||0)+1; });
      return L.divIcon({ html: pieSVG(counts,total), className:'', iconSize:[46,46] });
    }
  });
}

function markerSVG(owner, fill, size=iconSizePx){
  const stroke='#fff', sw=1.8, half=size/2;
  if(owner==='AEP'){
    return `<svg viewBox="0 0 ${size} ${size}"><polygon points="${half},${sw} ${size-sw},${size-sw} ${sw},${size-sw}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/></svg>`;
  }else if(owner==='MVEC'){
    return `<svg viewBox="0 0 ${size} ${size}"><polygon points="${half},${sw} ${size-sw},${half} ${half},${size-sw} ${sw},${half}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/></svg>`;
  }else{
    return `<svg viewBox="0 0 ${size} ${size}"><circle cx="${half}" cy="${half}" r="${half-3.5}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/></svg>`;
  }
}
function shapeIcon(owner, color){
  return L.divIcon({ className:'shape-icon', html:markerSVG(owner,color), iconSize:[iconSizePx,iconSizePx], iconAnchor:[iconSizePx/2,iconSizePx/2], popupAnchor:[0,-10]});
}

function dominantStatusFor(rel){
  if(!rel||!rel.length) return 'NONE';
  const s = rel.map(r=>String(r.permit_status||'').trim());
  if(s.find(x=>x.startsWith('Not Approved -'))) return s.find(x=>x.startsWith('Not Approved -'));
  if(s.includes('Submitted - Pending')) return 'Submitted - Pending';
  if(s.includes('Created - NOT Submitted')) return 'Created - NOT Submitted';
  if(s.includes('Approved')) return 'Approved';
  return 'NONE';
}

function popupHTML(p, rel){
  const chip = s => s==='NONE'
    ? `<span class="chip" style="background:var(--chip-none);color:#0b0c10">NONE</span>`
    : `<span class="chip ${sClass(s)}">${s}</span>`;
  function sClass(s){ if(s==='Submitted - Pending')return'pending'; if(s==='Approved')return'approved'; if(s==='Created - NOT Submitted')return'created'; if(s==='Not Approved - Cannot Attach')return'na_cannot'; if(s.startsWith('Not Approved -'))return'na_other'; return''; }
  const coord = (typeof p.lat==='number' && typeof p.lon==='number') ? `(${p.lat.toFixed(6)}, ${p.lon.toFixed(6)})` : '—';
  const permits = (rel||[]).length ? rel.map(r=>{
    const notes = r.notes ? String(r.notes).replace(/&/g,'&amp;').replace(/</g,'&lt;') : '';
    return `<div style="border:1px solid var(--border);border-radius:10px;padding:8px;margin:6px 0;background:#0a0f18">
      <div class="row" style="justify-content:space-between">
        <div class="small"><code>${r.permit_id||''}</code> ${chip(r.permit_status)} ${r.submitted_at?`· ${r.submitted_at}`:''}</div>
      </div>
      ${notes?`<div class="small muted" style="margin-top:6px;white-space:pre-wrap;"><b>Notes:</b> ${notes}</div>`:''}
    </div>`;
  }).join('') : `<div class="small"><span class="chip" style="background:var(--chip-none);color:#0b0c10">NONE</span> <span class="muted">No permits yet.</span></div>`;

  return `<div class="popup">
    <div class="popup-title">${p.job_name||''}</div>
    <div class="popup-sub"><b>Owner:</b> ${p.owner||'—'} · <b>Tag:</b> ${p.tag||'—'} · <b>SCID:</b> ${p.SCID||'—'}</div>
    <div class="small muted" style="margin-bottom:6px"><b>Spec:</b> ${p.pole_spec||'—'} → ${p.proposed_spec||'—'} · <b>MR:</b> ${p.mr_level||'—'} · <b>GPS:</b> ${coord}</div>
    <div class="small muted" style="margin-bottom:4px">Permits</div>${permits}
  </div>`;
}

export function render({ cluster }){
  const map = state.map, s = state;
  if(s.cluster) s.cluster.clearLayers();
  s.singlesLayer.clearLayers();
  s.bounds = null;

  const target = cluster ? s.cluster : s.singlesLayer;
  if(cluster){ if(!map.hasLayer(s.cluster)) map.addLayer(s.cluster); map.removeLayer(s.singlesLayer);}
  else       { if(!map.hasLayer(s.singlesLayer)) map.addLayer(s.singlesLayer); map.removeLayer(s.cluster);}

  for(const p of s.poles){
    const rel = s.byKey.get(poleKey(p))||[];
    const dom = dominantStatusFor(rel);
    const icon = shapeIcon(p.owner, statusColor(dom));
    const m = L.marker([p.lat,p.lon], {icon, __dominant:dom}).bindPopup(popupHTML(p,rel), {maxWidth:420,minWidth:320,autoPanPaddingTopLeft:[360,110]});
    target.addLayer(m);
    if(!s.bounds) s.bounds = L.latLngBounds(m.getLatLng(), m.getLatLng()); else s.bounds.extend(m.getLatLng());
  }
  if(s.bounds) map.fitBounds(s.bounds.pad(0.15));
}

export function setMarkerVisibility(visible){
  const map = state.map;
  if(visible){
    const clus = state.ui.clusterMode.value==='on';
    if(clus){ map.addLayer(state.cluster); map.removeLayer(state.singlesLayer); }
    else    { map.addLayer(state.singlesLayer); map.removeLayer(state.cluster); }
  }else{
    map.removeLayer(state.cluster);
    map.removeLayer(state.singlesLayer);
  }
}
