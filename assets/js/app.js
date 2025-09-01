// assets/js/app.js
(function(){
  const CFG = window.APP_CONFIG || {};
  const $   = (s) => document.querySelector(s);
  const fmt = (n) => new Intl.NumberFormat().format(n);

  // -------- GitHub helpers --------
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

  // -------- Main load --------
  async function loadData() {
    const status = $('#status');
    status && (status.textContent = 'Loading…');

    try {
      const dirs = Array.from(new Set([CFG.DATA_DIR, 'docs/data', 'data'].filter(Boolean)));
      const fastMode = !!window.WATCH_ACTIVE;

      let result = null;
      let usedSha = null;

      if (!fastMode) {
        try {
          const sha = await getLatestSha();
          const bases = dirs.map(d => `https://raw.githubusercontent.com/${CFG.OWNER}/${CFG.REPO}/${sha}/${d}`);
          result = await tryLoadBases(bases);
          usedSha = sha;
        } catch (e) {
          console.warn('[loadData] getLatestSha failed, falling back to branch:', e.message || e);
        }
      }

      if (!result) {
        const bases = dirs.map(d => `https://raw.githubusercontent.com/${CFG.OWNER}/${CFG.REPO}/${CFG.DEFAULT_BRANCH}/${d}`);
        result = await tryLoadBases(bases);
        usedSha = CFG.DEFAULT_BRANCH;
      }

      window.STATE = { ...result, sha: usedSha, from: usedSha === CFG.DEFAULT_BRANCH ? 'branch' : 'sha' };

      // KPIs
      $('#kPoles')   && ($('#kPoles').textContent   = fmt(window.STATE.poles.length));
      $('#kPermits') && ($('#kPermits').textContent = fmt(window.STATE.permits.length));
      $('#kLoaded')  && ($('#kLoaded').textContent  = new Date().toLocaleString());
      $('#kSha')     && ($('#kSha').textContent     =
        window.STATE.from === 'sha' ? String(window.STATE.sha).slice(0,7) : `${CFG.DEFAULT_BRANCH} (fallback)`);

      status && (status.innerHTML =
        window.STATE.from === 'sha'
          ? `<span style="color:#34d399">Loaded from commit ${String(window.STATE.sha).slice(0,7)}</span>`
          : `<span style="color:#f59e0b">Loaded from branch (fallback)</span>`);

      // Notify UI/admin modules
      window.dispatchEvent(new Event('data:loaded'));
    } catch (e) {
      $('#kPoles')   && ($('#kPoles').textContent   = '—');
      $('#kPermits') && ($('#kPermits').textContent = '—');
      $('#kLoaded')  && ($('#kLoaded').textContent  = '—');
      $('#kSha')     && ($('#kSha').textContent     = '—');
      const hint = `
        <div class="small muted" style="margin-top:6px">
          • Check <code>APP_CONFIG.DATA_DIR</code> in <code>assets/js/config.js</code> (e.g. <code>data</code> vs <code>docs/data</code>).<br/>
          • If the repo is <b>private</b>, raw URLs return 404. Make it public or add a data proxy endpoint.
        </div>`;
      status && (status.innerHTML = `<span style="color:#ef4444">Error: ${e.message}</span>${hint}`);
      console.error('[loadData]', e);
    }
  }

  // Exposed for watcher & admin
  window.reloadData = loadData;

  // -------- API helper (uses APP_CONFIG) --------
  async function callApi(payload) {
    const API_URL   = CFG.API_URL;
    const SHARED_KEY= CFG.SHARED_KEY;
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

  // -------- Save / Delete handlers (unchanged) --------
  function msg(textHtml) {
    const el = $('#msgPermit');
    if (el) el.innerHTML = textHtml || '';
  }

  // yyyy-mm-dd -> MM/DD/YYYY (for API)
  function toMDY(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? `${m[2]}/${m[3]}/${m[1]}` : (s || '');
  }

  async function onSavePermit(ev) {
    if (ev) ev.preventDefault();
    if (typeof window.UI_collectPermitForm !== 'function') {
      msg('<span class="err">Internal error: form collector missing.</span>');
      return;
    }

    const f = window.UI_collectPermitForm();
    // Required fields
    if (!f.job_name || !f.tag || !f.SCID) { msg('<span class="err">Missing pole keys (job_name, tag, SCID).</span>'); return; }
    if (!f.permit_id) { msg('<span class="err">Permit ID is required.</span>'); return; }
    if (!f.permit_status) { msg('<span class="err">Permit Status is required.</span>'); return; }
    if (!f.submitted_by) { msg('<span class="err">Submitted By is required.</span>'); return; }
    if (!f.submitted_at) { msg('<span class="err">Submitted At (date) is required.</span>'); return; }

    const exists = (window.STATE?.permits || []).some(r => String(r.permit_id) === String(f.permit_id));

    const change = exists
      ? {
          type: 'update_permit',
          permit_id: f.permit_id,
          patch: {
            job_name: f.job_name,
            tag:      f.tag,
            SCID:     f.SCID,
            permit_status: f.permit_status,
            submitted_by:  f.submitted_by,
            submitted_at:  f.submitted_at,
            notes:         f.notes || ''
          }
        }
      : {
          type: 'upsert_permit',
          permit: {
            permit_id: f.permit_id,
            job_name:  f.job_name,
            tag:       f.tag,
            SCID:      f.SCID,
            permit_status: f.permit_status,
            submitted_by:  f.submitted_by,
            submitted_at:  f.submitted_at,
            notes:         f.notes || ''
          }
        };

    try {
      msg('Submitting…');
      const data = await callApi({ actorName: 'Website User', reason: `Permit ${f.permit_id}`, change });
      msg(`<span class="ok">Change submitted.</span> <a class="link" href="${data.pr_url}" target="_blank" rel="noopener">View PR</a>`);
      window.dispatchEvent(new CustomEvent('watch:start')); // overlay + auto refresh (bulk watcher path handles all)
    } catch (err) {
      console.error(err);
      msg(`<span class="err">${err.message}</span>`);
    }
  }

  async function onDeletePermit(ev) {
    if (ev) ev.preventDefault();
    const id = ($('#permit_id')?.value || '').trim();
    if (!id) { msg('<span class="err">Permit ID is required to delete.</span>'); return; }

    try {
      msg('Submitting delete…');
      const data = await callApi({
        actorName: 'Website User',
        reason: `Delete ${id}`,
        change: { type: 'delete_permit', permit_id: id }
      });
      msg(`<span class="ok">Delete submitted.</span> <a class="link" href="${data.pr_url}" target="_blank" rel="noopener">View PR</a>`);
      window.dispatchEvent(new CustomEvent('watch:start'));
    } catch (err) {
      console.error(err);
      msg(`<span class="err">${err.message}</span>`);
    }
  }

  // -------- NEW: Mass Assign / Modify by SCID (batch -> single PR) --------
  function setMassMsg(html) {
    const el = $('#msgMass'); if (el) el.innerHTML = html || '';
  }

  function getSelectedJob() {
    const el = $('#fJob');
    return (el && el.value && el.value !== 'All') ? el.value : '';
  }

  function updateMassPanelEnabled() {
    const job = getSelectedJob();
    const panel = $('#massPanel');
    const hint  = $('#massDisabledHint');
    if (!panel) return;
    if (!job) {
      panel.classList.add('disabled-block');
      if (hint) hint.style.display = '';
    } else {
      panel.classList.remove('disabled-block');
      if (hint) hint.style.display = 'none';
    }
  }

  function updateAssignOnlyVisibility() {
    const mode = ($('#massMode')?.value || 'assign');
    const els = document.querySelectorAll('.assign-only');
    els.forEach(el => { el.style.display = (mode === 'assign') ? '' : 'none'; });
  }

  // Build a quick permit index by pole key
  function indexPermitsByPole(permits) {
    const map = new Map();
    for (const r of (permits || [])) {
      const key = `${r.job_name}::${r.tag}::${r.SCID}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return map;
  }

  // Inclusive SCID range comparison (handles '4' vs '004', and reversed bounds)
  function scidBetween(val, a, b) {
    const s  = String(val ?? '').trim();
    const sA = String(a   ?? '').trim();
    const sB = String(b   ?? '').trim();
    if (!s || !sA || !sB) return false;

    const width = Math.max(s.length, sA.length, sB.length);
    const pad = (x) => String(x).padStart(width, '0');

    let lo = pad(sA), hi = pad(sB);
    if (lo > hi) [lo, hi] = [hi, lo];

    const v = pad(s);
    return lo <= v && v <= hi; // inclusive
  }

  async function onMassApply(ev) {
    if (ev) ev.preventDefault();
    setMassMsg('');

    const job     = getSelectedJob();
    const mode    = ($('#massMode')?.value || 'assign');
    const fromId  = ($('#massFromScid')?.value || '').trim();
    const toId    = ($('#massToScid')?.value   || '').trim();
    const baseId  = ($('#massBasePermit')?.value || '').trim();
    const status  = ($('#massStatus')?.value || '').trim();
    const by      = ($('#massBy')?.value || '').trim();
    const dateISO = ($('#massDate')?.value || '').trim();
    const dateMDY = toMDY(dateISO);

    if (!job) { setMassMsg('<span class="err">Choose a Job on the left first.</span>'); return; }
    if (!fromId || !toId) { setMassMsg('<span class="err">From/To SCID are required.</span>'); return; }
    if (!status) { setMassMsg('<span class="err">Permit Status is required.</span>'); return; }

    if (mode === 'assign') {
      if (!baseId) { setMassMsg('<span class="err">Base Permit ID is required for Assign.</span>'); return; }
      if (!by) { setMassMsg('<span class="err">Submitted By is required for Assign.</span>'); return; }
      if (!dateMDY) { setMassMsg('<span class="err">Submitted At (date) is required for Assign.</span>'); return; }
    }

    const poles   = (window.STATE?.poles || []).filter(p => String(p.job_name) === String(job));
    const permits = (window.STATE?.permits || []);
    const byPole  = indexPermitsByPole(permits);

    // Select poles within inclusive SCID range
    const targets = poles.filter(p => scidBetween(p.SCID, fromId, toId));

    if (targets.length === 0) {
      setMassMsg('<span class="err">No poles found in that SCID range for the selected Job.</span>');
      return;
    }

    // Build ONE batch of changes (-> single PR)
    const changes = [];
    if (mode === 'assign') {
      for (const p of targets) {
        const key = `${p.job_name}::${p.tag}::${p.SCID}`;
        const rel = byPole.get(key) || [];
        if (rel.length > 0) continue; // only create on poles with no permits

        const permit_id = `${baseId}_${p.SCID}`;
        changes.push({
          type: 'upsert_permit',
          permit: {
            permit_id,
            job_name: p.job_name,
            tag:      p.tag,
            SCID:     p.SCID,
            permit_status: status,
            submitted_by:  by,
            submitted_at:  dateMDY,
            notes: ''
          }
        });
      }
    } else {
      // modify mode: update only the permit_status for all existing permits in range
      for (const p of targets) {
        const key = `${p.job_name}::${p.tag}::${p.SCID}`;
        const rel = byPole.get(key) || [];
        for (const r of rel) {
          changes.push({ type: 'update_permit', permit_id: r.permit_id, patch: { permit_status: status } });
        }
      }
    }

    if (changes.length === 0) {
      setMassMsg(mode === 'assign'
        ? '<span class="ok">Nothing to do (all poles in range already have permits).</span>'
        : '<span class="ok">Nothing to modify (no existing permits in range).</span>');
      return;
    }

    // Submit ONE request -> ONE PR
    const btn = $('#btnMassApply');
    if (btn) btn.disabled = true;
    try {
      setMassMsg(`Submitting ${changes.length} change(s)…`);
      const data = await callApi({
        actorName: 'Website User',
        reason: `${mode === 'assign' ? 'Mass assign' : 'Mass modify'} (${changes.length})`,
        changes
      });
      setMassMsg(
        `<span class="ok">Submitted ${changes.length} change(s).</span> ` +
        (data.pr_url ? `<a class="link" href="${data.pr_url}" target="_blank" rel="noopener">View PR</a>` : '')
      );

      // Trigger the same overlay + polling used by Save/Delete (bulk mode in watch.js)
      window.dispatchEvent(new CustomEvent('watch:start'));
    } catch (e) {
      console.error(e);
      setMassMsg(`<span class="err">${e.message}</span>`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function wireButtons() {
    const save = $('#btnSavePermit');
    if (save) { save.type = 'button'; save.removeEventListener('click', onSavePermit); save.addEventListener('click', onSavePermit); }
    const del = $('#btnDeletePermit');
    if (del)  { del.type  = 'button'; del.removeEventListener('click', onDeletePermit); del.addEventListener('click', onDeletePermit); }

    // Mass panel
    const massApply = $('#btnMassApply');
    if (massApply) { massApply.type = 'button'; massApply.removeEventListener('click', onMassApply); massApply.addEventListener('click', onMassApply); }
    const massMode = $('#massMode');
    if (massMode) { massMode.removeEventListener('change', updateAssignOnlyVisibility); massMode.addEventListener('change', updateAssignOnlyVisibility); }
    updateAssignOnlyVisibility();
    updateMassPanelEnabled();

    // Re-evaluate enabled/disabled when filters change on the left
    $('#fJob') && $('#fJob').addEventListener('change', updateMassPanelEnabled);
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireButtons();
    loadData();
  });

  window.addEventListener('data:loaded', wireButtons);
})();
