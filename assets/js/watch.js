// assets/js/watch.js
// Simple always-on watcher: polls repo HEAD every 5s; if SHA changes, reloads data.
(function () {
  let lastSha = null;

  async function tick() {
    try {
      const sha = await window.getLatestSha();
      if (!lastSha) lastSha = window.STATE.sha || sha;
      if (sha && sha !== lastSha) {
        lastSha = sha;
        await window.loadData();  // will emit data:loaded → UI refresh
      }
    } catch (_) {
      // ignore temporary GitHub API rate limits; we'll try again next tick
    } finally {
      setTimeout(tick, 5000);
    }
  }

  window.addEventListener('load', tick);
})();
