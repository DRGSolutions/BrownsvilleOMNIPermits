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
    /* ---------------- Legend: safe redraw of utility shapes ---------------- */
    const legend = document.querySelector('#legend, .legend');
    if (legend){
      // 0) Undo any accidental rotations from earlier versions (safety net)
      legend.querySelectorAll('[style]').forEach(el => {
        if (el.style.transform && /rotate\(/.test(el.style.transform)) el.style.transform = '';
      });

      // 1) Find rows by label text; then inject a small SVG icon at the start.
      const findRow = (re) => {
        const candidates = Array.from(
          legend.querySelectorAll('.legend-item, .row, li, .item, .legend-row, div')
        );
        return candidates.find(el => re.test((el.textContent || '').trim()));
      };

      const ensureIcon = (row) => {
        if (!row) return null;
        // If we already drew one before, reuse it
        let holder = row.querySelector('.shape-icon');
        if (!holder){
          holder = document.createElement('span');
          holder.className = 'shape-icon';
          // place before any text
          if (row.firstChild) row.insertBefore(holder, row.firstChild);
          else row.appendChild(holder);
        }
        return holder;
      };

      const svgCircle = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
        </svg>`;
      const svgTriangle = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <polygon points="12,4 20,20 4,20" />
        </svg>`;
      const svgDiamond = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <polygon points="12,3 21,12 12,21 3,12" />
        </svg>`;

      // Rows
      const rowBPUB = findRow(/\bBPUB\b/i);
      const rowAEP  = findRow(/\bAEP\b/i);
      const rowMVEC = findRow(/\bMVEC\b/i);

      const hBPUB = ensureIcon(rowBPUB);
      const hAEP  = ensureIcon(rowAEP);
      const hMVEC = ensureIcon(rowMVEC);

      if (hBPUB) hBPUB.innerHTML = svgCircle;
      if (hAEP)  hAEP.innerHTML  = svgTriangle;
      if (hMVEC) hMVEC.innerHTML = svgDiamond; // ← diamond for MVEC

      // 2) Hide any pre-existing box/shape elements so we don’t double-render
      [rowBPUB, rowAEP, rowMVEC].forEach(row => {
        if (!row) return;
        const first = row.firstElementChild;
        if (first && !first.classList.contains('shape-icon')) {
          // Heuristic: square-ish element with visible border/background
          const cs = getComputedStyle(first);
          const w = parseFloat(cs.width), h = parseFloat(cs.height);
          const hasBorder = ['borderTopStyle','borderRightStyle','borderBottomStyle','borderLeftStyle']
            .some(k => cs[k] && cs[k] !== 'none');
          if (Math.abs(w - h) < 2 && (hasBorder || cs.backgroundColor !== 'rgba(0, 0, 0, 0)')) {
            first.style.display = 'none';
          }
        }
      });

      // 3) One-time CSS for size/appearance (smaller utility icons)
      if (!document.getElementById('legend-shape-css')) {
        const style = document.createElement('style');
        style.id = 'legend-shape-css';
        style.textContent = `
          /* Utility shape icons: a touch smaller than status chips */
          .legend .shape-icon{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-right:10px;vertical-align:middle}
          .legend .shape-icon svg{width:18px;height:18px;stroke:#fff;fill:none;stroke-width:2.5}
          .legend{line-height:1.15}
        `;
        document.head.appendChild(style);
      }
    }

    /* ---------------- Map Tools: shorten explanatory copy ---------------- */
    const tools = document.querySelector('#tools, .tools');
    if (tools){
      const paras = Array.from(tools.querySelectorAll('p, .note, .muted, small'));
      const long = paras.find(p => /concave hull/i.test((p.textContent||'')));
      if (long) long.textContent = 'Click a shape to view pole & permits.';
      // Tighten spacing if the container supports CSS gap
      const cs = getComputedStyle(tools);
      if (cs.gap && cs.gap !== 'normal') tools.style.gap = '8px';
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
