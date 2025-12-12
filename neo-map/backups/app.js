// neo-map/app.js
// LOD markers + simple hulls. Job labels open area reports.
// Refresh preserves view. Owner filter supports OTHER / UNKNOWN.

import { loadPolesAndPermits, poleKey, statusColor, watchForGithubUpdates } from './data.js';
import { buildMarkers } from './markers.js';
import { buildJobAreas } from './areas.js';
import { ruleRow, readRules, matchRule } from './filters.js';
import { popupHTML, toast } from './ui.js';
import { openReport, closeReport } from './report.js';

const LOD = { DOT_MIN: 11, SHAPE_MIN: 15 };
function markerMode(z){ return z < LOD.DOT_MIN ? 'none' : z < LOD.SHAPE_MIN ? 'dots' : 'shapes'; }
function dotRadiusForZoom(z){ if (z<=11) return 1.6; if (z===12) return 1.9; if (z===13) return 2.2; return 2.5; }
function shapePxForZoom(z){ if (z>=18) return 20; if (z>=16) return 16; return 14; }

function normOwner(o){
  const s = String(o||'').trim().toUpperCase();
  if (!s) return 'UNKNOWN';
  if (s.includes('BPUB') || s.includes('BROWNSVILLE')) return 'BPUB';
  if (s.includes('AEP')) return 'AEP';
  if (s.includes('MVEC')) return 'MVEC';
  return 'OTHER';
}

const STATE = {
  poles: [], permits: [], byKey: new Map(),
  markerLayer: null, areas: [], areasVisible: true,
  bounds: null, filtered: null, shas: { poles:null, permits:null }, watcherStop: null
};

const map = L.map('map', { zoomControl:false, preferCanvas:true });
L.control.zoom({ position:'bottomright' }).addTo(map);

/* Base tiles + labels overlay */
const labelsPane = map.createPane('labels'); labelsPane.style.zIndex = '650'; labelsPane.style.pointerEvents = 'none';
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', { attribution:'© OpenStreetMap © CARTO' }).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', { pane:'labels' }).addTo(map);

/* no clustering: just a layer group */
STATE.markerLayer = L.layerGroup().addTo(map);

/* ── rendering ── */
function renderMarkers(){
  const z = map.getZoom();
  const data = STATE.filtered || STATE.poles;
  const opts = { dotRadius: dotRadiusForZoom(z), shapePx: shapePxForZoom(z) };
  STATE.bounds = buildMarkers(map, STATE.markerLayer, data, STATE.byKey, popupHTML, markerMode(z), opts);
}
function renderAreas(){
  if (STATE.areas.length){
    for (const a of STATE.areas){ a?.layer && map.removeLayer(a.layer); a?.glow && map.removeLayer(a.glow); a?.label && map.removeLayer(a.label); }
    STATE.areas = [];
  }
  if (!STATE.areasVisible) return;
  const data = STATE.filtered || STATE.poles;
  STATE.areas = buildJobAreas(map, data, STATE.byKey);
}
function renderAll(filtered=null){ STATE.filtered = filtered; renderMarkers(); renderAreas(); }

/* LOD redraws */
let lodT = null;
map.on('zoomend', ()=>{ clearTimeout(lodT); lodT = setTimeout(()=>{ renderMarkers(); }, 80); });
map.on('moveend', ()=>{ if (markerMode(map.getZoom()) === 'shapes') renderMarkers(); });

/* Filters */
function applyFilters(){
  const spec = readRules(); const q = spec.q;

  let base = STATE.poles.filter(p=>{
    // owner
    if (q.owner){
      const want = String(q.owner).toUpperCase();
      if (normOwner(p.owner) !== want) return false;
    }
    // search
    if (q.search){
      const hay = `${p.job_name} ${p.tag} ${p.SCID} ${p.owner} ${p.mr_level}`.toLowerCase();
      if (!hay.includes(String(q.search).toLowerCase())) return false;
    }
    // extra rule rows
    if (spec.rules.length){
      const rel = STATE.byKey.get(poleKey(p)) || [];
      const hits = spec.rules.map(r=> matchRule(p, r, rel));
      if (spec.logic==='AND' ? !hits.every(Boolean) : !hits.some(Boolean)) return false;
    }
    return true;
  });

  // Status default-to-All when not present
  let want = (q.status||'').trim();
  if (want){
    const exists = base.some(p=>{
      const rel = STATE.byKey.get(poleKey(p)) || [];
      if (want === 'NONE') return rel.length === 0;
      if (want === 'Not Approved - Other Issues'){
        return rel.some(r => {
          const s = String(r.permit_status||'').trim();
          return s.startsWith('Not Approved -') && !s.startsWith('Not Approved - Cannot Attach');
        });
      }
      return rel.some(r => String(r.permit_status||'').trim() === want);
    });
    if (!exists) want = ''; // ignore
  }

  if (want){
    base = base.filter(p=>{
      const rel = STATE.byKey.get(poleKey(p)) || [];
      if (want === 'NONE') return rel.length === 0;
      if (want === 'Not Approved - Other Issues'){
        return rel.some(r => {
          const s = String(r.permit_status||'').trim();
          return s.startsWith('Not Approved -') && !s.startsWith('Not Approved - Cannot Attach');
        });
      }
      return rel.some(r => String(r.permit_status||'').trim() === want);
    });
  }

  renderAll(base);
}

