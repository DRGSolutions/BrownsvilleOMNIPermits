import { loadPolesAndPermits, poleKey, statusColor, watchForGithubUpdates } from './data.js';
import { buildMarkers } from './markers.js';
import { buildJobAreas } from './areas.js';
import { ruleRow, readRules, matchRule } from './filters.js';
import { popupHTML, toast } from './ui.js';
import { openReport, closeReport } from './report.js';

/* LOD (level of detail)
   Markers:
     - z < 11  → none
     - 11–14   → tiny canvas dots (fast)
     - ≥ 15    → compact SVG shapes + popups
   Areas:
     - z < 13  → coarse (convex+smooth)  — light
     - ≥ 13    → fine (concave+smooth)   — detailed
*/
export const LOD = { DOT_MIN: 11, SHAPE_MIN: 15, HULL_FINE_MIN: 13 };

function markerMode(z){ return z < LOD.DOT_MIN ? 'none' : z < LOD.SHAPE_MIN ? 'dots' : 'shapes'; }
function hullMode(z){ return z < LOD.HULL_FINE_MIN ? 'coarse' : 'fine'; }

/* size helpers (tiny by default; grow only when very close) */
function dotRadiusForZoom(z){
  if (z < 11) return 0;
  if (z === 11) return 1.6;
  if (z === 12) return 1.9;
  if (z === 13) return 2.2;
  if (z === 14) return 2.5;
  return 0; // not used in shapes mode
}
function shapePxForZoom(z){
  if (z >= 18) return 24;   // very close
  if (z >= 16) return 18;   // close
  return 16;                // first shapes level (compact)
}

/* ── STATE ── */
const STATE = {
  poles: [],
  permits: [],
  byKey: new Map(),
  markerLayer: null,
  areas: [],
  areasVisible: true,
  bounds: null,
  filtered: null,
  shas: { poles: null, permits: null },
  watcherStop: null
};

const map = L.map('map', { zoomControl: false, preferCanvas: true });
L.control.zoom({ position: 'bottomright' }).addTo(map);

/* Base tiles: dark without labels + labels overlay (labels above hull shading) */
const labelsPane = map.createPane('labels');
labelsPane.style.zIndex = '650';
labelsPane.style.pointerEvents = 'none';

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
  attribution: '© OpenStreetMap © CARTO'
}).addTo(map);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
  pane: 'labels'
}).addTo(map);

/* markers live in a simple layer group (no clustering) */
STATE.markerLayer = L.layerGroup().addTo(map);

/* ── rendering ── */
function renderMarkers(){
  const z = map.getZoom();
  const mode = markerMode(z);
  const data = STATE.filtered || STATE.poles;
  const opts = {
    dotRadius: dotRadiusForZoom(z),
    shapePx: shapePxForZoom(z)
  };
  STATE.bounds = buildMarkers(map, STATE.markerLayer, data, STATE.byKey, popupHTML, mode, opts);
}

function renderAreas(){
  if (STATE.areas.length){
    for (const a of STATE.areas){
      a?.layer && map.removeLayer(a.layer);
      a?.glow  && map.removeLayer(a.glow);
      a?.label && map.removeLayer(a.label);
    }
    STATE.areas = [];
  }
  if (!STATE.areasVisible) return;

  const data = STATE.filtered || STATE.poles;
  const mode = hullMode(map.getZoom()); // 'coarse' | 'fine'
  STATE.areas = buildJobAreas(map, data, STATE.byKey, { mode });
}

function renderAll(filtered=null){
  STATE.filtered = filtered;
  renderMarkers();
  renderAreas();
}

/* LOD: re-render on zoom (light debounce) */
let lodT = null;
map.on('zoomend', () => {
  clearTimeout(lodT);
  lodT = setTimeout(() => { renderMarkers(); renderAreas(); }, 80);
});

/* ── filters ── */
function applyFilters(){
  const spec = readRules();
  const result = STATE.poles.filter(p=>{
    const rel = STATE.byKey.get(poleKey(p)) || [];
    const q = spec.q;
    if (q.owner && p.owner!==q.owner) return false;
    if (q.status){
      if (q.status==='NONE'){ if (rel.length!==0) return false; }
      else if (!rel.some(r=>r.permit_status===q.status)) return false;
    }
    if (q.search){
      const hay = `${p.job_name} ${p.tag} ${p.SCID} ${p.owner} ${p.mr_level}`.toLowerCase();
      if (!hay.includes(q.search)) return false;
    }
    if (spec.rules.length){
      const hits = spec.rules.map(r=> readRules.matchRule ? readRules.matchRule(p,r,rel) : true);
      return spec.logic==='AND' ? hits.every(Boolean) : hits.some(Boolean);
    }
    return true;
  });
  renderAll(result);
}

/* ── UI wiring ── */
document.getElementById('btnAddRule').addEventListener('click', ()=> {
  document.getElementById('rules').appendChild(ruleRow());
});
document.getElementById('btnApply').addEventListener('click', applyFilters);
document.getElementById('btnClear').addEventListener('click', ()=>{
  document.getElementById('qOwner').value='';
  document.getElementById('qStatus').value='';
  document.getElementById('qSearch').value='';
  document.getElementById('rules').innerHTML='';
  renderAll(null);
});
document.getElementById('qOwner').addEventListener('change', applyFilters);
document.getElementById('qStatus').addEventListener('change', applyFilters);
document.getElementById('qSearch').addEventListener('input', ()=>{
  clearTimeout(window.__qT); window.__qT=setTimeout(applyFilters,220);
});

