// assets/js/watch.js
// Poll HEAD at a safe cadence (default 60s). When it changes, reload pinned to that SHA.
// After a Save/Delete, we temporarily increase cadence to 5s for ~2 minutes.

(function () {
  let lastSha = null;
  let timer = null;
  let interval = 60000;         // normal cadence (60s)
  const FAST = 5000;            // aggressive cadence after edits (5s)
  const FAST_WINDOW_MS = 120000; // 2 minutes

  async function tick() {
    try {
      const sha = await window.getLatestSha();
      if (!lastSha) lastSha = window.STATE.sha || sha;
      if (sha && sha !== lastSha) {
        lastSha = sha;
        await window.loadData(sha);   // load using this exact commit
      }
    } catch (e) {
      // swallow (rate limit/network). We'll retry next tick.
    } finally {
      timer = setTimeout(tick, interval);
    }
  }

  function schedule(ms) {
    interval = ms;
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, interval);
  }

  // Expose a helper for UI to request short-term aggressive polling after edits
  window.startAggressiveWatch = function () {
    schedule(FAST);
    setTimeout(() => schedule(60000), FAST_WINDOW_MS);
  };

  window.addEventListener('load', () => schedule(interval));
})();
