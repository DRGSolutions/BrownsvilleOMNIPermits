import { loadPolesAndPermits, poleKey, statusColor, watchForGithubUpdates } from './data.js';
import { buildMarkers } from './markers.js';
import { buildJobAreas } from './areas.js';
import { ruleRow, readRules, matchRule } from './filters.js';
import { popupHTML, toast } from './ui.js';
import { openReport, closeReport } from './report.js';

const STATE = { poles:[], permits:[], byKey:new Map(), cluster:null, areas:[], areasVisible:true, bounds:null, shas:{poles:null,permits:null}, watcherStop:null };

const map = L.map('map', { zoomControl:false, preferCanvas:true });
L.control.zoom({ position:'bottomright' }).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution:'© OpenStreetMap © CARTO' }).addTo(map);

/* ───────────────────────────── VIEW PERSISTENCE ───────────────────────────── */
const VIEW_KEY = 'neo-map:view';
function saveView(m){
  try{
    if(!m || !m._loaded) return;
    const c = m.getCenter(), z = m.getZoom();
    localStorage.setItem(VIEW_KEY, JSON.stringify({lat:c.lat, lng:c.lng, zoom:z}));
  }catch{}
}
function readSavedView(){
  try{ const s = localStorage.getItem(VIEW_KEY); return s ? JSON.parse(s) : null; }catch{ return null; }
}
// restore saved view if available (no animation)
(() => {
  const saved = readSavedView();
  if (saved) map.setView([saved.lat, saved.lng], saved.zoom, { animate:false });
})();
map.on('moveend zoomend', () => saveView(map));
window.addEventListener('resize', () => map.invalidateSize());

/* ========= Cluster coloring by dominant permit status (worst → best) ========= */
const STATUS_ORDER = [
  s => String(s||'').startsWith('Not Approved -'),
  s => s === 'Submitted - Pending',
  s => s === 'Created - NOT Submitted',
  s => s === 'Approved',
  s => s === 'NONE'
];

function pickDominantStatus(markers){
  const all = markers.map(m => m.options.__status || 'NONE');
  const buckets = new Map();
  for (const s of all){
    const key = String(s||'').startsWith('Not Approved -') ? 'Not Approved - *' : s;
    buckets.set(key, (buckets.get(key)||0)+1);
  }
  for (const pred of STATUS_ORDER){
    let bestKey=null, bestCount=-1;
    for (const [k,c] of buckets.entries()){
      if (pred(k) && c>bestCount){ bestKey=k; bestCount=c; }
    }
    if (bestKey) return bestKey === 'Not Approved - *' ? 'Not Approved - Other Issues' : bestKey;
  }
  return 'NONE';
}

// cluster instance
STATE.cluster = L.markerClusterGroup({
  disableClusteringAtZoom: 18,
  spiderfyOnMaxZoom: true,
  iconCreateFunction: (cluster)=>{
    const markers = cluster.getAllChildMarkers();
    const domStatus = pickDominantStatus(markers);
    const col = statusColor(domStatus);
    const count = cluster.getChildCount();
    const html = `
      <div class="cluster-ring" style="background:${col};">
        <div class="cluster-core">${count}</div>
      </div>`;
    return L.divIcon({ html, className:'cluster neon', iconSize:[44,44] });
  }
});
map.addLayer(STATE.cluster);

/* ============================= Rendering ============================= */
function renderAll(filtered=null){
  STATE.bounds = buildMarkers(map, STATE.cluster, filtered||STATE.poles, STATE.byKey, popupHTML);
  if (STATE.areas.length){
    for(const a of STATE.areas){ map.removeLayer(a.layer); a.glow && map.removeLayer(a.glow); map.removeLayer(a.label); }
    STATE.areas=[];
  }
  if (STATE.areasVisible){
    const inView = filtered||STATE.poles;
    STATE.areas = buildJobAreas(map, inView);
  }
}

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
      const hits = spec.rules.map(r=> matchRule(p,r,rel));
      return spec.logic==='AND' ? hits.every(Boolean) : hits.some(Boolean);
    }
    return true;
  });
  renderAll(result);
}

