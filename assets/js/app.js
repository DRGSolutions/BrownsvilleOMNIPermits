// assets/js/app.js
(function () {
  const CFG = window.APP_CONFIG || {};
  const $ = (sel) => document.querySelector(sel);

  // Global state other scripts (ui.js, watch.js) can read
  const STATE = {
    poles: [],
    permits: [],
    sha: null,           // last commit we successfully loaded
    loadedAt: null,      // Date instance
    fallback: false      // true if we had to skip SHA pinning
  };
  window.STATE = STATE;

  function setStatus(html) {
    const el = $('#status');
    if (el) el.innerHTML = html;
  }
  function setKPIs() {
    const nf = new Intl.NumberFormat();
    $('#kPoles')  && ($('#kPoles').textContent  = nf.format(STATE.poles.length));
    $('#kPermits')&& ($('#kPermits').textContent= nf.format(STATE.permits.length));
    $('#kLoaded') && ($('#kLoaded').textContent = STATE.loadedAt ? STATE.loadedAt.toLocaleString() : '—');
    $('#kSha')    && ($('#kSha').textContent    = STATE.sha ? STATE.sha.slice(0,7) : (STATE.fallback ? `${CFG.BRANCH}*` : '—'));
  }

  async function getLatestSha() {
    // Use the commits API to pin to an exact tree (prevents stale caching).
    const url = `https://api.github.com/repos/${CFG.OWNER}/${CFG.REPO}/commits/${CFG.BRANCH}?_=${Date.now()}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) {
      // Bubble up a clear error so callers can switch to fallback
      throw new Error(`GitHub API ${r.status}`);
    }
    const j = await r.json();
    return j.sha;
  }
  window.getLatestSha = getLatestSha;

  async function loadData() {
    try {
      setStatus('Loading…');

      let base;
      STATE.fallback = false;

      // Try to pin to the latest commit. If rate-limited, fall back to branch.
      try {
        const sha = await getLatestSha();
        STATE.sha = sha;
        base = `https://raw.githubusercontent.com/${CFG.OWNER}/${CFG.REPO}/${sha}/${CFG.DATA_DIR}`;
      } catch (e) {
        console.warn('[app] SHA lookup failed; falling back to branch:', e.message);
        STATE.fallback = true;
        // Still load fresh data directly off branch head
        base = `https://raw.githubusercontent.com/${CFG.OWNER}/${CFG.REPO}/${CFG.BRANCH}/${CFG.DATA_DIR}`;
      }

      const bust = `?ts=${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const [rPoles, rPermits] = await Promise.all([
        fetch(`${base}/poles.json${bust}`,   { cache: 'no-store' }),
        fetch(`${base}/permits.json${bust}`, { cache: 'no-store' })
      ]);

      if (!rPoles.ok || !rPermits.ok) {
        throw new Error(`HTTP ${rPoles.status}/${rPermits.status} (poles/permits)`);
      }

      STATE.poles   = await rPoles.json();
      STATE.permits = await rPermits.json();
      STATE.loadedAt = new Date();

      setKPIs();
      setStatus(`<span class="ok">Loaded${STATE.fallback ? ' (branch fallback)' : ''}.</span>`);

      // Tell the UI to (re)render
      try {
        // Optional: UI renderer provided by assets/js/ui.js
        if (window.renderList) window.renderList();
        // Also emit an event some modules might listen to
        window.dispatchEvent(new CustomEvent('data:loaded', { detail: { sha: STATE.sha, fallback: STATE.fallback }}));
      } catch (e) {
        console.warn('[app] UI render hook failed:', e);
      }
    } catch (err) {
      console.error('[app] loadData error:', err);
      setStatus(`<span class="err">Error: ${err.message}</span>`);
    }
  }
  window.loadData = loadData;

  // Kick off the first load when the page is ready
  window.addEventListener('DOMContentLoaded', () => {
    loadData();
  });
})();
