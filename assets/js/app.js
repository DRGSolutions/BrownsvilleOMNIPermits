// assets/js/app.js
(function () {
  const CFG = window.APP_CONFIG || {};
  const fmt = (n) => new Intl.NumberFormat().format(n);
  const $ = (s) => document.querySelector(s);

  const STATE = { poles: [], permits: [], sha: null, loadedAt: null };
  window.STATE = STATE;

  function setKPIs() {
    $('#kPoles').textContent   = fmt(STATE.poles.length);
    $('#kPermits').textContent = fmt(STATE.permits.length);
    $('#kLoaded').textContent  = STATE.loadedAt ? new Date(STATE.loadedAt).toLocaleString() : '—';
    $('#kSha').textContent     = STATE.sha || (CFG.BRANCH || 'main');
    $('#status').textContent   = 'Loaded.';
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

  // Raw fetch pinned to a ref (commit or branch) with small retry loop for CDN propagation.
  async function fetchRawJsonAtRef(filename, ref, attempts = 4) {
    const base = `https://raw.githubusercontent.com/${CFG.OWNER}/${CFG.REPO}/${ref}/${CFG.DATA_DIR}`;
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        const bust = `?ts=${Date.now()}-${i}`;
        const r = await fetch(`${base}/${filename}${bust}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`${filename} ${r.status}`);
        return await r.json();
      } catch (e) {
        lastErr = e;
        // Backoff 0.8s, 1.6s, 2.4s… (capped)
        await new Promise(res => setTimeout(res, Math.min(800 * (i + 1), 2400)));
      }
    }
    throw lastErr;
  }

  // If ref is provided, we use it; otherwise we ask GitHub for the latest SHA first.
  async function loadData(ref) {
    try {
      $('#status').textContent = 'Loading…';
      const sha = ref || (await getLatestSha().catch(() => null));
      const usedRef = sha || CFG.BRANCH;

      const [poles, permits] = await Promise.all([
        fetchRawJsonAtRef('poles.json', usedRef),
        fetchRawJsonAtRef('permits.json', usedRef)
      ]);

      STATE.poles = poles;
      STATE.permits = permits;
      STATE.sha = sha || CFG.BRANCH;
      STATE.loadedAt = Date.now();
      setKPIs();
    } catch (e) {
      console.error('loadData error:', e);
      $('#status').textContent = `Error: ${e.message}`;
    }
  }
  window.loadData = loadData;

  // initial load
  window.addEventListener('load', () => loadData());
})();
