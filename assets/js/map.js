// assets/js/map.js
(function(){
  const CFG = window.APP_CONFIG || {};

  const $ = (s) => document.querySelector(s);
  const qs = new URLSearchParams(location.search);
  const JOB = qs.get('job') || '';

  // Show job name
  const jobEl = $('#jobName'); if (jobEl) jobEl.textContent = JOB ? `Job: ${JOB}` : 'Job: —';

  // --- GitHub data loader (commit -> branch fallback, same as app.js) ---
  async function getLatestSha() {
    const url = `https://api.github.com/repos/${CFG.OWNER}/${CFG.REPO}/commits/${CFG.DEFAULT_BRANCH}?_=${Date.now()}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`GitHub API ${r.status} (latest commit)`);
    const j = await r.json();
    return j.sha;
  }
  async function fetchJson(url) {
    const r = await fetch(url, { cache: 'no-store' });
    return { ok: r.ok, status: r.status, json: r.ok ? await r.json() : null, url };
  }
  async function tryLoadBases(bases) {
    const bust = `?ts=${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const errors = [];
    for (const base of bases) {
      const p1 = await fetchJson(`${base}/poles.json${bust}`);
      const p2 = await fetchJson(`${base}/permits.json${bust}`);
      if (p1.ok && p2.ok) return { poles: p1.json, permits: p2.json, base };
      if (!p1.ok) errors.push(`poles.json ${p1.status} @ ${p1.url}`);
      if (!p2.ok) errors.push(`permits.json ${p2.status} @ ${p2.url}`);
    }
    throw new Error(errors.slice(-1)[0] || 'Unknown fetch error');
  }
  async function loadData() {
    let result = null;
    const dirs = Array.from(new Set([CFG.DATA_DIR, 'docs/data', 'data'].filter(Boolean)));
    try {
      const sha = await getLatestSha();
      const bases = dirs.map(d => `https://raw.githubusercontent.com/${CFG.OWNER}/${CFG.REPO}/${sha}/${d}`);
      result = await tryLoadBases(bases);
    } catch { /* fall back below */ }
    if (!result) {
      const bases = dirs.map(d => `https://raw.githubusercontent.com/${CFG.OWNER}/${CFG.REPO}/${CFG.DEFAULT_BRANCH}/${d}`);
      result = await tryLoadBases(bases);
    }
    return result; // {poles, permits, base}
  }

  // --- API helper (same headers semantics as app.js) ---
  async function callApi(payload) {
    const API_URL = CFG.API_URL;
    const SHARED_KEY = CFG.SHARED_KEY;
    if (!API_URL) throw new Error('Missing CONFIG.API_URL');
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Permits-Key': SHARED_KEY || '' },
      body: JSON.stringify(payload)
    });
    let data; try { data = await res.json(); } catch { data = { ok:false, error:'Invalid server response' }; }
    if (!res.ok || !data.ok) {
      const details = data && data.details ? `\n${JSON.stringify(data.details, null, 2)}` : '';
      throw new Error((data && data.error) ? (data.error + details) : `HTTP ${res.status}`);
    }
    return data; // { ok:true, pr_url, branch }
  }

  // --- Helpers ---
  function parseMDY(s){
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s||'');
    return m ? new Date(+m[3], +m[1]-1, +m[2]) : null;
  }
  function latestStatusFor(permits){
    if (!permits || !permits.length) return 'NONE';
    const withDates = permits
      .map(r => ({ r, d: parseMDY(r.submitted_at) || new Date(0) }))
      .sort((a,b) => b.d - a.d);
    return (withDates[0].r.permit_status) || 'NONE';
  }
  function statusColor(s){
    switch (String(s)) {
      case 'Approved': return '#34d399';
      case 'Submitted - Pending': return '#fb923c';
      case 'Created - NOT Submitted': return '#facc15';
      case 'Not Approved - Cannot Attach': return '#a78bfa';
      case 'Not Approved - PLA Issues':
      case 'Not Approved - MRE Issues':
      case 'Not Approved - Other Issues': return '#ef4444';
      case 'NONE':
      default: return '#94a3b8';
    }
  }
  function toMDY(inputDateYYYYMMDD){
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(inputDateYYYYMMDD||'');
    return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
  }

  function indexPermitsByPole(permits){
    const map = new Map();
    for (const r of (permits||[])) {
      const key = `${r.job_name}::${r.tag}::${r.SCID}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return map;
  }

  // --- Map UI ---
  let map, pointsLayer, drawn, selectedSet = new Set(), pmap;

  function setupMap(jobPoles, permits){
    map = L.map('map');
    const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    pointsLayer = L.layerGroup().addTo(map);
    drawn = new L.FeatureGroup(); map.addLayer(drawn);
    const drawCtl = new L.Control.Draw({
      draw: { marker:false, circle:false, polyline:false, circlemarker:false },
      edit: { featureGroup: drawn }
    });
    map.addControl(drawCtl);

    // Build permit index
    pmap = indexPermitsByPole(permits);

    // Points
    const bounds = [];
    for (const p of jobPoles) {
      const lat = Number(p.lat), lon = Number(p.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const rel = pmap.get(`${p.job_name}::${p.tag}::${p.SCID}`) || [];
      const color = statusColor(latestStatusFor(rel));

      const m = L.circleMarker([lat, lon], {
        radius: 4, weight: 1, color: '#2a3242', fillColor: color, fillOpacity: 1
      });
      m.bindTooltip(`SCID ${p.SCID} · Tag ${p.tag}`, { permanent:true, direction:'top', opacity:.8 });
      m._pole = p;
      pointsLayer.addLayer(m);
      bounds.push([lat,lon]);
    }
    if (bounds.length) map.fitBounds(bounds, { padding:[40,40] });

    function updateSelection(){
      selectedSet.clear();
      const polys = drawn.toGeoJSON().features.filter(f => f.geometry && f.geometry.type === 'Polygon');
      const markers = Object.values(pointsLayer._layers || {});
      for (const m of markers) {
        const [lat,lon] = [m.getLatLng().lat, m.getLatLng().lng];
        const pt = turf.point([lon, lat]);
        let inside = false;
        for (const poly of polys) {
          if (turf.booleanPointInPolygon(pt, poly)) { inside = true; break; }
        }
        if (inside) selectedSet.add(m);
        // style toggle
        m.setStyle({ radius: inside ? 6 : 4, weight: inside ? 2 : 1 });
      }
      $('#selInfo').textContent = `Selected poles: ${selectedSet.size}`;
    }

    map.on(L.Draw.Event.CREATED, (e) => { drawn.addLayer(e.layer); updateSelection(); });
    map.on(L.Draw.Event.EDITED,  () => updateSelection());
    map.on(L.Draw.Event.DELETED, () => updateSelection());

    $('#btnClear').addEventListener('click', () => { drawn.clearLayers(); updateSelection(); });
  }

  // --- Apply (single PR) ---
  async function onApply(){
    const mode   = ($('#mode')?.value || 'assign');
    const status = ($('#status')?.value || '').trim();
    const by     = ($('#by')?.value || '').trim();
    const dateMDY= toMDY($('#date')?.value || '');
    const baseId = ($('#baseId')?.value || '').trim();

    const msg = (t) => { const el=$('#msg'); if (el) el.innerHTML = t||''; };

    if (!JOB) { msg('<span style="color:#ef4444">This page must be opened from the main app with a Job selected.</span>'); return; }
    if (selectedSet.size === 0) { msg('<span style="color:#ef4444">Draw one or more polygons to select poles first.</span>'); return; }
    if (!status) { msg('<span style="color:#ef4444">Permit Status is required.</span>'); return; }

    if (mode === 'assign') {
      if (!baseId) { msg('<span style="color:#ef4444">Base Permit ID is required for Assign.</span>'); return; }
      if (!by)     { msg('<span style="color:#ef4444">Submitted By is required for Assign.</span>'); return; }
      if (!dateMDY){ msg('<span style="color:#ef4444">Submitted At (date) is required for Assign.</span>'); return; }
    }

    // Build one changes[] batch
    const changes = [];
    const markers = Array.from(selectedSet);
    for (const m of markers) {
      const p = m._pole;
      const key = `${p.job_name}::${p.tag}::${p.SCID}`;
      const rel = pmap.get(key) || [];
      if (mode === 'assign') {
        if (rel.length > 0) continue; // only create on poles with no permits
        const permit_id = `${baseId}_${p.SCID}`;
        changes.push({
          type:'upsert_permit',
          permit:{
            permit_id,
            job_name:p.job_name, tag:p.tag, SCID:p.SCID,
            permit_status: status, submitted_by: by, submitted_at: dateMDY, notes:''
          }
        });
      } else {
        for (const r of rel) {
          changes.push({ type:'update_permit', permit_id: r.permit_id, patch: { permit_status: status } });
        }
      }
    }

    if (changes.length === 0) {
      msg('<span style="color:#34d399">Nothing to do for selected poles.</span>');
      return;
    }

    const btn = $('#btnApply'); if (btn) btn.disabled = true;
    try {
      msg(`Submitting ${changes.length} change(s)…`);
      const data = await callApi({
        actorName: 'Website User',
        reason: `${mode === 'assign' ? 'Map mass assign' : 'Map mass modify'} (${changes.length})`,
        changes
      });
      msg(`<span style="color:#34d399">Submitted ${changes.length} change(s).</span> ` +
          (data.pr_url ? `<a class="link" href="${data.pr_url}" target="_blank" rel="noopener">View PR</a>` : ''));

      // Kick the same overlay/poller on the main page
      if (window.opener && !window.opener.closed) {
        try { window.opener.dispatchEvent(new CustomEvent('watch:start')); } catch {}
      }
    } catch (e) {
      console.error(e);
      msg(`<span style="color:#ef4444">${e.message}</span>`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // --- init ---
  document.addEventListener('DOMContentLoaded', async () => {
    // defaults
    const d = $('#date'); if (d && !d.value) d.valueAsDate = new Date();
    const modeSel = $('#mode');
    const assignOnlyEls = () => document.querySelectorAll('.assign-only');
    const refreshAssignOnly = () => {
      const show = (modeSel.value === 'assign');
      for (const el of assignOnlyEls()) el.style.display = show ? '' : 'none';
    };
    modeSel.addEventListener('change', refreshAssignOnly);
    refreshAssignOnly();

    $('#btnApply').addEventListener('click', onApply);

    if (!JOB) {
      $('#msg').innerHTML = '<span style="color:#ef4444">No Job specified. Open this via “Advanced Map Selection” on the main page.</span>';
      return;
    }

    try {
      const { poles, permits } = await loadData();
      const jobPoles = (poles || []).filter(p => String(p.job_name) === String(JOB));
      setupMap(jobPoles, permits || []);
    } catch (e) {
      $('#msg').innerHTML = `<span style="color:#ef4444">Load error: ${e.message}</span>`;
    }
  });
})();