document.getElementById('btnFit').addEventListener('click', ()=>{
  if(STATE.bounds) map.fitBounds(STATE.bounds.pad(0.15));
});
document.getElementById('btnToggleAreas').addEventListener('click', ()=>{
  STATE.areasVisible = !STATE.areasVisible;
  if (!STATE.areasVisible){
    for (const a of STATE.areas){
      a?.layer && map.removeLayer(a.layer);
      a?.glow  && map.removeLayer(a.glow);
      a?.label && map.removeLayer(a.label);
    }
    STATE.areas=[];
  } else {
    renderAreas();
  }
  toast(STATE.areasVisible ? 'Job areas ON' : 'Job areas OFF', 900);
});

/* manual refresh */
const btnRefresh = document.getElementById('btnRefresh');
if (btnRefresh) {
  btnRefresh.addEventListener('click', async ()=>{
    try{
      toast('Refreshing data…');
      const { poles, permits, byKey, shas, source } = await loadPolesAndPermits();
      STATE.poles=poles; STATE.permits=permits; STATE.byKey=byKey; STATE.shas=shas;
      renderAll(STATE.filtered);
      requestAnimationFrame(()=>{
        map.invalidateSize();
        if (STATE.bounds && STATE.bounds.isValid()) map.fitBounds(STATE.bounds.pad(0.15), { animate:false });
      });
      toast(`Data refreshed (${source}${shas.poles?` @ ${shas.poles.slice(0,7)}…`:''})`);
    }catch(e){
      console.error(e);
      toast('Refresh failed');
    }
  });
}

/* Insights (unchanged) */
document.getElementById('btnReport')?.addEventListener('click', ()=>{
  const { poles, permits, byKey } = STATE;
  const enriched = poles.map(p => ({ ...p, __hasPermit: (byKey.get(poleKey(p))||[]).length>0 }));
  const statusCounts = {
    'Approved':0,'Submitted - Pending':0,'Created - NOT Submitted':0,
    'Not Approved - Cannot Attach':0,'Not Approved - PLA Issues':0,'Not Approved - MRE Issues':0,'Not Approved - Other Issues':0,
    'NONE':0
  };
  const ownerCounts = {};
  const byJob = {};
  const naByJob = {};
  for(const p of enriched){
    ownerCounts[p.owner] = (ownerCounts[p.owner]||0)+1;
    byJob[p.job_name] = (byJob[p.job_name]||0)+1;
    const rel = byKey.get(poleKey(p)) || [];
    if (!rel.length){ statusCounts['NONE']++; continue; }
    const ss = rel.map(r => String(r.permit_status||''));
    const order = [
      s => s.startsWith('Not Approved - Cannot Attach'),
      s => s.startsWith('Not Approved - PLA Issues'),
      s => s.startsWith('Not Approved - MRE Issues'),
      s => s.startsWith('Not Approved - Other Issues'),
      s => s === 'Submitted - Pending',
      s => s === 'Created - NOT Submitted',
      s => s === 'Approved'
    ];
    let chosen = 'Approved';
    for(const pred of order){ const hit = ss.find(pred); if (hit){ chosen = hit; break; } }
    statusCounts[chosen] = (statusCounts[chosen]||0)+1;
    if (chosen.startsWith('Not Approved -')) naByJob[p.job_name] = (naByJob[p.job_name]||0)+1;
  }
  const polesPerJob = Object.values(byJob).sort((a,b)=>a-b);
  const mid = Math.floor(polesPerJob.length/2);
  const polesPerJobMedian = polesPerJob.length ? (polesPerJob.length%2? polesPerJob[mid] : Math.round((polesPerJob[mid-1]+polesPerJob[mid])/2)) : 0;
  const counts = { jobs: Object.keys(byJob).length, polesPerJobMedian, byJob, naByJob };
  openReport({ poles: enriched, permits: STATE.permits, counts, ownerCounts, statusCounts });
});
document.getElementById('btnReportClose')?.addEventListener('click', ()=> closeReport());

/* boot */
(async function(){
  try{
    toast('Loading poles & permits…');
    const { poles, permits, byKey, shas, source } = await loadPolesAndPermits();
    STATE.poles=poles; STATE.permits=permits; STATE.byKey=byKey; STATE.shas=shas;
    renderAll(null);
    toast(`Loaded ${poles.length} poles, ${permits.length} permits (${source}${shas.poles?` @ ${shas.poles.slice(0,7)}…`:''})`);
    requestAnimationFrame(()=>{
      map.invalidateSize();
      if (STATE.bounds && STATE.bounds.isValid()) map.fitBounds(STATE.bounds.pad(0.15), { animate:false });
    });
    if (watchForGithubUpdates !== undefined) {
      STATE.watcherStop = watchForGithubUpdates(({ poles, permits, byKey, shas })=>{
        STATE.poles=poles; STATE.permits=permits; STATE.byKey=byKey; STATE.shas=shas;
        renderAll(STATE.filtered);
        toast(`Auto-updated @ ${shas.poles.slice(0,7)}…`);
      }, 60000);
    }
  }catch(e){
    console.error(e);
    toast('Error loading data. Place neo-map next to poles.json & permits.json', 4500);
  }
})();
