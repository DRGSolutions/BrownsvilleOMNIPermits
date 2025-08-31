// assets/js/watch.js
// On-demand repository watcher with progress banner.
// Polls HEAD every 2s ONLY after a Save/Delete. When a new commit is detected,
// reloads data pinned to that SHA, then hides the banner.

(function () {
  let intervalId = null;
  let baselineSha = null;
  const POLL_MS = 2000;            // <- aggressive polling, only on-demand
  const HARD_TIMEOUT_MS = 3 * 60 * 1000; // give up banner after 3 minutes

  // --- Lightweight banner UI (injected once) ---
  let banner, msgEl, barEl;
  function ensureBanner() {
    if (banner) return;
    const style = document.createElement('style');
    style.textContent = `
      .prbanner{position:fixed;left:50%;transform:translateX(-50%);bottom:16px;
        background:#111827;border:1px solid #1f2937;color:#e5e7eb;padding:10px 14px;
        border-radius:12px;box-shadow:0 10px 24px rgba(0,0,0,.35);z-index:9999;width:min(640px,92vw)}
      .prbanner .row{display:flex;align-items:center;gap:8px;justify-content:space-between}
      .prbanner .msg{font-size:14px}
      .prbanner .bar{height:6px;border-radius:9999px;background:#1f2937;overflow:hidden;margin-top:8px}
      .prbanner .bar>span{display:block;height:100%;width:0%;background:#60a5fa;transition:width .35s ease}
      .prbanner .ok{color:#34d399}.prbanner .warn{color:#f59e0b}.prbanner .err{color:#f87171}
      .prbanner .link{color:#93c5fd;text-decoration:none}.prbanner .link:hover{text-decoration:underline}
      .prbanner .btn-ghost{background:transparent;border:1px solid #2a3242;color:#e5e7eb;
        padding:5px 10px;border-radius:8px;cursor:pointer}
    `;
    document.head.appendChild(style);

    banner = document.createElement('div');
    banner.className = 'prbanner';
    banner.innerHTML = `
      <div class="row">
        <div class="msg" id="prMsg">Waiting for repository update…</div>
        <button id="prHide" class="btn-ghost">Hide</button>
      </div>
      <div class="bar"><span id="prBar"></span></div>
    `;
    document.body.appendChild(banner);
    msgEl = banner.querySelector('#prMsg');
    barEl = banner.querySelector('#prBar');
    banner.querySelector('#prHide').onclick = () => { banner.style.display = 'none'; };
  }
  function showBanner(html) { ensureBanner(); msgEl.innerHTML = html; banner.style.display = 'block'; }
  function setProgress(pct) { ensureBanner(); barEl.style.width = Math.max(0, Math.min(100, pct)) + '%'; }
  function hideBannerSoon() { setTimeout(() => { if (banner) banner.style.display = 'none'; }, 4000); }

  function stopPolling() { if (intervalId) { clearInterval(intervalId); intervalId = null; } }

  async function poll(prUrl, startedAt) {
    try {
      // HEAD of default branch
      const sha = await window.getLatestSha();
      if (!baselineSha) baselineSha = window.STATE.sha || sha;

      // Friendly progress: ramp to 90% over ~90s; complete to 100% when applied
      const elapsed = Date.now() - startedAt;
      const pct = Math.min(90, Math.round((elapsed / 90000) * 90));
      setProgress(pct);

      // When repo head moves, reload pinned to that SHA
      if (sha && sha !== baselineSha) {
        await window.loadData(sha);
        setProgress(100);
        showBanner(`<span class="ok">Updated from commit <code>${sha.slice(0,7)}</code>.</span>`);
        hideBannerSoon();
        stopPolling();
      }
    } catch (_) {
      // ignore transient errors (rate limit / network); next tick will retry
    }
  }

  // Public: called by UI after Save/Delete.
  window.watchForRepoUpdate = function (prUrl) {
    stopPolling();
    baselineSha = window.STATE.sha || null;
    const startedAt = Date.now();

    showBanner(
      `<span class="warn">Change submitted. Waiting for repository to update…</span>
       ${prUrl ? `&nbsp;<a class="link" target="_blank" rel="noopener" href="${prUrl}">View PR</a>` : ''}`
    );
    setProgress(5);

    intervalId = setInterval(() => poll(prUrl, startedAt), POLL_MS);

    // After HARD_TIMEOUT_MS, keep the last state but stop polling (user can refresh manually)
    setTimeout(() => {
      if (intervalId) {
        stopPolling();
        setProgress(90);
        showBanner(
          `Still pending. It can take a moment to merge & propagate.${prUrl ? ` You can follow progress in the <a class="link" target="_blank" rel="noopener" href="${prUrl}">PR</a>.` : ''}`
        );
      }
    }, HARD_TIMEOUT_MS);
  };
})();
