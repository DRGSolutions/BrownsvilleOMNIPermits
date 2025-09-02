// /map3000/js/markers.js — shapes by owner, color by dominant permit status
import { STATUS_ORDER, statusColor, poleKey, iconSizePx } from './config.js';

export function init(map, state){
  state.cluster = L.markerClusterGroup({ disableClusteringAtZoom: 18, spiderfyOnMaxZoom:true });
  map.addLayer(state.cluster);
  state.singlesLayer = L.layerGroup();  // used when cluster OFF
}

function dominantStatusFor(rel){
  if (!rel || !rel.length) return 'NONE';
  const ss = rel.map(r => String(r.permit_status||'').trim());
  const na = ss.find(x=>x.startsWith('Not Approved -')); if (na) return na;
  if (ss.includes('Submitted - Pending')) return 'Submitted - Pending';
  if (ss.includes('Created - NOT Submitted')) return 'Created - NOT Submitted';
  if (ss.includes('Approved')) return 'Approved';
  return 'NONE';
}

function markerSVG(owner, fill, size=iconSizePx){
  const stroke='#fff', sw=1.8, half=size/2;
  if (owner === 'AEP'){
    return `<svg viewBox="0 0 ${size} ${size}"><polygon points="${half},${sw} ${size-sw},${size-sw} ${sw},${size-sw}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/></svg>`;
  } else if (owner === 'MVEC'){
    return `<svg viewBox="0 0 ${size} ${size}"><polygon points="${half},${sw} ${size-sw},${half} ${half},${size-sw} ${sw},${half}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/></svg>`;
  } else {
    return `<svg viewBox="0 0 ${size} ${size}"><circle cx="${half}" cy="${half}" r="${half-3.5}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/></svg>`;
  }
}
function shapeIcon(owner, color){
  return L.divIcon({ className:'shape-icon', html:markerSVG(owner,color), iconSize:[iconSizePx,iconSizePx], iconAnchor:[iconSizePx/2,iconSizePx/2], popupAnchor:[0,-10] });
}

function popupHTML(p, rel){
  const chip = s => s==='NONE'
    ? `<span class="chip" style="background:var(--chip-none);color:#0b0c10">NONE</span>`
    : `<span class="chip">${s}</span>`;
  const coords = (typeof p.lat==='number' && typeof p.lon==='number') ? `(${p.lat.toFixed(6)}, ${p.lon.toFixed(6)})` : '—';
  const permits = (rel||[]).length ? rel.map(r=>{
    const notes = r.notes ? String(r.notes).replace(/&/g,'&amp;').replace(/</g,'&lt;') : '';
    return `<div style="border:1px solid var(--border);border-radius:10px;padding:8px;margin:6px 0;background:#0a0f18">
      <div class="small"><code>${r.permit_id||''}</code> ${chip(r.permit_status)} ${r.submitted_at?`· ${r.submitted_at}`:''}</div>
      ${notes?`<div class="small muted" style="margin-top:6px;white-space:pre-wrap;"><b>Notes:</b> ${notes}</div>`:''}
    </div>`;
  }).join('') : `<div class="small">${chip('NONE')} <span class="muted">No permits yet.</span></div>`;
  return `<div class="popup">
    <div class="popup-title">${p.job_name||''}</div>
    <div class="popup-sub"><b>Owner:</b> ${p.owner||'—'} · <b>Tag:</b> ${p.tag||'—'} · <b>SCID:</b> ${p.SCID||'—'}</div>
    <div class="small muted" style="margin-bottom:6px"><b>Spec:</b> ${p.pole_spec||'—'} → ${p.proposed_spec||'—'} · <b>MR:</b> ${p.mr_level||'—'} · <b>GPS:</b> ${coords}</div>
    <div class="small muted" style="margin-bottom:4px">Permits</div>${permits}
  </div>`;
}

export function render({ cluster }){
  const s = state;  // global
  if (s.cluster) s.cluster.clearLayers();
  s.singlesLayer.clearLayers();
  s.bounds = null;

  const target = cluster ? s.cluster : s.singlesLayer;
  if (cluster){ if (!s.map.hasLayer(s.cluster)) s.map.addLayer(s.cluster); s.map.removeLayer(s.singlesLayer); }
  else        { if (!s.map.hasLayer(s.singlesLayer)) s.map.addLayer(s.singlesLayer); s.map.removeLayer(s.cluster); }

  for (const p of s.poles){
    const rel = s.byKey.get(poleKey(p)) || [];
    const dom = dominantStatusFor(rel);
    const icon = shapeIcon(p.owner, statusColor(dom));
    const m = L.marker([p.lat, p.lon], { icon, __dominant: dom }).bindPopup(popupHTML(p,rel), {maxWidth:420,minWidth:320});
    target.addLayer(m);
    if (!s.bounds) s.bounds = L.latLngBounds(m.getLatLng(), m.getLatLng()); else s.bounds.extend(m.getLatLng());
  }
  if (s.bounds) s.map.fitBounds(s.bounds.pad(0.15));
}
