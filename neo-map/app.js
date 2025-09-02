import { loadPolesAndPermits, poleKey } from './data.js';
import { buildMarkers } from './markers.js';
import { buildJobAreas } from './areas.js';
import { ruleRow, readRules, matchRule } from './filters.js';
import { popupHTML, toast } from './ui.js';

const STATE = { poles:[], permits:[], byKey:new Map(), cluster:null, areas:[], areasVisible:true, bounds:null };

const map = L.map('map', { zoomControl:false, preferCanvas:true });
L.control.zoom({ position:'bottomright' }).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution:'© OpenStreetMap © CARTO' }).addTo(map);
STATE.cluster = L.markerClusterGroup({ disableClusteringAtZoom:18, spiderfyOnMaxZoom:true });
map.addLayer(STATE.cluster);

function renderAll(filtered=null){
  STATE.bounds = buildMarkers(map, STATE.cluster, filtered||STATE.poles, STATE.byKey, popupHTML);
  if (STATE.areas.length){ for(const a of STATE.areas){ map.removeLayer(a.layer); map.removeLayer(a.label); } STATE.areas=[]; }
  if (STATE.areasVisible){
    // Build areas only for the poles currently shown for contextual clarity
    const inView = filtered||STATE.poles;
    STATE.areas = buildJobAreas(map, inView);
  }
}

/* Filters UI wiring */
document.getElementById('btnAddRule').addEventListener('click', ()=> document.getElementById('rules').appendChild(ruleRow()));
document.getElementById('btnApply').addEventListener('click', applyFilters);
document.getElementById('btnClear').addEventListener('click', ()=>{
  document.getElementById('qOwner').value=''; document.getElementById('qStatus').value=''; document.getElementById('qSearch').value='';
  document.getElementById('rules').innerHTML=''; renderAll();
});
document.getElementById('qOwner').addEventListener('change', applyFilters);
document.getElementById('qStatus').addEventListener('change', applyFilters);
document.getElementById('qSearch').addEventListener('input', ()=>{ clearTimeout(window.__qT); window.__qT=setTimeout(applyFilters,220); });

document.getElementById('btnFit').addEventListener('click', ()=>{ if(STATE.bounds) map.fitBounds(STATE.bounds.pad(0.15)); });
document.getElementById('btnToggleAreas').addEventListener('click', ()=>{
  STATE.areasVisible = !STATE.areasVisible;
  if (!STATE.areasVisible){ for(const a of STATE.areas){ map.removeLayer(a.layer); map.removeLayer(a.label);} }
  else { STATE.areas = buildJobAreas(map, STATE.poles); }
  toast(STATE.areasVisible ? 'Job areas ON' : 'Job areas OFF', 900);
});

function applyFilters(){
  const spec = readRules();
  const result = STATE.poles.filter(p=>{
    // quick
    const q = spec.q, rel = STATE.byKey.get(poleKey(p)) || [];
    if (q.owner && p.owner!==q.owner) return false;
    if (q.status){
      if (q.status==='NONE'){ if (rel.length!==0) return false; }
      else if (!rel.some(r=>r.permit_status===q.status)) return false;
    }
    if (q.search){
      const hay = `${p.job_name} ${p.tag} ${p.SCID} ${p.owner} ${p.mr_level}`.toLowerCase();
      if (!hay.includes(q.search)) return false;
    }
    // advanced
    if (spec.rules.length){
      const hits = spec.rules.map(r=> matchRule(p,r,rel));
      return spec.logic==='AND' ? hits.every(Boolean) : hits.some(Boolean);
    }
    return true;
  });
  renderAll(result);
}

/* Boot */
(async function(){
  try{
    toast('Loading poles & permits…');
    const { poles, permits, byKey } = await loadPolesAndPermits();
    STATE.poles=poles; STATE.permits=permits; STATE.byKey=byKey;
    renderAll();
    toast(`Loaded ${poles.length} poles, ${permits.length} permits`);
  }catch(e){ console.error(e); toast('Error loading data. Place neo-map next to poles.json & permits.json', 4500); }
})();
