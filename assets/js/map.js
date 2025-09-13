// assets/js/map.js
(function(){
  const CFG = window.APP_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const qs = new URLSearchParams(location.search);
  const JOB = qs.get('job') || '';
  const bc = ('BroadcastChannel' in window) ? new BroadcastChannel('permits') : null;

  // Header
  $('#jobName').textContent = JOB ? `Job: ${JOB}` : 'Job: —';

  // ---- Data loader (branch-only; no commits API to avoid 403) ----
  async function fetchJson(url) {
    const r = await fetch(url, { cache: 'no-store' });
    return { ok: r.ok, status: r.status, json: r.ok ? await r.json() : null, url };
  }
  async function tryLoadBases(bases) {
    const bust = `?ts=${Date.now()}-${Math.random().toString(36).slice(2)}`;
    for (const base of bases) {
      const p1 = await fetchJson(`${base}/poles.json${bust}`);
      const p2 = await fetchJson(`${base}/permits.json${bust}`);
      if (p1.ok && p2.ok) return { poles: p1.json, permits: p2.json };
    }
    throw new Error('Could not load data');
  }
  async function loadData() {
    const dirs = Array.from(new Set([CFG.DATA_DIR, 'docs/data', 'data'].filter(Boolean)));
    const bases = dirs.map(d => `https://raw.githubusercontent.com/${CFG.OWNER}/${CFG.REPO}/${CFG.DEFAULT_BRANCH}/${d}`);
    return await tryLoadBases(bases);
  }

  // ---- API helper ----
  async function callApi(payload) {
    const res = await fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Permits-Key': CFG.SHARED_KEY || '' },
      body: JSON.stringify(payload)
    });
    let data; try { data = await res.json(); } catch { data = { ok:false, error:'Invalid server response' }; }
    if (!res.ok || !data.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    return data; // { ok:true, pr_url }
  }

  // ---- Helpers ----
  function parseMDY(s){ const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s||''); return m? new Date(+m[3],+m[1]-1,+m[2]) : null; }
  function latestStatusFor(list){
    if (!list || !list.length) return 'NONE';
    return list.map(r => ({r, d: parseMDY(r.submitted_at)||new Date(0)})).sort((a,b)=>b.d-a.d)[0].r.permit_status || 'NONE';
  }
  function statusColor(s){
    switch(String(s)){
      case 'Approved': return '#34d399';
      case 'Submitted - Pending': return '#fb923c';
      case 'Created - NOT Submitted': return '#facc15';
      case 'Not Approved - Cannot Attach': return '#a78bfa';
      case 'Not Approved - PLA Issues':
      case 'Not Approved - MRE Issues':
      case 'Not Approved - Other Issues': return '#ef4444';
      default: return '#94a3b8'; // NONE
    }
  }
  function toMDY(yyyy_mm_dd){
    const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyy_mm_dd||''); return m? `${m[2]}/${m[3]}/${m[1]}` : '';
  }
  function idxByPole(permits){
    const map=new Map();
    for(const r of (permits||[])){
      const k=`${r.job_name}::${r.tag}::${r.SCID}`;
      if(!map.has(k)) map.set(k,[]);
      map.get(k).push(r);
    }
    return map;
  }

  // ---- Map & markers ----
  let map, pointsLayer, drawn, selectedSet=new Set(), pmap;
  let jobPolesCache=[], permitsCache=[];
  let recomputeSelection = () => {};

  function buildPoints(){
    if (!map) return;
    if (pointsLayer) { map.removeLayer(pointsLayer); }
    pointsLayer = L.layerGroup().addTo(map);
    pmap = idxByPole(permitsCache);

    const bounds=[];
    for(const p of jobPolesCache){
      const lat=+p.lat, lon=+p.lon; if(!Number.isFinite(lat)||!Number.isFinite(lon)) continue;
      const rel  = pmap.get(`${p.job_name}::${p.tag}::${p.SCID}`) || [];
      const stat = latestStatusFor(rel);
      const color= statusColor(stat);

      const m = L.circleMarker([lat,lon], { radius:4, weight:1, color:'#2a3242', fillColor:color, fillOpacity:1 });
      const tip = `<div class="id">SCID ${p.SCID} · Tag ${p.tag}</div><div class="status">${stat}</div>`;
      m.bindTooltip(tip, { permanent:true, direction:'top', className:'pole-tag', opacity:1 });
      m._pole=p;
      pointsLayer.addLayer(m);
      bounds.push([lat,lon]);
    }
    if (bounds.length) map.fitBounds(bounds,{padding:[40,40]});
    setTimeout(()=>map.invalidateSize(),50);

    recomputeSelection();
  }

  function setupMap(){
    map = L.map('map', { preferCanvas:true, zoomControl:false, updateWhenZooming:false, updateWhenIdle:true });
    L.control.zoom({ position:'bottomright' }).addTo(map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20, maxNativeZoom:19, keepBuffer:6, crossOrigin:true, attribution:'&copy; OpenStreetMap'
    }).addTo(map);

    drawn = new L.FeatureGroup(); map.addLayer(drawn);
    const drawCtl = new L.Control.Draw({
      position:'topright',
      draw:{
        marker:false, circle:false, polyline:false, circlemarker:false,
        polygon:{ allowIntersection:false, showArea:false, shapeOptions:{ color:'#2563eb', weight:2 } },
        rectangle:{ shapeOptions:{ color:'#2563eb', weight:2 } }
      },
      edit:{ featureGroup: drawn }
    });
    map.addControl(drawCtl);

    function setSelected(marker,on){
      const tt = marker.getTooltip && marker.getTooltip();
      const el = tt && tt.getElement && tt.getElement();
      if (el) el.classList.toggle('selected', !!on);
      marker.setStyle({ radius: on?6:4, weight:on?2:1, color:on? '#2563eb':'#2a3242' });
    }

    recomputeSelection = function(){
      selectedSet.clear();
      const polys = drawn.toGeoJSON().features.filter(f=>f.geometry && f.geometry.type==='Polygon');
      const markers = Object.values(pointsLayer? pointsLayer._layers : {});
      for(const m of markers){
        const {lat,lng} = m.getLatLng();
        const pt = turf.point([lng,lat]);
        let inside=false;
        for(const poly of polys){ if(turf.booleanPointInPolygon(pt,poly)){ inside=true; break; } }
        if(inside) selectedSet.add(m);
        setSelected(m, inside);
      }
      $('#selInfo').textContent = `Selected poles: ${selectedSet.size}`;
    };

    map.on(L.Draw.Event.CREATED,(e)=>{ drawn.addLayer(e.layer); recomputeSelection(); });
    map.on(L.Draw.Event.EDITED, ()=>recomputeSelection());
    map.on(L.Draw.Event.DELETED,()=>recomputeSelection());
    $('#btnClear').addEventListener('click', ()=>{ drawn.clearLayers(); recomputeSelection(); });
  }

  // ---- Apply ----
  async function onApply(){
    const mode   = ($('#mode')?.value || 'assign');
    const status = ($('#status')?.value || '').trim();
    const by     = ($('#by')?.value || '').trim();
    const dateMDY= toMDY($('#date')?.value || '');
    const baseId = ($('#baseId')?.value || '').trim();
    const msg=(t)=>{ const el=$('#msg'); if(el) el.innerHTML=t||''; };

    if (!JOB){ msg('<span style="color:#ef4444">Open this from the main page with a Job selected.</span>'); return; }
    if (selectedSet.size===0){ msg('<span style="color:#ef4444">Draw one or more polygons to select poles first.</span>'); return; }
    if (!status){ msg('<span style="color:#ef4444">Permit Status is required.</span>'); return; }
    if (mode==='assign'){
      if(!baseId){ msg('<span style="color:#ef4444">Base Permit ID is required for Assign.</span>'); return; }
      if(!by){ msg('<span style="color:#ef4444">Submitted By is required for Assign.</span>'); return; }
      if(!dateMDY){ msg('<span style="color:#ef4444">Submitted At (date) is required for Assign.</span>'); return; }
    }

    const changes=[];
    for(const m of Array.from(selectedSet)){
      const p = m._pole;
      const k = `${p.job_name}::${p.tag}::${p.SCID}`;
      const rel = pmap.get(k) || [];
      if (mode==='assign'){
        if (rel.length>0) continue;
        changes.push({ type:'upsert_permit',
          permit:{ permit_id:`${baseId}_${p.SCID}`, job_name:p.job_name, tag:p.tag, SCID:p.SCID,
                   permit_status:status, submitted_by:by, submitted_at:dateMDY, notes:'' }});
      } else {
        for(const r of rel){ changes.push({ type:'update_permit', permit_id:r.permit_id, patch:{ permit_status:status } }); }
      }
    }
    if (changes.length===0){ msg('<span style="color:#34d399">Nothing to do for selected poles.</span>'); return; }

    const btn=$('#btnApply'); if(btn) btn.disabled=true;
    try{
      msg(`Submitting ${changes.length} change(s)…`);
      const data = await callApi({ actorName:'Website User', reason:`Map ${mode} (${changes.length})`, changes });
      msg(`<span style="color:#34d399">Submitted ${changes.length} change(s).</span> `+
          (data.pr_url? `<a class="link" href="${data.pr_url}" target="_blank" rel="noopener">View PR</a>`:'' ));

      // 🔔 Trigger the same watcher/graphics:
      window.dispatchEvent(new CustomEvent('watch:start'));
      if (window.opener && !window.opener.closed) { try { window.opener.dispatchEvent(new CustomEvent('watch:start')); } catch {} }
      if (bc) { try { bc.postMessage('watch-start'); } catch {} }
      try { localStorage.setItem('permits:watch-start', String(Date.now())); } catch {}
    } catch(e){
      console.error(e);
      msg(`<span style="color:#ef4444">${e.message}</span>`);
    } finally {
      if(btn) btn.disabled=false;
    }
  }

  // ---- Delete (mirrors Apply pipeline; no changes elsewhere) ----
  async function onDelete(){
    const msg=(t)=>{ const el=$('#msg'); if(el) el.innerHTML=t||''; };

    if (!JOB){ msg('<span style="color:#ef4444">Open this from the main page with a Job selected.</span>'); return; }
    if (selectedSet.size===0){ msg('<span style="color:#ef4444">Draw one or more polygons to select poles first.</span>'); return; }

    const seen = new Set();
    const changes = [];
    for(const m of Array.from(selectedSet)){
      const p = m._pole;
      const k = `${p.job_name}::${p.tag}::${p.SCID}`;
      const rel = pmap.get(k) || [];
      for(const r of rel){
        const id = r.permit_id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        changes.push({ type:'delete_permit', permit_id: id });
      }
    }
    if (changes.length===0){ msg('<span style="color:#34d399">Nothing to delete for selected poles.</span>'); return; }

    const btn=$('#btnDelete'); if(btn) btn.disabled=true;
    try{
      msg(`Submitting ${changes.length} delete(s)…`);
      const data = await callApi({ actorName:'Website User', reason:`Map delete (${changes.length})`, changes });
      msg(`<span style="color:#34d399">Submitted ${changes.length} delete(s).</span> `+
          (data.pr_url? `<a class="link" href="${data.pr_url}" target="_blank" rel="noopener">View PR</a>`:'' ));

      // 🔔 Same refresh signals as Apply
      window.dispatchEvent(new CustomEvent('watch:start'));
      if (window.opener && !window.opener.closed) { try { window.opener.dispatchEvent(new CustomEvent('watch:start')); } catch {} }
      if (bc) { try { bc.postMessage('watch-start'); } catch {} }
      try { localStorage.setItem('permits:watch-start', String(Date.now())); } catch {}
    } catch(e){
      console.error(e);
      msg(`<span style="color:#ef4444">${e.message}</span>`);
    } finally {
      if(btn) btn.disabled=false;
    }
  }

  // ---- init ----
  document.addEventListener('DOMContentLoaded', async ()=>{
    // form toggles
    const d=$('#date'); if(d && !d.value) d.valueAsDate=new Date();
    const modeSel=$('#mode');
    const assignOnly=()=>document.querySelectorAll('.assign-only');
    const refresh=()=>{ const show=(modeSel && modeSel.value==='assign'); for(const el of assignOnly()) el.style.display=show?'':'none'; };
    if (modeSel) { modeSel.addEventListener('change', refresh); refresh(); }

    // Wire buttons (Apply is required; Delete is optional if panel provided)
    const applyBtn = $('#btnApply');
    if (applyBtn) applyBtn.addEventListener('click', onApply);

    const delBtn = $('#btnDelete');
    if (delBtn && !delBtn.__wired){
      delBtn.__wired = true;
      delBtn.addEventListener('click', onDelete);
    }

    if (!JOB){ $('#msg').innerHTML='<span style="color:#ef4444">No Job specified. Open this via “Advanced Map Selection”.</span>'; return; }

    // Load data, then map
    try{
      const {poles, permits} = await loadData();
      jobPolesCache = (poles||[]).filter(p => String(p.job_name)===String(JOB));
      permitsCache  = permits || [];
      setupMap();
      buildPoints();
    }catch(e){
      $('#msg').innerHTML = `<span style="color:#ef4444">Load error: ${e.message}</span>`;
    }
  });

  // When the watcher finishes a refresh (in this tab), rebuild markers
  window.addEventListener('data:loaded', () => {
    if (!window.STATE) return;
    permitsCache  = window.STATE.permits || [];
    jobPolesCache = (window.STATE.poles || []).filter(p => String(p.job_name)===String(JOB));
    buildPoints();
  });

  // If main tab broadcasts via localStorage, start watching here too
  window.addEventListener('storage', (e) => {
    if (e.key === 'permits:watch-start' && e.newValue) {
      try { window.dispatchEvent(new CustomEvent('watch:start')); } catch {}
    }
  });
})();
