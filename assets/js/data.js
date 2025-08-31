// assets/js/data.js
// Two-phase loader:
//  1) Load from branch immediately (no API rate limit)
//  2) In background, try to pin to latest commit SHA; if found, reload from that SHA

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
    currentRef: null,     // branch name or commit sha last loaded
    lastLoadedAt: null,
  };

  function setStatus(msg, kind = 'info') {
    if (!elStatus) return;
    const cls = kind === 'err' ? 'err' : (kind === 'ok' ? 'ok' : 'muted');
    elStatus.innerHTML = `<span class="${cls}">${msg}</span>`;
  }

  function fmt(n){ return new Intl.NumberFormat().format(n); }

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error(`${label || 'Operation'} timed out after ${ms}ms`)), ms))
    ]);
  }

  async function getLatestSha() {
    const url = `https://api.github.com/repos/${OWNER}/${REPO}/commits/${DEFAULT_BRANCH}?_=${Date.now()}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`GitHub API ${r.status} when reading latest commit`);
    const j = await r.json();
    if (!j || !j.sha) throw new Error('Missing commit sha in GitHub response');
    return j.sha;
  }

  async function fetchFromRef(ref) {
    const base = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${ref}/${DATA_REPO_PATH}`;
    const bust = `?v=${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // use explicit short timeouts so we never hang on a stalled fetch
    const [r1, r2] = await Promise.all([
      withTimeout(fetch(`${base}/poles.json${bust}`,   { cache: 'no-store' }), 5000, 'poles.json fetch'),
      withTimeout(fetch(`${base}/permits.json${bust}`, { cache: 'no-store' }), 5000, 'permits.json fetch')
    ]);

    if (!r1.ok || !r2.ok) {
      const dbg = `Ref: ${ref} | poles:${r1.status} permits:${r2.status}`;
      throw new Error(`Failed to load data. ${dbg}`);
    }

    const [poles, permits] = await Promise.all([r1.json(), r2.json()]);
    if (!Array.isArray(poles) || !Array.isArray(permits)) {
      throw new Error('Malformed data (expected arrays).');
    }
    return { poles, permits };
  }

  async function loadBranchFirstThenPin() {
    try {
      // Phase 1: branch load (fast path)
      setStatus('Loading… (branch)', 'info');
      const { poles, permits } = await fetchFromRef(DEFAULT_BRANCH);
      STATE.poles = poles;
      STATE.permits = permits;
      STATE.currentRef = DEFAULT_BRANCH;
      STATE.lastLoadedAt = new Date();

      if (elKPoles)  elKPoles.textContent  = fmt(poles.length);
      if (elKPerms)  elKPerms.textContent  = fmt(permits.length);
      if (elKLoaded) elKLoaded.textContent = STATE.lastLoadedAt.toLocaleString();
      setStatus(`Loaded from branch <code>${DEFAULT_BRANCH}</code>.`, 'ok');

      if (typeof window.renderList === 'function') window.renderList();
      if (typeof window.renderPending === 'function') window.renderPending();

      // Phase 2: try to pin to SHA (short timeout so UI never stalls)
      let sha = null;
      try {
        sha = await withTimeout(getLatestSha(), 2000, 'latest commit');
      } catch (e) {
        // Not fatal—stay on branch
        console.warn('Pin-to-commit skipped:', e.message);
        return;
      }

      if (!sha || sha === DEFAULT_BRANCH) return;
      if (sha === STATE.currentRef) return;

      // Reload pinned
      setStatus(`Refreshing from commit <code>${sha.slice(0,7)}</code>…`, 'info');
      const pinned = await fetchFromRef(sha);
      STATE.poles = pinned.poles;
      STATE.permits = pinned.permits;
      STATE.currentRef = sha;
      STATE.lastLoadedAt = new Date();

      if (elKPoles)  elKPoles.textContent  = fmt(STATE.poles.length);
      if (elKPerms)  elKPerms.textContent  = fmt(STATE.permits.length);
      if (elKLoaded) elKLoaded.textContent = STATE.lastLoadedAt.toLocaleString();
      setStatus(`Loaded from commit <code>${sha.slice(0,7)}</code>.`, 'ok');

      if (typeof window.renderList === 'function') window.renderList();
      if (typeof window.renderPending === 'function') window.renderPending();

    } catch (err) {
      console.error('loadData error:', err);
      // Helpful debug with direct URLs user can click
      const urlPoles   = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${DEFAULT_BRANCH}/${DATA_REPO_PATH}/poles.json`;
      const urlPermits = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${DEFAULT_BRANCH}/${DATA_REPO_PATH}/permits.json`;
      setStatus(`Error: ${err.message}<br><span class="small">Try opening <a class="link" href="${urlPoles}" target="_blank" rel="noopener">poles.json</a> and <a class="link" href="${urlPermits}" target="_blank" rel="noopener">permits.json</a> directly to verify access.</span>`, 'err');
    }
  }

  // Expose
  async function loadData() { return loadBranchFirstThenPin(); }

  window.DATA = {
    OWNER, REPO, DEFAULT_BRANCH, DATA_REPO_PATH,
    getLatestSha, loadData, STATE, setStatus
  };
})();
