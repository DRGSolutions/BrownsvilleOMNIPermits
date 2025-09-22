import { loadPolesAndPermits, poleKey, statusColor, watchForGithubUpdates } from './data.js';
import { buildMarkers } from './markers.js';
import { buildJobAreas } from './areas.js';
import { ruleRow, readRules, matchRule } from './filters.js';
import { popupHTML, toast } from './ui.js';
import { openReport, closeReport } from './report.js';

const STATE = {
  poles: [],
  permits: [],
  byKey: new Map(),
  cluster: null,
  areas: [],
  areasVisible: true,
  bounds: null,
  shas: { poles: null, permits: null },
  watcherStop: null
};

const map = L.map('map', { zoomControl: false, preferCanvas: true });
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '© OpenStreetMap © CARTO'
}).addTo(map);

/* ========= Cluster coloring by dominant permit status (worst → best) ========= */
const STATUS_ORDER = [
  s => String(s || '').startsWith('Not Approved -'),
  s => s === 'Submitted - Pending',
  s => s === 'Created - NOT Submitted',
  s => s === 'Approved',
  s => s === 'NONE'
];

function pickDominantStatus(markers) {
  const all = markers.map(m => m.options.__status || 'NONE');
  const buckets = new Map();
  for (const s of all) {
    const key = String(s || '').startsWith('Not Approved -') ? 'Not Approved - *' : s;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  for (const pred of STATUS_ORDER) {
    let bestKey = null, bestCount = -1;
    for (const [k, c] of buckets.entries()) {
      if (pred(k) && c > bestCount) { bestKey = k; bestCount = c; }
    }
    if (bestKey) return bestKey === 'Not Approved - *' ? 'Not Approved - Other Issues' : bestKey;
  }
  return 'NONE';
}

// cluster instance
STATE.cluster = L.markerClusterGroup({
  disableClusteringAtZoom: 18,
  spiderfyOnMaxZoom: true,
  iconCreateFunction: (cluster) => {
    const markers = cluster.getAllChildMarkers();
    const domStatus = pickDominantStatus(markers);
    const col = statusColor(domStatus);
    const count = cluster.getChildCount();
    const html = `
      <div class="cluster-ring" style="background:${col};">
        <div class="cluster-core">${count}</div>
      </div>`;
    return L.divIcon({ html, className: 'cluster neon', iconSize: [44, 44] });
  }
});
map.addLayer(STATE.cluster);

/* ===== Purge any leftover non-clickable badges (from older builds) ===== */
function purgeNonClickableBadges() {
  try {
    const toRemove = [];
    map.eachLayer((l) => {
      if (l instanceof L.Marker) {
        const icon = l.options?.icon?.options || {};
        const cls = String(icon.className || '');
        const html = String(icon.html || '');
        const interactive = l.options?.interactive !== false; // true if undefined
        // Heuristics: old badges used these classes OR were non-interactive markers.
        if (!interactive || /area-badge|badge/i.test(cls) || /area-badge/i.test(html)) {
          toRemove.push(l);
        }
      }
    });
    toRemove.forEach(l => map.removeLayer(l));
    // Belt & suspenders: remove stray DOM nodes if any were injected directly
    document.querySelectorAll('.area-badge, .area-badge-ic').forEach(n => n.remove());
  } catch {}
}

/* ============================= Rendering ============================= */
function renderAll(filtered = null) {
  // markers
  STATE.bounds = buildMarkers(map, STATE.cluster, filtered || STATE.poles, STATE.byKey, popupHTML);

  // clear old areas
  if (STATE.areas.length) {
    for (const a of STATE.areas) {
      if (a.layer) map.removeLayer(a.layer);
      if (a.glow) map.removeLayer(a.glow);
      if (a.label) map.removeLayer(a.label);
    }
    STATE.areas = [];
  }

  // rebuild areas
  if (STATE.areasVisible) {
    const inView = filtered || STATE.poles;
    STATE.areas = buildJobAreas(map, inView, STATE.byKey);
  }

  // hard-remove any legacy, non-clickable badges
  purgeNonClickableBadges();
}

function applyFilters() {
  const spec = readRules();
  const result = STATE.poles.filter(p => {
    const rel = STATE.byKey.get(poleKey(p)) || [];
    const q = spec.q;
    if (q.owner && p.owner !== q.owner) return false;
    if (q.status) {
      if (q.status === 'NONE') { if (rel.length !== 0) return false; }
      else if (!rel.some(r => r.permit_status === q.status)) return false;
    }
    if (q.search) {
      const hay = `${p.job_name} ${p.tag} ${p.SCID} ${p.owner} ${p.mr_level}`.toLowerCase();
      if (!hay.includes(q.search)) return false;
    }
    if (spec.rules.length) {
      const hits = spec.rules.map(r => matchRule(p, r, rel));
      return spec.logic === 'AND' ? hits.every(Boolean) : hits.some(Boolean);
    }
    return true;
  });
  renderAll(result);
}

/* ============================= UI wiring ============================= */
document.getElementById('btnAddRule').addEventListener('click', () => {
  document.getElementById('rules').appendChild(ruleRow());
});
document.getElementById('btnApply').addEventListener('click', applyFilters);
document.getElementById('btnClear').addEventListener('click', () => {
  document.getElementById('qOwner').value = '';
  document.getElementById('qStatus').value = '';
  document.getElementById('qSearch').value = '';
  document.getElementById('rules').innerHTML = '';
  renderAll();
});
document.getElementById('qOwner').addEventListener('change', applyFilters);
document.getElementById('qStatus').addEventListener('change', applyFilters);
document.getElementById('qSearch').addEventListener('input', () => {
  clearTimeout(window.__qT); window.__qT = setTimeout(applyFilters, 220);
});

document.getElementById('btnFit').addEventListener('click', () => {
  if (STATE.bounds) map.fitBounds(STATE.bounds.pad(0.15));
});
document.getElementById('btnToggleAreas').addEventListener('click', () => {
  STATE.areasVisible = !STATE.areasVisible;
  if (!STATE.areasVisible) {
    for (const a of STATE.areas) {
      if (a.layer) map.removeLayer(a.layer);
      if (a.glow) map.removeLayer(a.glow);
      if (a.label) map.removeLayer(a.label);
    }
    STATE.areas = [];
  } else {
    STATE.areas = buildJobAreas(map, STATE.poles, STATE.byKey);
  }
  purgeNonClickableBadges();
  toast(STATE.areasVisible ? 'Job areas ON' : 'Job areas OFF', 900);
});

// manual refresh
const btnRefresh = document.getElementById('btnRefresh');
if (btnRefresh) {
  btnRefresh.addEventListener('click', async () => {
    try {
      toast('Refreshing data…');
      const { poles, permits, byKey, shas, source } = await loadPolesAndPermits();
      STATE.poles = poles; STATE.permits = permits; STATE.byKey = byKey; STATE.shas = shas;
      renderAll();

      requestAnimationFrame(() => {
        map.invalidateSize();
        if (STATE.bounds && STATE.bounds.isValid()) map.fitBounds(STATE.bounds.pad(0.15), { animate: false });
      });

      toast(`Data refreshed (${source}${shas.poles ? ` @ ${shas.poles.slice(0, 7)}…` : ''})`);
    } catch (e) {
      console.error(e);
      toast('Refresh failed');
    }
  });
}

/* ============================= Insights wiring ============================= */
document.getElementById('btnReport')?.addEventListener('click', () => {
  const { poles, permits, byKey } = STATE;
  const enriched = poles.map(p => ({ ...p, __hasPermit: (byKey.get(poleKey(p)) || []).length > 0 }));

  const statusCounts = {
    'Approved': 0, 'Submitted - Pending': 0, 'Created - NOT Submitted': 0,
    'Not Approved - Cannot Attach': 0, 'Not Approved - PLA Issues': 0, 'Not Approved - MRE Issues': 0, 'Not Approved - Other Issues': 0,
    'NONE': 0
  };
  const ownerCounts = {};
  const byJob = {};
  const naByJob = {};

  for (const p of enriched) {
    ownerCounts[p.owner] = (ownerCounts[p.owner] || 0) + 1;
    byJob[p.job_name] = (byJob[p.job_name] || 0) + 1;

    const rel = byKey.get(poleKey(p)) || [];
    if (!rel.length) { statusCounts['NONE']++; continue; }
    const ss = rel.map(r => String(r.permit_status || ''));
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
    for (const pred of order) { const hit = ss.find(pred); if (hit) { chosen = hit; break; } }
    statusCounts[chosen] = (statusCounts[chosen] || 0) + 1;
    if (chosen.startsWith('Not Approved -')) naByJob[p.job_name] = (naByJob[p.job_name] || 0) + 1;
  }

  const polesPerJob = Object.values(byJob).sort((a, b) => a - b);
  const mid = Math.floor(polesPerJob.length / 2);
  const polesPerJobMedian = polesPerJob.length ? (polesPerJob.length % 2 ? polesPerJob[mid] : Math.round((polesPerJob[mid - 1] + polesPerJob[mid]) / 2)) : 0;

  const counts = { jobs: Object.keys(byJob).length, polesPerJobMedian, byJob, naByJob };

  openReport({ poles: enriched, permits: STATE.permits, counts, ownerCounts, statusCounts });
});

document.getElementById('btnReportClose')?.addEventListener('click', () => closeReport());

/* =============================== Boot =============================== */
(async function () {
  try {
    toast('Loading poles & permits…');
    const { poles, permits, byKey, shas, source } = await loadPolesAndPermits();
    STATE.poles = poles; STATE.permits = permits; STATE.byKey = byKey; STATE.shas = shas;
    renderAll();
    toast(`Loaded ${poles.length} poles, ${permits.length} permits (${source}${shas.poles ? ` @ ${shas.poles.slice(0, 7)}…` : ''})`);

    requestAnimationFrame(() => {
      map.invalidateSize();
      if (STATE.bounds && STATE.bounds.isValid()) map.fitBounds(STATE.bounds.pad(0.15), { animate: false });
    });

    if (watchForGithubUpdates !== undefined) {
      STATE.watcherStop = watchForGithubUpdates(({ poles, permits, byKey, shas }) => {
        STATE.poles = poles; STATE.permits = permits; STATE.byKey = byKey; STATE.shas = shas;
        renderAll();
        toast(`Auto-updated @ ${shas.poles.slice(0, 7)}…`);
      }, 60000);
    }
  } catch (e) {
    console.error(e);
    toast('Error loading data. Place neo-map next to poles.json & permits.json', 4500);
  }
})();