/* ============================= UI wiring ============================= */
document.getElementById('btnAddRule').addEventListener('click', ()=> {
  document.getElementById('rules').appendChild(ruleRow());
});
document.getElementById('btnApply').addEventListener('click', applyFilters);
document.getElementById('btnClear').addEventListener('click', ()=>{
  document.getElementById('qOwner').value='';
  document.getElementById('qStatus').value='';
  document.getElementById('qSearch').value='';
  document.getElementById('rules').innerHTML='';
  renderAll();
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
    for(const a of STATE.areas){ map.removeLayer(a.layer); a.glow && map.removeLayer(a.glow); map.removeLayer(a.label); }
  } else {
    STATE.areas = buildJobAreas(map, STATE.poles);
  }
  toast(STATE.areasVisible ? 'Job areas ON' : 'Job areas OFF', 900);
});

// Manual refresh
const btnRefresh = document.getElementById('btnRefresh');
if (btnRefresh) {
  btnRefresh.addEventListener('click', async ()=>{
    try{
      toast('Refreshing data…');

      // preserve view
      const prev = { center: map.getCenter(), zoom: map.getZoom() };

      const { poles, permits, byKey, shas, source } = await loadPolesAndPermits();
      STATE.poles=poles; STATE.permits=permits; STATE.byKey=byKey; STATE.shas=shas;
      renderAll();

      requestAnimationFrame(()=>{
        map.setView(prev.center, prev.zoom, { animate:false });
        saveView(map);
      });

      // ensure legend/tools tweaks remain in place
      tuneLegendAndTools();

      toast(`Data refreshed (${source}${shas.poles?` @ ${shas.poles.slice(0,7)}…`:''})`);
    }catch(e){
      console.error(e);
      toast('Refresh failed');
    }
  });
}

/* ============================= Insights wiring ============================= */
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

  const counts = {
    jobs: Object.keys(byJob).length,
    polesPerJobMedian,
    byJob,
    naByJob
  };

  openReport({ poles: enriched, permits: STATE.permits, counts, ownerCounts, statusCounts });
});

document.getElementById('btnReportClose')?.addEventListener('click', ()=> closeReport());

