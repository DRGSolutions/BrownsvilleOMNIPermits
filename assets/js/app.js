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
      // Candidate directories (unique): your configured dir, plus safe fallbacks.
      const dirs = Array.from(new Set([CFG.DATA_DIR, 'docs/data', 'data'].filter(Boolean)));

      // When the short “apply changes” watcher is running, skip commits API
      const fastMode = !!window.WATCH_ACTIVE;

      let result = null;
      let usedSha = null;

      if (!fastMode) {
        // Try pinned SHA first (best cache-busting)
        try {
          const sha = await getLatestSha();
          const bases = dirs.map(d => `https://raw.githubusercontent.com/${CFG.OWNER}/${CFG.REPO}/${sha}/${d}`);
          result = await tryLoadBases(bases);
          usedSha = sha;
        } catch (e) {
          // Rate limited or other error -> fall through to branch fallback
          console.warn('[loadData] getLatestSha failed, falling back to branch:', e.message || e);
        }
      }

      // Branch fallback (also used when fastMode is on)
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
      window.dispatchEvent(new CustomEvent('watch:start')); // 2s auto refresh (branch only)
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
      window.dispatchEvent(new CustomEvent('watch:start')); // 2s auto refresh (branch only)
    } catch (err) {
      console.error(err);
      msg(`<span class="err">${err.message}</span>`);
    }
  }

  function wireButtons() {
    const save = $('#btnSavePermit');
    if (save) { save.type = 'button'; save.removeEventListener('click', onSavePermit); save.addEventListener('click', onSavePermit); }
    const del = $('#btnDeletePermit');
    if (del)  { del.type  = 'button'; del.removeEventListener('click', onDeletePermit); del.addEventListener('click', onDeletePermit); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireButtons();
    loadData();
  });

  window.addEventListener('data:loaded', wireButtons);
})();
