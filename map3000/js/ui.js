// /map3000/js/ui.js
// Public API:
//   initMap()
//   initState()
//   mountPanels(map, state, CFG, { MARK, AREAS, HEAT, RPT })
//   updateViewMode()

// ---- Map + State ---------------------------------------------------
export function initMap(){
  const map = L.map('map', { zoomControl:false, preferCanvas:true });
  L.control.zoom({ position:'bottomright' }).addTo(map);
  L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    { attribution: '&copy; OpenStreetMap & CARTO' }
  ).addTo(map);
  return map;
}

export function initState(map){
  const state = {
    map,
    poles: [], permits: [], byKey: new Map(),
    cluster: null, singlesLayer: null,
    areas: [], areasVisible: true,
    bounds: null, heat: null,
    ui: {},
    toast(msg, ms=1400){
      const t = document.getElementById('toast');
      if (!t) return;
      t.textContent = msg;
      t.style.display = 'block';
      setTimeout(()=>{ t.style.display='none'; }, ms);
    }
  };
  // Make globally accessible for modules that expect window.state
  window.state = state;
  return state;
}

// ---- UI Panels & Wiring --------------------------------------------
export function mountPanels(map, s, CFG, mods){
  const { MARK, AREAS, HEAT, RPT } = mods;

  // Filters
  document.getElementById('filters').innerHTML = `
    <div class="row" style="justify-content:space-between">
      <h3>Advanced Filters</h3>
      <button id="btnReset" class="btn">Reset</button>
    </div>
    <div class="row">
      <div class="field"><small>Owner</small>
        <select id="qOwner">
          <option value="">All</option>
          <option>BPUB</option>
          <option>AEP</option>
          <option>MVEC</option>
        </select>
      </div>
      <div class="field"><small>Permit Status</small>
        <select id="qStatus">
          <option value="">All</option>
          <option>NONE</option>
          <option>Created - NOT Submitted</option>
          <option>Submitted - Pending</option>
          <option>Approved</option>
          <option>Not Approved - Cannot Attach</option>
          <option>Not Approved - PLA Issues</option>
          <option>Not Approved - MRE Issues</option>
          <option>Not Approved - Other Issues</option>
        </select>
      </div>
      <div class="field" style="flex:1">
        <small>Search</small>
        <input id="qSearch" placeholder="Job, Tag, SCID, MR…"/>
      </div>
    </div>
    <div class="row" style="margin-top:8px">
      <button id="btnApply" class="btn">Apply</button>
    </div>
  `;

  // Legend
  document.getElementById('legend').innerHTML = `
    <h3>Legend</h3>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
      <div>
        <div class="muted" style="margin-bottom:6px;">Utility → Shape</div>
        <div class="item"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#94a3b8" stroke="white" stroke-width="2"/></svg>BPUB (circle)</div>
        <div class="item"><svg viewBox="0 0 24 24"><polygon points="12,4 20,20 4,20" fill="#94a3b8" stroke="white" stroke-width="2"/></svg>AEP (triangle)</div>
        <div class="item"><svg viewBox="0 0 24 24"><polygon points="12,3 21,12 12,21 3,12" fill="#94a3b8" stroke="white" stroke-width="2"/></svg>MVEC (diamond)</div>
      </div>
      <div>
        <div class="muted" style="margin-bottom:6px;">Permit Status → Color</div>
        ${[
          'Approved',
          'Submitted - Pending',
          'Created - NOT Submitted',
          'Not Approved - Cannot Attach',
          'Not Approved - Other Issues',
          'NONE'
        ].map(n=>`<div class="item"><span class="swatch" style="background:${CFG.statusColor(n)}"></span>${n}</div>`).join('')}
      </div>
    </div>
  `;

  // Tools
  document.getElementById('tools').innerHTML = `
    <h3>Map Tools</h3>
    <div class="row">
      <button id="btnFit" class="btn">Fit to Poles</button>
      <button id="btnAreas" class="btn">Toggle Job Areas</button>
      <button id="btnReport" class="btn">Open Visual Report</button>
    </div>
    <div class="row">
      <div class="field"><small>View Mode</small>
        <select id="viewMode">
          <option value="standard">Standard</option>
          <option value="heat">Heatmap (severity-weighted)</option>
          <option value="wire">Wireframe (areas only)</option>
        </select>
      </div>
      <div class="field"><small>Cluster</small>
        <select id="clusterMode">
          <option value="on">ON (status pies)</option>
          <option value="off">OFF (every pole)</option>
        </select>
      </div>
      <div class="field" style="min-width:180px">
        <small>Boundary Strictness</small>
        <input id="strict" type="range" min="1" max="8" value="5" />
      </div>
    </div>
    <small class="muted">Heatmap hides markers so the density pops. Strictness 1 = looser, 8 = tightest boundaries.</small>
  `;

  // Keep references to controls
  s.ui.report      = document.getElementById('report');
  s.ui.clusterMode = document.getElementById('clusterMode');
  s.ui.viewMode    = document.getElementById('viewMode');
  s.ui.strict      = document.getElementById('strict');

  // ---- Buttons
  document.getElementById('btnFit').onclick = () => {
    if (s.bounds) s.map.fitBounds(s.bounds.pad(0.15));
  };

  // *** FIXED: Toggle Job Areas now adds/removes fill + outline + label ***
  document.getElementById('btnAreas').onclick = () => {
    s.areasVisible = !s.areasVisible;
    if (s.areasVisible) {
      s.areas.forEach(a => {
        if (a.fill)    s.map.addLayer(a.fill);
        if (a.outline) s.map.addLayer(a.outline);
        if (a.label)   s.map.addLayer(a.label);
      });
    } else {
      s.areas.forEach(a => {
        if (a.fill)    s.map.removeLayer(a.fill);
        if (a.outline) s.map.removeLayer(a.outline);
        if (a.label)   s.map.removeLayer(a.label);
      });
    }
  };

  document.getElementById('btnReport').onclick = () => mods.RPT.open();

  // ---- Selects
  s.ui.clusterMode.onchange = () => {
    const on = s.ui.clusterMode.value === 'on';
    mods.MARK.render({ cluster: on });
    updateViewMode(); // re-apply view-mode effects
  };

  s.ui.viewMode.onchange = updateViewMode;
  s.ui.strict.oninput = () => { mods.AREAS.rebuild(); updateViewMode(); };

  // ---- Filters
  document.getElementById('btnApply').onclick = applyFilters;
  document.getElementById('btnReset').onclick = () => {
    document.getElementById('qOwner').value  = '';
    document.getElementById('qStatus').value = '';
    document.getElementById('qSearch').value = '';
    mods.MARK.render({ cluster: s.ui.clusterMode.value === 'on' });
    mods.AREAS.rebuild();
    updateViewMode();
  };
  document.getElementById('qSearch').addEventListener('input', () => {
    clearTimeout(window.__qT);
    window.__qT = setTimeout(applyFilters, 200);
  });

  // Expose for other modules (if needed)
  state.applyFilters = applyFilters;

  // ---- Filtering logic (quick filters only – advanced rules are optional)
  function applyFilters(){
    const owner  = document.getElementById('qOwner').value;
    const status = document.getElementById('qStatus').value;
    const search = (document.getElementById('qSearch').value || '').toLowerCase();

    const filtered = s.poles.filter(p => {
      if (owner && p.owner !== owner) return false;

      if (search) {
        const hay = `${p.job_name} ${p.tag} ${p.SCID} ${p.owner} ${p.mr_level}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }

      if (status) {
        const rel = s.byKey.get(`${p.job_name}::${p.tag}::${p.SCID}`) || [];
        if (status === 'NONE') {
          if (rel.length !== 0) return false;
        } else {
          if (!rel.some(r => r.permit_status === status)) return false;
        }
      }
      return true;
    });

    // temporary swap for rendering
    const save = s.poles;
    s.poles = filtered;
    mods.MARK.render({ cluster: s.ui.clusterMode.value === 'on' });
    mods.AREAS.rebuild(filtered);
    s.poles = save;
    updateViewMode();
  }
}

// ---- View Modes ----------------------------------------------------
export function updateViewMode(){
  const s = state;
  const mode = s.ui.viewMode.value;

  // Remove existing heat layer if any
  if (s.heat) { s.map.removeLayer(s.heat); s.heat = null; }

  if (mode === 'heat') {
    // hide markers to make density obvious
    setMarkersVisible(false);
    // build severity-weighted heat (module will compute weights)
    state.toast('Heatmap view');
    // lazy load via HEAT module exposed in app wiring
    import('./heat.js').then(HEAT => HEAT.enter());
    // soften areas slightly but keep visible
    s.areas.forEach(a => a.fill && a.fill.setStyle({ fillOpacity: 0.16, opacity: 0.8 }));
  } else if (mode === 'wire') {
    // hide markers, show only the job borders
    setMarkersVisible(false);
    s.areas.forEach(a => a.fill && a.fill.setStyle({ fillOpacity: 0.22, opacity: 1 }));
  } else {
    // Standard
    setMarkersVisible(true);
    s.areas.forEach(a => a.fill && a.fill.setStyle({ fillOpacity: 0.38, opacity: 0.95 }));
  }
}

function setMarkersVisible(visible){
  const s = state;
  if (visible) {
    const clus = s.ui.clusterMode.value === 'on';
    if (clus) { s.map.addLayer(s.cluster); s.map.removeLayer(s.singlesLayer); }
    else      { s.map.addLayer(s.singlesLayer); s.map.removeLayer(s.cluster); }
  } else {
    s.map.removeLayer(s.cluster);
    s.map.removeLayer(s.singlesLayer);
  }
}
