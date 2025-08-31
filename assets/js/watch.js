// assets/js/watch.js
(function () {
  const CFG = window.APP_CONFIG || {};
  let timer = null;

  async function tick() {
    try {
      // If SHA polling works, reload only when the SHA changes
      try {
        const sha = await window.getLatestSha();
        if (sha && window.STATE && window.STATE.sha && sha !== window.STATE.sha) {
          // Repo advanced — refresh data
          await window.loadData();
        } else if (!window.STATE || !window.STATE.sha) {
          // First time or missing sha — (re)load
          await window.loadData();
        }
      } catch (apiErr) {
        // If rate-limited or offline, gently refresh on a timer so the UI keeps moving
        console.warn('[watch] commit poll failed, soft-refreshing:', apiErr.message);
        await window.loadData();
      }
    } catch (e) {
      console.warn('[watch] tick failed:', e);
    } finally {
      timer = setTimeout(tick, CFG.POLL_MS || 5000);
    }
  }

  function startWatcher() {
    if (!timer) tick();
  }

  window.addEventListener('DOMContentLoaded', startWatcher);
  window.startWatcher = startWatcher; // (optional) manual start
})();
