// assets/js/app.js
(function () {
  const $ = (s) => document.querySelector(s);

  const CFG = window.CONFIG || {};
  const OWNER  = CFG.OWNER;
  const REPO   = CFG.REPO;
  const BRANCH = CFG.DEFAULT_BRANCH || 'main';
  const DATA_DIR = CFG.DATA_DIR || 'data';

  // ---- Status helpers ----
  function setStatus(msgHtml) {
    const el = $('#status');
    if (el) el.innerHTML = msgHtml || '';
  }
  function kpi(id, val) {
    const el = $(id);
    if (el) el.textContent = val;
  }
  function fmt(n) { return new Intl.NumberFormat().format(n); }
  function nowLocal() { return new Date().toLocaleString(); }

  // ---- GitHub fetch (pinned-to-SHA, branch fallback) ----
  async function getLatestSha() {
    const r = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/commits/${BRANCH}?_=${Date.now()}`,
      { cache: 'no-store' }
    );
    if (!r.ok) throw new Error(`GitHub API ${r.status} (latest commit)`);
    const j = await r.json();
    return j.sha;
  }

  async function fetchDataAtSha(sha) {
    const bust = `?ts=${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const base = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${sha}/${DATA_DIR}`;
    const [r1, r2] = await Promise.all([
      fetch(`${base}/poles.json${bust}`,   { cache: 'no-store' }),
      fetch(`${base}/permits.json${bust}`, { cache: 'no-store' })
    ]);
    if (!r1.ok || !r2.ok) throw new Error(`raw ${r1.status}/${r2.status}`);
    const [poles, permits] = await Promise.all([r1.json(), r2.json()]);
    return { poles, permits, sha };
  }

  async function fetchDataBranchFallback() {
    const bust = `?ts=${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const base = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${DATA_DIR}`;
    const [r1, r2] = await Promise.all([
      fetch(`${base}/poles.json${bust}`,   { cache: 'no-store' }),
      fetch(`${base}/permits.json${bust}`, { cache: 'no-store' })
    ]);
    if (!r1.ok || !r2.ok) throw new Error(`raw ${r1.status}/${r2.status}`);
    const [poles, permits] = await Promise.all([r1.json(), r2.json()]);
    return { poles, permits, sha: null };
  }

  async function loadData() {
    try {
      setStatus('Loading…');
      let data;
      try {
        const sha = await getLatestSha();
        data = await fetchDataAtSha(sha);
        setStatus(`<span class="ok">Loaded from commit <code>${data.sha.slice(0,7)}</code>.</span>`);
      } catch {
        data = await fetchDataBranchFallback();
        setStatus(`<span class="ok">Loaded (branch fallback).</span>`);
      }

      const prev = window.STATE || {};
      window.STATE = {
        ...prev,
        poles: data.poles || [],
        permits: data.permits || [],
        sha: data.sha,
        lastLoaded: new Date().toISOString()
      };

      kpi('#kPoles',   fmt((window.STATE.poles || []).length));
      kpi('#kPermits', fmt((window.STATE.permits || []).length));
      kpi('#kLoaded',  nowLocal());
      if (window.STATE.sha) kpi('#kSha', window.STATE.sha.slice(0,7));

      // Tell UI to render
      window.dispatchEvent(new CustomEvent('data:loaded'));
    } catch (err) {
      console.error(err);
      setStatus(`<span class="err">Error: ${err.message}</span>`);
    }
  }

  // ---- API call helper (reads CONFIG lazily so cache issues don't bite us) ----
  function cfgVal(k){ return (window.CONFIG && window.CONFIG[k]) || ''; }

  async function callApi(payload) {
    const API_URL   = cfgVal('API_URL');       // <-- read at call time
    const SHARED_KEY= cfgVal('SHARED_KEY');    // <--

    if (!API_URL) {
      const msg = 'Missing CONFIG.API_URL';
      console.error(msg, window.CONFIG);
      throw new Error(msg);
    }

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Permits-Key': SHARED_KEY || ''
      },
      body: JSON.stringify(payload)
    });
    let data;
    try { data = await res.json(); } catch { data = { ok: false, error: 'Invalid server response' }; }
    if (!res.ok || !data.ok) {
      const details = data && data.details ? `\n${JSON.stringify(data.details, null, 2)}` : '';
      throw new Error((data && data.error) ? (data.error + details) : `HTTP ${res.status}`);
    }
    return data; // { ok:true, pr_url, branch }
  }

  // ---- Save / Delete handlers ----
  function msg(textHtml) {
    const el = $('#msgPermit');
    if (el) el.innerHTML = textHtml || '';
  }

  async function onSavePermit(ev) {
    if (ev) ev.preventDefault();
    const btn = $('#btnSavePermit');
    if (btn && (!btn.type || btn.type.toLowerCase() === 'submit')) btn.type = 'button';

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

    const st = window.STATE || {};
    const exists = (st.permits || []).some(r => String(r.permit_id) === String(f.permit_id));

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
      // watch.js will pick up and refresh
      window.dispatchEvent(new CustomEvent('watch:start'));
    } catch (err) {
      console.error(err);
      msg(`<span class="err">${err.message}</span>`);
    }
  }

  async function onDeletePermit(ev) {
    if (ev) ev.preventDefault();
    const btn = $('#btnDeletePermit');
    if (btn && (!btn.type || btn.type.toLowerCase() === 'submit')) btn.type = 'button';

    const id = ($('#permit_id')?.value || '').trim();
    if (!id) { msg('<span class="err">Permit ID is required to delete.</span>'); return; }

    try {
      msg('Submitting delete…');
      const data = await callApi({
        actorName: 'Website User',
        reason: `Delete ${id}`,
        change: { type: 'delete_permit', permit_id: id } // server supports delete_permit
      });
      msg(`<span class="ok">Delete submitted.</span> <a class="link" href="${data.pr_url}" target="_blank" rel="noopener">View PR</a>`);
      window.dispatchEvent(new CustomEvent('watch:start'));
    } catch (err) {
      console.error(err);
      msg(`<span class="err">${err.message}</span>`);
    }
  }

  function wireButtons() {
    const save = $('#btnSavePermit');
    if (save) {
      if (!save.type || save.type.toLowerCase() === 'submit') save.type = 'button';
      save.removeEventListener('click', onSavePermit);
      save.addEventListener('click', onSavePermit);
    }
    const del = $('#btnDeletePermit');
    if (del) {
      if (!del.type || del.type.toLowerCase() === 'submit') del.type = 'button';
      del.removeEventListener('click', onDeletePermit);
      del.addEventListener('click', onDeletePermit);
    }
  }

  // ---- boot ----
  document.addEventListener('DOMContentLoaded', () => {
    wireButtons();
    loadData();
  });

  // also re-enable buttons whenever data loads
  window.addEventListener('data:loaded', wireButtons);
})();
