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
    if (!legend) return;

    // Clean up any previous injected bits from older attempts
    legend.querySelectorAll('.shape-icon').forEach(n => n.remove());

    // --- Reference size: read the "Approved" chip to size utility icons a bit smaller
    let chipPx = 20, approvedSwatch = null;
    const approvedRow = Array.from(legend.querySelectorAll('*')).find(el => /\bApproved\b/i.test(el.textContent || ''));
    if (approvedRow){
      approvedSwatch = Array.from(approvedRow.querySelectorAll('i,b,span,em,div,.swatch,.chip,.color,.dot'))
        .find(e => {
          const cs = getComputedStyle(e); const w = parseFloat(cs.width), h = parseFloat(cs.height);
          return w>8 && w<40 && Math.abs(w-h)<3; // small square-ish chip
        }) || null;
      if (approvedSwatch){
        const cs = getComputedStyle(approvedSwatch);
        chipPx = Math.round(Math.min(parseFloat(cs.width)||20, parseFloat(cs.height)||20));
        // Restore Approved color if needed
        const desired = (getComputedStyle(document.documentElement).getPropertyValue('--chip-approved') || '').trim() || '#34d399';
        approvedSwatch.style.backgroundColor = desired;
        approvedSwatch.style.borderColor = desired;
      }
    }
    const ICON_PX = Math.max(14, Math.round(chipPx * 0.85)); // a touch smaller than status chips

    // Shared paint constants (match your existing legend look)
    const fillColor   = 'rgba(148,160,180,0.65)';      // soft slate fill
    const borderColor = 'rgba(255,255,255,0.92)';      // white-ish outline
    const borderW     = 3;
    const cornerR     = 6;

    // Helper: find the legend row for a label, get or create the leading shape holder
    function getRowAndHolder(labelRe){
      const row = Array.from(legend.querySelectorAll('*')).find(el => labelRe.test((el.textContent || '').trim()));
      if (!row) return { row:null, holder:null };
      // Prefer to reuse an existing small square/shape element before the text if present
      let holder = Array.from(row.children).find(ch => {
        const cs = getComputedStyle(ch); const w = parseFloat(cs.width), h = parseFloat(cs.height);
        return w>8 && w<40 && Math.abs(w-h)<3;
      });
      if (!holder){
        holder = document.createElement('span');
        row.insertBefore(holder, row.firstChild);
      } else {
        holder.innerHTML = ''; // repurpose it cleanly
      }
      holder.className = 'shape-icon';
      Object.assign(holder.style, {
        display:'inline-block', position:'relative', width:ICON_PX+'px', height:ICON_PX+'px',
        marginRight:'10px', verticalAlign:'middle'
      });
      return { row, holder };
    }

    // BPUB: circle
    {
      const { holder } = getRowAndHolder(/\bBPUB\b/i);
      if (holder){
        const circle = document.createElement('span');
        Object.assign(circle.style, {
          position:'absolute', inset:'0',
          border:`${borderW}px solid ${borderColor}`,
          borderRadius:'9999px',
          background: fillColor
        });
        holder.appendChild(circle);
      }
    }

    // AEP: triangle (SVG to keep edges crisp at small size)
    {
      const { holder } = getRowAndHolder(/\bAEP\b/i);
      if (holder){
        const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
        svg.setAttribute('viewBox','0 0 24 24');
        svg.style.width = ICON_PX+'px';
        svg.style.height = ICON_PX+'px';
        const poly = document.createElementNS('http://www.w3.org/2000/svg','polygon');
        poly.setAttribute('points','12,3 21,21 3,21');
        poly.setAttribute('fill', fillColor);
        poly.setAttribute('stroke', borderColor);
        poly.setAttribute('stroke-width', borderW);
        svg.appendChild(poly);
        holder.appendChild(svg);
      }
    }

    // MVEC: diamond from TWO smaller triangles + a thin rotated border overlay
    {
      const { holder } = getRowAndHolder(/\bMVEC\b/i);
      if (holder){
        const half = Math.floor(ICON_PX / 2);

        // Top triangle
        const top = document.createElement('div');
        Object.assign(top.style, {
          position:'absolute', left:'50%', transform:'translateX(-50%)',
          width:'0', height:'0',
          borderLeft:`${half}px solid transparent`,
          borderRight:`${half}px solid transparent`,
          borderBottom:`${half}px solid ${fillColor}`,
          top:'0'
        });
        // Bottom triangle
        const bot = document.createElement('div');
        Object.assign(bot.style, {
          position:'absolute', left:'50%', transform:'translateX(-50%)',
          width:'0', height:'0',
          borderLeft:`${half}px solid transparent`,
          borderRight:`${half}px solid transparent`,
          borderTop:`${half}px solid ${fillColor}`,
          bottom:'0'
        });

        // Thin diamond border (rotated inner element only; does NOT affect layout/text)
        const border = document.createElement('span');
        Object.assign(border.style, {
          position:'absolute', left:'0', top:'0', right:'0', bottom:'0',
          transform:'rotate(45deg)', transformOrigin:'50% 50%',
          border:`${borderW}px solid ${borderColor}`,
          borderRadius: `${cornerR}px`
        });

        holder.appendChild(top);
        holder.appendChild(bot);
        holder.appendChild(border);
      }
    }

    // Slightly tighten the legend’s vertical rhythm
    legend.style.lineHeight = '1.15';

    // --- Map Tools: keep short/pro
    const tools = document.querySelector('#tools, .tools');
    if (tools){
      const paras = Array.from(tools.querySelectorAll('p, .note, .muted, small'));
      const long = paras.find(p => /concave hull/i.test((p.textContent||'')));
      if (long) long.textContent = 'Click a shape to view pole & permits.';
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
