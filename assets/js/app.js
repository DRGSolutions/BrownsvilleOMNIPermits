// assets/js/app.js
(function () {
  const CFG = window.APP_CONFIG || {};
  const fmt = (n) => new Intl.NumberFormat().format(n);
  const $ = (s) => document.querySelector(s);

  const STATE = { poles: [], permits: [], sha: null, loadedAt: null };
  window.STATE = STATE;

  function setKPIs() {
    $('#kPoles').textContent  = fmt(STATE.poles.length);
    $('#kPermits').textContent= fmt(STATE.permits.length);
    $('#kLoaded').textContent = STATE.loadedAt ? new Date(STATE.loadedAt).toLocaleString() : '—';
    $('#kSha').textContent    = STATE.sha || (CFG.BRANCH || 'main');
    $('#status').textContent  = 'Loaded.';
    window.dispatchEvent(new CustomEvent('data:loaded'));
  }

  async function getLatestSha() {
    const url = `https://api.github.com/repos/${CFG.OWNER}/${CFG.REPO}/commits/${CFG.BRANCH}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`GitHub API ${r.status}`);
    const j = await r.json();
    return j.sha;
  }
  window.getLatestSha = getLatestSha;

  async function loadData() {
    try {
      $('#status').textContent = 'Loading…';

      let sha = null;
      try { sha = await getLatestSha(); } catch (_) { /* fall back to branch */ }
      const ref = sha || CFG.BRANCH;

      const base = `https://raw.githubusercontent.com/${CFG.OWNER}/${CFG.REPO}/${ref}/${CFG.DATA_DIR}`;
      const bust = `?ts=${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const [r1, r2] = await Promise.all([
        fetch(`${base}/poles.json${bust}`,   { cache: 'no-store' }),
        fetch(`${base}/permits.json${bust}`, { cache: 'no-store' })
      ]);
      if (!r1.ok || !r2.ok) throw new Error(`HTTP ${r1.status}/${r2.status}`);
      const [j1, j2] = await Promise.all([r1.json(), r2.json()]);
      STATE.poles = j1; STATE.permits = j2; STATE.sha = sha || CFG.BRANCH; STATE.loadedAt = Date.now();
      setKPIs();
    } catch (e) {
      console.error(e);
      $('#status').textContent = `Error: ${e.message}`;
    }
  }
  window.loadData = loadData;

  // bootstrap
  window.addEventListener('load', loadData);
})();