/* ───────────────────── Legend + Tools fine-tuning (DOM-safe) ───────────────── */
function tuneLegendAndTools(){
  try {
    const legend = document.querySelector('#legend, .legend');
    if (legend){
      // Clean up anything my earlier attempt might have injected
      legend.querySelectorAll('.shape-icon').forEach(n => n.remove());
      legend.querySelectorAll('[style]').forEach(el => {
        if (el.style.transform && /rotate\(/.test(el.style.transform)) {
          // remove ONLY rotate(), keep other transforms if present
          el.style.transform = el.style.transform.replace(/rotate\([^)]*\)/g,'').trim();
          if (!el.style.transform) el.style.removeProperty('transform');
        }
      });
      const oldCss = document.getElementById('legend-shape-css');
      if (oldCss) oldCss.remove();

      // Find the MVEC row strictly inside the legend (don’t grab wrappers)
      const rows = Array.from(legend.querySelectorAll('*'))
        .filter(el => el.children && el.children.length && /\bMVEC\b/i.test(el.textContent || ''));

      // pick the *innermost* row that actually contains the MVEC label
      let mvecRow = null;
      for (const el of rows){
        const txt = (el.textContent || '').trim();
        const parentTxt = (el.parentElement?.textContent || '').trim();
        if (/\bMVEC\b/i.test(txt) && (!parentTxt || parentTxt.length > txt.length)) { mvecRow = el; break; }
      }
      if (!mvecRow) mvecRow = rows[0];

      if (mvecRow){
        // The shape element is usually the first small box/span before the text
        let shape = mvecRow.querySelector('.shape, .legend-shape, .icon, .swatch, span, i, b');
        if (!shape || /MVEC/i.test(shape.textContent || '')) {
          // If we didn’t find a proper shape node, create one right before the label text
          shape = document.createElement('span');
          shape.className = 'legend-shape';
          mvecRow.insertBefore(shape, mvecRow.firstChild);
        }

        // Sample style (size/border/fill) from the BPUB shape so MVEC matches *exactly*
        let size = 22, borderWidth = '3px', borderColor = 'rgba(255,255,255,0.92)', fill = null;
        const bpubRow = Array.from(legend.querySelectorAll('*')).find(el => /\bBPUB\b/i.test(el.textContent || ''));
        if (bpubRow){
          const sample = bpubRow.querySelector('.shape, .legend-shape, .icon, .swatch, span, i, b') || null;
          if (sample){
            const cs = getComputedStyle(sample);
            const w = parseFloat(cs.width), h = parseFloat(cs.height);
            if (w > 0 && h > 0) size = Math.round(Math.min(w,h));
            if (cs.borderTopWidth && cs.borderTopWidth !== '0px') borderWidth = cs.borderTopWidth;
            if (cs.borderTopColor) borderColor = cs.borderTopColor;
            if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') fill = cs.backgroundColor;
          }
        }
        if (!fill) {
          // reasonable fallback to your original fill tone
          fill = 'rgba(148, 160, 180, 0.65)';
        }

        // Build a diamond INSIDE the shape box (so we don’t rotate containers or text)
        shape.innerHTML = '';
        shape.style.display = 'inline-block';
        shape.style.width = `${size}px`;
        shape.style.height = `${size}px`;
        shape.style.marginRight = '10px';
        shape.style.position = 'relative';
        shape.style.border = '';           // keep container clean
        shape.style.background = 'transparent';
        shape.style.borderRadius = '';     // box itself unstyled

        const diamond = document.createElement('span');
        diamond.style.display = 'block';
        diamond.style.width = '100%';
        diamond.style.height = '100%';
        diamond.style.background = fill;
        diamond.style.border = `${borderWidth} solid ${borderColor}`;
        diamond.style.borderRadius = '6px';
        diamond.style.transform = 'rotate(45deg)';
        diamond.style.transformOrigin = '50% 50%';
        shape.appendChild(diamond);
      }
    }

    // Map Tools copy: keep it short & professional
    const tools = document.querySelector('#tools, .tools');
    if (tools){
      const paras = Array.from(tools.querySelectorAll('p, .note, .muted, small'));
      const long = paras.find(p => /concave hull/i.test((p.textContent||'')));
      if (long) long.textContent = 'Click a shape to view pole & permits.';
    }
  } catch (e) {
    console.warn('[neo-map] legend/tools tune failed:', e);
  }
}

/* =============================== Boot =============================== */
(async function(){
  try{
    toast('Loading poles & permits…');
    const { poles, permits, byKey, shas, source } = await loadPolesAndPermits();
    STATE.poles=poles; STATE.permits=permits; STATE.byKey=byKey; STATE.shas=shas;
    renderAll();
    // keep current view + UI polish
    saveView(map);
    tuneLegendAndTools();

    toast(`Loaded ${poles.length} poles, ${permits.length} permits (${source}${shas.poles?` @ ${shas.poles.slice(0,7)}…`:''})`);

    // start GH SHA watcher if configured
    if (watchForGithubUpdates !== undefined) {
      STATE.watcherStop = watchForGithubUpdates(({ poles, permits, byKey, shas })=>{
        // preserve view across auto-refresh
        const prev = { center: map.getCenter(), zoom: map.getZoom() };

        STATE.poles=poles; STATE.permits=permits; STATE.byKey=byKey; STATE.shas=shas;
        renderAll();

        requestAnimationFrame(()=>{
          map.setView(prev.center, prev.zoom, { animate:false });
          saveView(map);
          tuneLegendAndTools();
        });

        toast(`Auto-updated @ ${shas.poles.slice(0,7)}…`);
      }, 60000); // check every 60s
    }
  }catch(e){
    console.error(e);
    toast('Error loading data. Place neo-map next to poles.json & permits.json', 4500);
  }
})();
