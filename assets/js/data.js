// assets/js/data.js
// Loads poles/permits from your repo. Robust against:
// - missing DOM elements
// - GitHub API hiccups (falls back to branch fetch)
// - caching (uses cache-busting query)

(() => {
  const CFG = (window.APP_CONFIG || {});
  const OWNER           = CFG.OWNER           ?? 'DRGSolutions';
  const REPO            = CFG.REPO            ?? 'BrownsvilleOMNIPermits';
  const DEFAULT_BRANCH  = CFG.DEFAULT_BRANCH  ?? 'main';
  const DATA_REPO_PATH  = CFG.DATA_REPO_PATH  ?? 'data';

  const elStatus  = document.getElementById('status');
  const elKPoles  = document.getElementById('kPoles');
  const elKPerms  = document.getElementById('kPermits');
  const elKLoaded = document.getElementById('kLoaded');

  const STATE = {
    poles: [],
    permits: [],
    currentRef: null,
    lastLoadedAt: null,
  };

  function setStatus(msg, kind = 'info') {
    if (!elStatus) return;
    const cls = kind === 'err' ? 'err' : (kind === 'ok' ? 'ok' : 'muted');
    elStatus.innerHTML = `<span class="${cls}">${msg}</span>`;
  }

  async function getLatestSha() {
    const url = `https://api.github.com/repos/${OWNER}/${REPO}/commits/${DEFAULT_BRANCH}?_=${Date.now()}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`GitHub API ${r.status} when reading latest commit`);
    const j = await r.json();
    if (!j || !j.sha) throw new Error('Missing commit sha in GitHub response');
    return j.sha;
  }

  async function loadData() {
    try {
      if (elStatus) elStatus.textContent = 'Loading…';

      // Try to pin by commit; if that fails (rate limit, etc.), fall back to branch
      let ref = DEFAULT_BRANCH;
      let pinned = false;
      try {
        ref = await getLatestSha();
        pinned = true;
      } catch (e) {
        console.warn('getLatestSha failed, falling back to branch:', e);
        ref = DEFAULT_BRANCH;
        pinned = false;
      }
      STATE.currentRef = ref;

      const base = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${ref}/${DATA_REPO_PATH}`;
      const bust = `?v=${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const [r1, r2] = await Promise.all([
        fetch(`${base}/poles.json${bust}`,   { cache: 'no-store' }),
        fetch(`${base}/permits.json${bust}`, { cache: 'no-store' }),
      ]);

      if (!r1.ok || !r2.ok) {
        throw new Error(`HTTP ${r1.status}/${r2.status} when fetching poles/permits`);
      }

      const [poles, permits] = await Promise.all([r1.json(), r2.json()]);
      STATE.poles   = Array.isArray(poles) ? poles : [];
      STATE.permits = Array.isArray(permits) ? permits : [];
      STATE.lastLoadedAt = new Date();

      if (elKPoles)  elKPoles.textContent  = new Intl.NumberFormat().format(STATE.poles.length);
      if (elKPerms)  elKPerms.textContent  = new Intl.NumberFormat().format(STATE.permits.length);
      if (elKLoaded) elKLoaded.textContent = STATE.lastLoadedAt.toLocaleString();

      const refMsg = pinned ? `commit <code>${String(ref).slice(0,7)}</code>` : `branch <code>${DEFAULT_BRANCH}</code>`;
      setStatus(`Loaded from ${refMsg}.`, 'ok');

      // Tell UI layer to render
      if (typeof window.renderList === 'function') {
        window.renderList();
      }
      if (typeof window.renderPending === 'function') {
        window.renderPending();
      }
    } catch (err) {
      console.error('loadData error:', err);
      setStatus(`Error: ${err.message}`, 'err');
    }
  }

  // Expose
  window.DATA = {
    OWNER, REPO, DEFAULT_BRANCH, DATA_REPO_PATH,
    getLatestSha, loadData, STATE, setStatus
  };
})();