/* UI wiring */
document.getElementById('btnAddRule').addEventListener('click', ()=>{ document.getElementById('rules').appendChild(ruleRow()); });
document.getElementById('btnApply').addEventListener('click', applyFilters);
document.getElementById('btnClear').addEventListener('click', ()=>{
  document.getElementById('qOwner').value=''; document.getElementById('qStatus').value=''; document.getElementById('qSearch').value='';
  document.getElementById('rules').innerHTML=''; renderAll(null);
});
document.getElementById('qOwner').addEventListener('change', applyFilters);
document.getElementById('qStatus').addEventListener('change', applyFilters);
document.getElementById('qSearch').addEventListener('input', ()=>{ clearTimeout(window.__qT); window.__qT=setTimeout(applyFilters,220); });

document.getElementById('btnFit').addEventListener('click', ()=>{ if(STATE.bounds) map.fitBounds(STATE.bounds.pad(0.15)); });
document.getElementById('btnToggleAreas').addEventListener('click', ()=>{
  STATE.areasVisible = !STATE.areasVisible;
  if (!STATE.areasVisible){ for (const a of STATE.areas){ a?.layer && map.removeLayer(a.layer); a?.glow && map.removeLayer(a.glow); a?.label && map.removeLayer(a.label); } STATE.areas=[]; }
  else { renderAreas(); }
  toast(STATE.areasVisible ? 'Job areas ON' : 'Job areas OFF', 900);
});

/* Refresh — remember view */
document.getElementById('btnRefresh')?.addEventListener('click', async ()=>{
  try{
    const prev = { center: map.getCenter(), zoom: map.getZoom() };
    toast('Refreshing data…');
    const { poles, permits, byKey, shas, source } = await loadPolesAndPermits();
    STATE.poles=poles; STATE.permits=permits; STATE.byKey=byKey; STATE.shas=shas;
    renderAll(STATE.filtered);
    requestAnimationFrame(()=>{
      map.setView(prev.center, prev.zoom, { animate:false }); // restore
    });
    toast(`Data refreshed (${source}${shas.poles?` @ ${shas.poles.slice(0,7)}…`:''})`);
  }catch(e){ console.error(e); toast('Refresh failed'); }
});

/* Insights → overall report (same structure as area report) */
document.getElementById('btnReport')?.addEventListener('click', ()=>{
  openReport({ poles: STATE.poles, byKey: STATE.byKey });
});
document.getElementById('btnReportClose')?.addEventListener('click', ()=> closeReport());

/* Boot */
(async function(){
  try{
    toast('Loading poles & permits…');
    const { poles, permits, byKey, shas, source } = await loadPolesAndPermits();
    STATE.poles=poles; STATE.permits=permits; STATE.byKey=byKey; STATE.shas=shas;
    renderAll(null);
    requestAnimationFrame(()=>{
      map.invalidateSize();
      if (STATE.bounds && STATE.bounds.isValid()) map.fitBounds(STATE.bounds.pad(0.15), { animate:false });
    });
    if (watchForGithubUpdates !== undefined) {
      STATE.watcherStop = watchForGithubUpdates(({ poles, permits, byKey, shas })=>{
        const prev = { center: map.getCenter(), zoom: map.getZoom() };
        STATE.poles=poles; STATE.permits=permits; STATE.byKey=byKey; STATE.shas=shas;
        renderAll(STATE.filtered);
        requestAnimationFrame(()=> map.setView(prev.center, prev.zoom, { animate:false }));
        toast(`Auto-updated @ ${shas.poles.slice(0,7)}…`);
      }, 60000);
    }
  }catch(e){
    console.error(e);
    toast('Error loading data. Place neo-map next to poles.json & permits.json', 4500);
  }
})();
