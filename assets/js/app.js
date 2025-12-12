// assets/js/app.js
(function(){
  const CFG = window.APP_CONFIG || {};
  const $   = (s) => document.querySelector(s);
  const fmt = (n) => new Intl.NumberFormat().format(n);

  // -------- Cross-tab watch signal (opener + storage + BroadcastChannel) --------
  const bc = ('BroadcastChannel' in window) ? new BroadcastChannel('permits') : null;
  if (bc) {
    bc.onmessage = (ev) => {
      if (ev && ev.data === 'watch-start') {
        try { window.dispatchEvent(new CustomEvent('watch:start')); } catch {}
      }
    };
  }
  window.addEventListener('storage', (e) => {
    if (e.key === 'permits:watch-start' && e.newValue) {
      try { window.dispatchEvent(new CustomEvent('watch:start')); } catch {}
    }
  });

  // -------- GitHub helpers --------
  async function getLatestSha() {
    const url = `https://api.github.com/repos/${CFG.OWNER}/${CFG.REPO}/commits/${CFG.DEFAULT_BRANCH}?_=${Date.now()}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`GitHub API ${r.status} (latest commit)`);
    const j = await r.json();
    return j.sha;
  }
  async function fetchJson(url) { const r = await fetch(url, { cache: 'no-store' }); return { ok:r.ok, status:r.status, json:r.ok?await r.json():null, url }; }
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

  // -------- Main load --------
  async function loadData() {
    const status = $('#status'); status && (status.textContent = 'Loading…');
    try {
      const dirs = Array.from(new Set([CFG.DATA_DIR, 'docs/data', 'data'].filter(Boolean)));
      const fastMode = !!window.WATCH_ACTIVE;
      let result=null, usedSha=null;

      if (!fastMode) {
        try {
          const sha = await getLatestSha();
          const bases = dirs.map(d => `https://raw.githubusercontent.com/${CFG.OWNER}/${CFG.REPO}/${sha}/${d}`);
          result = await tryLoadBases(bases);
          usedSha = sha;
        } catch (e) { console.warn('[loadData] getLatestSha failed, falling back to branch:', e.message || e); }
      }
      if (!result) {
        const bases = dirs.map(d => `https://raw.githubusercontent.com/${CFG.OWNER}/${CFG.REPO}/${CFG.DEFAULT_BRANCH}/${d}`);
        result = await tryLoadBases(bases);
        usedSha = CFG.DEFAULT_BRANCH;
      }

      window.STATE = { ...result, sha: usedSha, from: usedSha === CFG.DEFAULT_BRANCH ? 'branch' : 'sha' };

      $('#kPoles')   && ($('#kPoles').textContent   = fmt(window.STATE.poles.length));
      $('#kPermits') && ($('#kPermits').textContent = fmt(window.STATE.permits.length));
      $('#kLoaded')  && ($('#kLoaded').textContent  = new Date().toLocaleString());
      $('#kSha')     && ($('#kSha').textContent     =
        window.STATE.from === 'sha' ? String(window.STATE.sha).slice(0,7) : `${CFG.DEFAULT_BRANCH} (fallback)`);

      status && (status.innerHTML =
        window.STATE.from === 'sha'
          ? `<span style="color:#34d399">Loaded from commit ${String(window.STATE.sha).slice(0,7)}</span>`
          : `<span style="color:#f59e0b">Loaded from branch (fallback)</span>`);

      window.dispatchEvent(new Event('data:loaded'));
    } catch (e) {
      $('#kPoles')   && ($('#kPoles').textContent   = '—');
      $('#kPermits') && ($('#kPermits').textContent = '—');
      $('#kLoaded')  && ($('#kLoaded').textContent  = '—');
      $('#kSha')     && ($('#kSha').textContent     = '—');
      const hint = `
        <div class="small muted" style="margin-top:6px">
          • Check <code>APP_CONFIG.DATA_DIR</code> in <code>assets/js/config.js</code>.<br/>
          • If the repo is <b>private</b>, raw URLs return 404. Make it public or add a data proxy endpoint.
        </div>`;
      status && (status.innerHTML = `<span style="color:#ef4444">Error: ${e.message}</span>${hint}`);
      console.error('[loadData]', e);
    }
  }
  window.reloadData = loadData;

  // -------- API helper --------
  async function callApi(payload) {
    const res = await fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Permits-Key': CFG.SHARED_KEY || '' },
      body: JSON.stringify(payload)
    });
    let data; try { data = await res.json(); } catch { data = { ok:false, error:'Invalid server response' }; }
    if (!res.ok || !data.ok) throw new Error((data && data.error) ? (data.error) : `HTTP ${res.status}`);
    return data;
  }

  // -------- Save / Delete --------
  function msg(h){ const el=$('#msgPermit'); if(el) el.innerHTML=h||''; }
  function toMDY(s){ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||''); return m? `${m[2]}/${m[3]}/${m[1]}` : (s||''); }

  // -------- Proposal normalization / base-id propagation --------
  const PROPOSAL_RE = /\b(\d{4}-\d{2}-\d{4})\b/; // 1234-56-7890

  function basePermitId(id){
    // Base ID = everything except trailing _### (SCID suffix)
    return String(id || '').replace(/_\d+$/,'');
  }

  function extractProposalNumber(notes){
    const t = String(notes ?? '');
    const m = t.match(PROPOSAL_RE);
    return m ? m[1] : null;
  }

  // Ensures that any 1234-56-7890 present is stored as "Proposal 1234-56-7890"
  // If "proposal" already exists anywhere in the note, we do NOT force-add another "Proposal" word.
  function normalizeProposalInNotes(raw){
    const t = String(raw ?? '');
    const num = extractProposalNumber(t);
    if (!num) return { notes: t, proposal: null };

    // If the note already includes "proposal" anywhere, keep text but still report the proposal number.
    if (/proposal/i.test(t)) return { notes: t, proposal: num };

    // Otherwise replace the number token with "Proposal <num>"
    return { notes: t.replace(PROPOSAL_RE, `Proposal ${num}`), proposal: num };
  }

  // Updates (or injects) proposal number inside an existing note while preserving other text.
  function applyProposalToExistingNotes(existingNotes, proposalNum){
    const t = String(existingNotes ?? '');
    if (!proposalNum) return t;

    // If there is already a proposal-number token, normalize/replace it.
    if (PROPOSAL_RE.test(t)) {
      if (/proposal/i.test(t)) {
        // Replace ONLY the numeric token, keep the user's wording.
        return t.replace(PROPOSAL_RE, proposalNum);
      }
      // Replace token with "Proposal <num>"
      return t.replace(PROPOSAL_RE, `Proposal ${proposalNum}`);
    }

    // No proposal number present: append on a new line (minimizes disruption).
    const suffix = `Proposal ${proposalNum}`;
    return t.trim() ? `${t.trim()}\n${suffix}` : suffix;
  }


  async function onSavePermit(e){
    e && e.preventDefault();
    if (typeof window.UI_collectPermitForm!=='function'){ msg('<span class="err">Internal error.</span>'); return; }
    const f=window.UI_collectPermitForm();
    const norm = normalizeProposalInNotes(f.notes || '');
    f.notes = norm.notes;


    if(!f.job_name||!f.tag||!f.SCID){ msg('<span class="err">Missing pole keys.</span>'); return; }
    if(!f.permit_id){ msg('<span class="err">Permit ID is required.</span>'); return; }
    if(!f.permit_status){ msg('<span class="err">Permit Status is required.</span>'); return; }
    if(!f.submitted_by){ msg('<span class="err">Submitted By is required.</span>'); return; }
    if(!f.submitted_at){ msg('<span class="err">Submitted At is required.</span>'); return; }

    const exists = (window.STATE?.permits||[]).some(r=>String(r.permit_id)===String(f.permit_id));

    const primary = exists
      ? { type:'update_permit', permit_id:f.permit_id, patch:{
            job_name:f.job_name, tag:f.tag, SCID:f.SCID,
            permit_status:f.permit_status, submitted_by:f.submitted_by, submitted_at:f.submitted_at, notes:f.notes||'' } }
      : { type:'upsert_permit', permit:{
            permit_id:f.permit_id, job_name:f.job_name, tag:f.tag, SCID:f.SCID,
            permit_status:f.permit_status, submitted_by:f.submitted_by, submitted_at:f.submitted_at, notes:f.notes||'' } };

    // If there is a proposal number in this note, propagate it to every permit with the same base permit_id.
    const changes = [primary];

    if (norm.proposal) {
      const base = basePermitId(f.permit_id);
      const all = (window.STATE?.permits || []).filter(r => basePermitId(r.permit_id) === base);

      for (const r of all) {
        if (!r?.permit_id) continue;
        if (String(r.permit_id) === String(f.permit_id)) continue;

        const nextNotes = applyProposalToExistingNotes(r.notes || '', norm.proposal);
        if (String(nextNotes) !== String(r.notes || '')) {
          changes.push({ type:'update_permit', permit_id:r.permit_id, patch:{ notes: nextNotes } });
        }
      }
    }

    try{
      msg('Submitting…');
      // IMPORTANT: submit as `changes` so propagation actually reaches backend (same format Mass Apply uses)
      const data = await callApi({ actorName:'Website User', reason:`Permit ${f.permit_id}`, changes });
      msg(`<span class="ok">Change submitted.</span> <a class="link" href="${data.pr_url}" target="_blank" rel="noopener">View PR</a>`);
      window.dispatchEvent(new CustomEvent('watch:start'));
    }catch(err){ console.error(err); msg(`<span class="err">${err.message}</span>`); }


    const change = exists
      ? { type:'update_permit', permit_id:f.permit_id, patch:{
            job_name:f.job_name, tag:f.tag, SCID:f.SCID,
            permit_status:f.permit_status, submitted_by:f.submitted_by, submitted_at:f.submitted_at, notes:f.notes||'' } }
      : { type:'upsert_permit', permit:{
            permit_id:f.permit_id, job_name:f.job_name, tag:f.tag, SCID:f.SCID,
            permit_status:f.permit_status, submitted_by:f.submitted_by, submitted_at:f.submitted_at, notes:f.notes||'' } };

    try{
      msg('Submitting…');
      const data = await callApi({ actorName:'Website User', reason:`Permit ${f.permit_id}`, change });
      msg(`<span class="ok">Change submitted.</span> <a class="link" href="${data.pr_url}" target="_blank" rel="noopener">View PR</a>`);
      window.dispatchEvent(new CustomEvent('watch:start'));
    }catch(err){ console.error(err); msg(`<span class="err">${err.message}</span>`); }
  }

  async function onDeletePermit(e){
    e && e.preventDefault();
    const id = ($('#permit_id')?.value||'').trim();
    if(!id){ msg('<span class="err">Permit ID is required to delete.</span>'); return; }
    try{
      msg('Submitting delete…');
      const data = await callApi({ actorName:'Website User', reason:`Delete ${id}`, change:{ type:'delete_permit', permit_id:id } });
      msg(`<span class="ok">Delete submitted.</span> <a class="link" href="${data.pr_url}" target="_blank" rel="noopener">View PR</a>`);
      window.dispatchEvent(new CustomEvent('watch:start'));
    }catch(err){ console.error(err); msg(`<span class="err">${err.message}</span>`); }
  }

  // -------- Mass assign/modify (single PR) --------
  function setMassMsg(h){ const el=$('#msgMass'); if(el) el.innerHTML=h||''; }
  function getSelectedJob(){ const el=$('#fJob'); return (el && el.value && el.value!=='All') ? el.value : ''; }

  function updateMassPanelEnabled(){
    const job=getSelectedJob(); const panel=$('#massPanel'); const hint=$('#massDisabledHint');
    if (!panel) return;
    if(!job){ panel.classList.add('disabled-block'); if(hint) hint.style.display=''; }
    else    { panel.classList.remove('disabled-block'); if(hint) hint.style.display='none'; }
    const adv=$('#btnAdvancedMap'); if(adv) adv.disabled=!job;
  }
  function updateAssignOnlyVisibility(){
    const mode=($('#massMode')?.value||'assign'); document.querySelectorAll('.assign-only')
      .forEach(el=>{ el.style.display = (mode==='assign')? '' : 'none'; });
  }
  function indexPermitsByPole(list){
    const m=new Map(); for(const r of (list||[])){ const k=`${r.job_name}::${r.tag}::${r.SCID}`; if(!m.has(k)) m.set(k,[]); m.get(k).push(r); } return m;
  }
  function scidBetween(val,a,b){
    const s=String(val??'').trim(), sA=String(a??'').trim(), sB=String(b??'').trim(); if(!s||!sA||!sB) return false;
    const width=Math.max(s.length,sA.length,sB.length), pad=(x)=>String(x).padStart(width,'0');
    let lo=pad(sA), hi=pad(sB); if(lo>hi) [lo,hi]=[hi,lo]; const v=pad(s); return lo<=v && v<=hi;
  }

  async function onMassApply(e){
    e && e.preventDefault(); setMassMsg('');
    const job=getSelectedJob(), mode=($('#massMode')?.value||'assign'),
          fromId=($('#massFromScid')?.value||'').trim(), toId=($('#massToScid')?.value||'').trim(),
          baseId=($('#massBasePermit')?.value||'').trim(), status=($('#massStatus')?.value||'').trim(),
          by=($('#massBy')?.value||'').trim(), dateISO=($('#massDate')?.value||'').trim(),
          dateMDY=(function(s){ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||''); return m?`${m[2]}/${m[3]}/${m[1]}`:''; })(dateISO);

    if(!job){ setMassMsg('<span class="err">Choose a Job on the left first.</span>'); return; }
    if(!fromId||!toId){ setMassMsg('<span class="err">From/To SCID are required.</span>'); return; }
    if(!status){ setMassMsg('<span class="err">Permit Status is required.</span>'); return; }
    if(mode==='assign'){ if(!baseId){ setMassMsg('<span class="err">Base Permit ID is required for Assign.</span>'); return; }
      if(!by){ setMassMsg('<span class="err">Submitted By is required for Assign.</span>'); return; }
      if(!dateMDY){ setMassMsg('<span class="err">Submitted At (date) is required for Assign.</span>'); return; } }

    const poles=(window.STATE?.poles||[]).filter(p=>String(p.job_name)===String(job));
    const byPole=indexPermitsByPole(window.STATE?.permits||[]);
    const targets=poles.filter(p=>scidBetween(p.SCID,fromId,toId));
    if(targets.length===0){ setMassMsg('<span class="err">No poles found in that SCID range for the selected Job.</span>'); return; }

    // --- NOTES mass-update (read + optional overwrite confirmation) ---
    const notesToApplyRaw = ($('#massNotes')?.value || '').trim();
    const massNorm = normalizeProposalNotes(notesToApplyRaw);
    const notesToApply = massNorm.notes;
    const wantNotes = !!notesToApplyRaw;
    let overwriteNotes = true;

    if (wantNotes && mode!=='assign') {
      let total=0, withNotes=0;
      for (const p of targets){
        const key=`${p.job_name}::${p.tag}::${p.SCID}`;
        const rel=byPole.get(key)||[];
        for (const r of rel){ total++; if ((r.notes||'').trim()) withNotes++; }
      }
      if (withNotes>0){
        overwriteNotes = confirm(
          `${withNotes} of ${total} selected permit(s) already have notes.\n\n` +
          `Do you want to OVERWRITE their existing notes with:\n\n"${notesToApplyRaw}"?`
        );
        // If user clicks Cancel, we'll still update status (and add notes only to those without notes).
      }
    }
    // --- end NOTES mass-update ---

    const changes=[];
    if(mode==='assign'){
      for(const p of targets){ const key=`${p.job_name}::${p.tag}::${p.SCID}`; const rel=byPole.get(key)||[];
        if(rel.length>0) continue;
        changes.push({ type:'upsert_permit', permit:{
          permit_id:`${baseId}_${p.SCID}`, job_name:p.job_name, tag:p.tag, SCID:p.SCID,
          permit_status:status, submitted_by:by, submitted_at:dateMDY, notes: wantNotes ? notesToApplyRaw : '' }});
      }
    }else{
      for(const p of targets){ const key=`${p.job_name}::${p.tag}::${p.SCID}`; const rel=byPole.get(key)||[];
        for(const r of rel){
          const patch = { permit_status: status };
          if (wantNotes){
            const hadNotes = !!((r.notes||'').trim());
            if (overwriteNotes || !hadNotes) patch.notes = notesToApplyRaw;
          }
          changes.push({ type:'update_permit', permit_id:r.permit_id, patch });
        }
      }
    }
    if(changes.length===0){ setMassMsg(mode==='assign'
      ? '<span class="ok">Nothing to do (all poles in range already have permits).</span>'
      : '<span class="ok">Nothing to modify (no existing permits in range).</span>'); return; }

    const btn=$('#btnMassApply'); if(btn) btn.disabled = true;
    try{
      setMassMsg(`Submitting ${changes.length} change(s)…`);
      const data = await callApi({ actorName:'Website User', reason:`${mode==='assign'?'Mass assign':'Mass modify'} (${changes.length})`, changes });
      setMassMsg(`<span class="ok">Submitted ${changes.length} change(s).</span> ` +
        (data.pr_url? `<a class="link" href="${data.pr_url}" target="_blank" rel="noopener">View PR</a>` : ''));

      // Start watcher here…
      window.dispatchEvent(new CustomEvent('watch:start'));
      // …and notify other tabs robustly
      try { localStorage.setItem('permits:watch-start', String(Date.now())); } catch {}
      if (bc) { try { bc.postMessage('watch-start'); } catch {} }
    }catch(err){ console.error(err); setMassMsg(`<span class="err">${err.message}</span>`); }
    finally{ if(btn) btn.disabled=false; }
  }

  // -------- Advanced Map opener (single tab; keep opener link so map can signal) --------
  function onAdvancedMapClick(){
    const el=$('#fJob'); const job=(el && el.value && el.value!=='All') ? el.value : '';
    if (!job) return;
    window.open(`map.html?job=${encodeURIComponent(job)}`, '_blank'); // keep opener
  }

  function wireButtons(){
    const save=$('#btnSavePermit'); if(save){ save.type='button'; save.removeEventListener('click',onSavePermit); save.addEventListener('click',onSavePermit); }
    const del=$('#btnDeletePermit'); if(del){ del.type='button'; del.removeEventListener('click',onDeletePermit); del.addEventListener('click',onDeletePermit); }

    const massApply=$('#btnMassApply'); if(massApply){ massApply.type='button'; massApply.removeEventListener('click',onMassApply); massApply.addEventListener('click',onMassApply); }
    const massMode=$('#massMode'); if(massMode){ massMode.removeEventListener('change',updateAssignOnlyVisibility); massMode.addEventListener('change',updateAssignOnlyVisibility); }

    const adv=$('#btnAdvancedMap'); if(adv){ adv.type='button'; adv.removeEventListener('click',onAdvancedMapClick); adv.addEventListener('click',onAdvancedMapClick); }

    updateAssignOnlyVisibility(); updateMassPanelEnabled();
    $('#fJob') && $('#fJob').addEventListener('change', updateMassPanelEnabled);
  }

  document.addEventListener('DOMContentLoaded', ()=>{ wireButtons(); loadData(); });
  window.addEventListener('data:loaded', wireButtons);

  // If the map tab broadcasts via BroadcastChannel, start the watcher here too (fallback already above for localStorage)
  // (Handled above in bc.onmessage)
})();
