// assets/js/app.js
(function () {
  const $ = (s) => document.querySelector(s);

  // ----- CONFIG + SAFE FALLBACKS -----
  const CFG = window.CONFIG || {};

  function guessOwnerRepo() {
    try {
      const host = location.hostname;
      const parts = location.pathname.split('/').filter(Boolean);
      if (host.endsWith('github.io') && parts.length >= 1) {
        return { owner: host.split('.')[0], repo: parts[0] };
      }
    } catch { /* ignore */ }
    return { owner: null, repo: null };
  }
  const g = guessOwnerRepo();

  const OWNER  = CFG.OWNER  || g.owner || 'DRGSolutions';
  const REPO   = CFG.REPO   || g.repo  || 'BrownsvilleOMNIPermits';
  const BRANCH = CFG.DEFAULT_BRANCH || 'main';
  const API_URL = CFG.API_URL;
  const SHARED_KEY = CFG.SHARED_KEY;

  // normalize dir (strip leading/trailing slashes)
  const normDir = (d) => String(d || '')
    .replace(/^\s+|\s+$/g,'')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');

  const DATA_DIR_CANDIDATES = [normDir(CFG.DATA_DIR || 'data'), 'data', 'docs/data']
    .map(normDir)
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);

  // Debug the effective targets once in console (helps if something goes wrong)
  console.debug('[app] Using repo:', { OWNER, REPO, BRANCH, DATA_DIR_CANDIDATES });

  // ----- UI helpers -----
  const setStatus = (html) => { const el = $('#status'); if (el) el.innerHTML = html || ''; };
  const kpi = (sel, val) => { const el = $(sel); if (el) el.textContent = val; };
  const fmt = (n) => new Intl.NumberFormat().format(n);
  const nowLocal = () => new Date().toLocaleString();

  // ----- GitHub fetch (pinned-to-SHA, branch fallback) -----
  async function getLatestSha() {
    const r = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/commits/${BRANCH}?_=${Date.now()}`,
      { cache: 'no-store' }
    );
    if (!r.ok) throw new Error(`GitHub API ${r.status} (latest commit)`);
    const j = await r.json();
    return j.sha;
  }

  async function tryDirs(ref) {
    const bust = `?ts=${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const attempts = [];

    for (const dir of DATA_DIR_CANDIDATES) {
      const base = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${ref}/${dir}`;
      const polesUrl   = `${base}/poles.json${bust}`;
      const permitsUrl = `${base}/permits.json${bust}`;

      const [r1, r2] = await Promise.allSettled([
        fetch(polesUrl,   { cache: 'no-store' }),
        fetch(permitsUrl, { cache: 'no-store' })
      ]);

      attempts.push({
        dir, polesUrl, permitsUrl,
        polesStatus:   r1.status === 'fulfilled' ? r1.value.status : `ERR:${r1.reason}`,
        permitsStatus: r2.status === 'fulfilled' ? r2.value.status : `ERR:${r2.reason}`
      });

      const ok1 = r1.status === 'fulfilled' && r1.value.ok;
      const ok2 = r2.status === 'fulfilled' && r2.value.ok;
      if (ok1 && ok2) {
        const [poles, permits] = await Promise.all([r1.value.json(), r2.value.json()]);
        return { poles, permits, dirUsed: dir, attempts };
      }
    }

    const detail = attempts
      .map(a => `${a.dir}: poles(${a.polesStatus}) ${a.polesUrl} | permits(${a.permitsStatus}) ${a.permitsUrl}`)
      .join('<br/>');
    throw new Error(`raw 404/404<br/><small>${detail}</small>`);
  }

  async function loadData() {
    try {
      setStatus('Loading…');
      let sha = null, dirUsed = null, poles = [], permits = [];

      try {
        sha = await getLatestSha();
        const got = await tryDirs(sha);
        dirUsed = got.dirUsed; poles = got.poles; permits = got.permits;
        setStatus(`<span class="ok">Loaded from commit <code>${sha.slice(0,7)}</code> (dir: <code>${dirUsed}</code>).</span>`);
      } catch (ePinned) {
        console.warn('Pinned load failed, falling back to branch:', ePinned);
        const got = await tryDirs(BRANCH);
        dirUsed = got.dirUsed; poles = got.poles; permits = got.permits;
        setStatus(`<span class="ok">Loaded (branch fallback, dir: <code>${dirUsed}</code>).</span>`);
      }

      const prev = window.STATE || {};
      window.STATE = {
        ...prev,
        poles: poles || [],
        permits: permits || [],
        sha,
        dataDirUsed: dirUsed,
        lastLoaded: new Date().toISOString()
      };

      kpi('#kPoles',   fmt((window.STATE.poles || []).length));
      kpi('#kPermits', fmt((window.STATE.permits || []).length));
      kpi('#kLoaded',  nowLocal());
      kpi('#kSha',     sha ? sha.slice(0,7) : '—');

      window.dispatchEvent(new CustomEvent('data:loaded'));
    } catch (err) {
      console.error(err);
      setStatus(`<span class="err">Error: ${err.message}</span>`);
    }
  }

  // ----- API call helper -----
  async function callApi(payload) {
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
    return data;
  }

  // ----- Save / Delete handlers (unchanged in behavior) -----
  const msg = (html) => { const el = $('#msgPermit'); if (el) el.innerHTML = html || ''; };

  async function onSavePermit(ev) {
    if (ev) ev.preventDefault();
    const btn = $('#btnSavePermit');
    if (btn && (!btn.type || btn.type.toLowerCase() === 'submit')) btn.type = 'button';

    if (typeof window.UI_collectPermitForm !== 'function') {
      msg('<span class="err">Internal error: form collector missing.</span>'); return;
    }

    const f = window.UI_collectPermitForm();
    if (!f.job_name || !f.tag || !f.SCID) { msg('<span class="err">Missing pole keys (job_name, tag, SCID).</span>'); return; }
    if (!f.permit_id) { msg('<span class="err">Permit ID is required.</span>'); return; }
    if (!f.permit_status) { msg('<span class="err">Permit Status is required.</span>'); return; }
    if (!f.submitted_by) { msg('<span class="err">Submitted By is required.</span>'); return; }
    if (!f.submitted_at) { msg('<span class="err">Submitted At (date) is required.</span>'); return; }

    const st = window.STATE || {};
    const exists = (st.permits || []).some(r => String(r.permit_id) === String(f.permit_id));

    const change = exists
      ? { type: 'update_permit', permit_id: f.permit_id,
          patch: {
            job_name: f.job_name, tag: f.tag, SCID: f.SCID,
            permit_status: f.permit_status, submitted_by: f.submitted_by,
            submitted_at: f.submitted_at, notes: f.notes || ''
          } }
      : { type: 'upsert_permit',
          permit: {
            permit_id: f.permit_id, job_name: f.job_name, tag: f.tag, SCID: f.SCID,
            permit_status: f.permit_status, submitted_by: f.submitted_by,
            submitted_at: f.submitted_at, notes: f.notes || ''
          } };

    try {
      msg('Submitting…');
      const data = await callApi({ actorName: 'Website User', reason: `Permit ${f.permit_id}`, change });
      msg(`<span class="ok">Change submitted.</span> <a class="link" href="${data.pr_url}" target="_blank" rel="noopener">View PR</a>`);
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
        change: { type: 'delete_permit', permit_id: id } // backend must support this
      });
      msg(`<span class="ok">Delete submitted.</span> <a class="link" href="${data.pr_url}" target="_blank" rel="noopener">View PR</a>`);
    } catch (err) {
      console.error(err);
      msg(`<span class="err">${err.message}</span>`);
    }
  }

  function wireButtons() {
    const save = $('#btnSavePermit');
    if (save) { if (!save.type || save.type.toLowerCase() === 'submit') save.type = 'button';
      save.removeEventListener('click', onSavePermit); save.addEventListener('click', onSavePermit); }
    const del = $('#btnDeletePermit');
    if (del) { if (!del.type || del.type.toLowerCase() === 'submit') del.type = 'button';
      del.removeEventListener('click', onDeletePermit); del.addEventListener('click', onDeletePermit); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireButtons();
    loadData();
  });
  window.addEventListener('data:loaded', wireButtons);
})();
