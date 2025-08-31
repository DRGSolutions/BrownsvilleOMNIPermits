// assets/js/app.js
(function(){
  const CFG = window.APP_CONFIG || {};
  const $ = (s) => document.querySelector(s);
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
      if (p1.ok && p2.ok) {
        return { poles: p1.json, permits: p2.json, base };
      }
      if (!p1.ok) errors.push(`poles.json ${p1.status} @ ${p1.url}`);
      if (!p2.ok) errors.push(`permits.json ${p2.status} @ ${p2.url}`);
    }
    const last = errors.slice(-1)[0] || 'Unknown fetch error';
    throw new Error(last);
  }

  // -------- Main load --------
  async function loadData() {
    const status = $('#status');
    status.textContent = 'Loading…';

    try {
      // Candidate directories (unique): your configured dir, plus safe fallbacks.
      const dirs = Array.from(new Set([CFG.DATA_DIR, 'docs/data', 'data'].filter(Boolean)));

      // 1) Try pinned SHA (strongest cache-busting)
      let sha = await getLatestSha();
      let bases = dirs.map(d => `https://raw.githubusercontent.com/${CFG.OWNER}/${CFG.REPO}/${sha}/${d}`);
      let result;
      try {
        result = await tryLoadBases(bases);
        window.STATE = { ...result, sha, from: 'sha' };
      } catch {
        // 2) Branch fallback (in case path moved in latest commit)
        bases = dirs.map(d => `https://raw.githubusercontent.com/${CFG.OWNER}/${CFG.REPO}/${CFG.DEFAULT_BRANCH}/${d}`);
        result = await tryLoadBases(bases);
        window.STATE = { ...result, sha: CFG.DEFAULT_BRANCH, from: 'branch' };
      }

      // Update KPIs
      $('#kPoles').textContent  = fmt(window.STATE.poles.length);
      $('#kPermits').textContent= fmt(window.STATE.permits.length);
      $('#kLoaded').textContent = new Date().toLocaleString();
      $('#kSha').textContent    = window.STATE.from === 'sha'
        ? String(window.STATE.sha).slice(0,7)
        : `${CFG.DEFAULT_BRANCH} (fallback)`;

      status.innerHTML = window.STATE.from === 'sha'
        ? `<span style="color:#34d399">Loaded from commit ${String(window.STATE.sha).slice(0,7)}</span>`
        : `<span style="color:#f59e0b">Loaded from branch (fallback)</span>`;

      // Announce to UI/admin modules
      window.dispatchEvent(new Event('data:loaded'));
    } catch (e) {
      // Helpful message incl. last failing URL & code
      $('#kPoles').textContent = '—';
      $('#kPermits').textContent = '—';
      $('#kLoaded').textContent = '—';
      $('#kSha').textContent = '—';
      const hint = `
        <div class="small muted" style="margin-top:6px">
          • Check <code>APP_CONFIG.DATA_DIR</code> in <code>assets/js/config.js</code> (e.g. <code>data</code> vs <code>docs/data</code>).<br/>
          • If the repo is <b>private</b>, raw URLs return 404. Make it public or add a data proxy endpoint.
        </div>`;
      $('#status').innerHTML = `<span style="color:#ef4444">Error: ${e.message}</span>${hint}`;
      console.error('[loadData]', e);
    }
  }

  // Expose for the 2-second “pending changes” watcher
  window.getLatestRepoSha = async function() {
    try { return await getLatestSha(); } catch { return null; }
  };
  window.reloadData = loadData;

  document.addEventListener('DOMContentLoaded', loadData);
})();
