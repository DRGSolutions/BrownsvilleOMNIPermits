import { loadData, idxPermitsByPole, latestStatusFor } from './data.js';
import { initFilterUI, buildPredicate } from './filters.js';
import { initMap, drawMarkers, drawJobBoundaries, renderLegendStatuses } from './map.js';
import { wireUI, renderReport, toggleReport, showToast, fillDetails } from './ui.js';

let ALL_POLES=[], ALL_PERMITS=[];
let PERMITS_BY_KEY = new Map();
let POLE_CTX = [];     // { pole, permits[], latestStatus }
let GROUPS = new Map();// job_name => [[lat,lon]...]
let SHOW_BOUNDARIES = true;

function recomputeContexts(){
  PERMITS_BY_KEY = idxPermitsByPole(ALL_PERMITS);
  POLE_CTX = (ALL_POLES||[]).map(p=>{
    const key = `${p.job_name}::${p.tag}::${p.SCID}`;
    const rel = PERMITS_BY_KEY.get(key) || [];
    return { pole:p, permits:rel, latestStatus: latestStatusFor(rel) };
  });
  // groups for boundaries
  GROUPS = new Map();
  for(const ctx of POLE_CTX){
    const a = GROUPS.get(ctx.pole.job_name) || [];
    a.push([+ctx.pole.lat, +ctx.pole.lon]);
    GROUPS.set(ctx.pole.job_name, a);
  }
}

function computeCounts(ctxs){
  const statusCounts = {};
  const ownerCounts = {};
  for(const c of ctxs){
    statusCounts[c.latestStatus] = (statusCounts[c.latestStatus]||0)+1;
    ownerCounts[c.pole.owner] = (ownerCounts[c.pole.owner]||0)+1;
  }
  // ensure standard keys appear even if zero
  for (const s of ['Approved','Submitted - Pending','Created - NOT Submitted','Not Approved - Cannot Attach','Not Approved - PLA Issues','Not Approved - MRE Issues','Not Approved - Other Issues','NONE']){
    statusCounts[s] = statusCounts[s] || 0;
  }
  return { statusCounts, ownerCounts };
}

function applyFilter(filter){
  const pred = buildPredicate(filter);
  const filtered = POLE_CTX.filter(ctx => pred({ 
    pole: ctx.pole, permits: ctx.permits, latestStatus: ctx.latestStatus 
  }));

  // map
  drawMarkers(filtered);

  // boundaries
  const mapGroups = new Map();
  for(const ctx of filtered){
    const k = ctx.pole.job_name;
    if(!mapGroups.has(k)) mapGroups.set(k, []);
    mapGroups.get(k).push([+ctx.pole.lat, +ctx.pole.lon]);
  }
  drawJobBoundaries(mapGroups, SHOW_BOUNDARIES);

  // legend + report
  const { statusCounts, ownerCounts } = computeCounts(filtered);
  renderLegendStatuses(statusCounts);
  renderReport({ poles: filtered.map(x=>x.pole), groups: mapGroups, statusCounts, ownerCounts });

  // default details (first)
  if (filtered[0]) fillDetails(filtered[0]);
}

async function main(){
  initMap();
  try{
    const { poles, permits } = await loadData();
    ALL_POLES = poles || [];
    ALL_PERMITS = permits || [];
    recomputeContexts();

    // Filter UI: collect status values observed + add NORMATIVE order
    const statusSet = new Set(ALL_PERMITS.map(r=>r.permit_status));
    ['Created - NOT Submitted','Submitted - Pending','Approved','Not Approved - Cannot Attach','Not Approved - PLA Issues','Not Approved - MRE Issues','Not Approved - Other Issues','NONE'].forEach(s=>statusSet.add(s));
    initFilterUI({ poles: ALL_POLES, permits: ALL_PERMITS, statuses: Array.from(statusSet) }, applyFilter);

    // Wire toggles
    wireUI({
      onToggleBoundaries: (on)=>{ SHOW_BOUNDARIES = on; applyFilter(null); },
      onReportToggle: ()=> toggleReport(document.getElementById('report').classList.contains('hidden'))
    });

    // Initial render (no filters)
    applyFilter(null);
    showToast('Data loaded');
  } catch(e){
    console.error(e);
    showToast(`Load error: ${e.message}`);
  }
}

// Legend checkbox toggling uses applyFilter(null) to re-evaluate
document.getElementById('toggleBoundaries').addEventListener('change', ()=> applyFilter(null));
document.getElementById('btnApplyRules').addEventListener('click', ()=> {/* handled in filters.js via callback */});

main();
