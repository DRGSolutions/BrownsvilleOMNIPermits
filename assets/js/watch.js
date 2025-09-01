// assets/js/watch.js
// Watches AFTER Save/Delete, shows an animated progress bar, and refreshes when data reflects the PR.
// - Starts only when the PR link appears in #msgPermit (so we know the request succeeded).
// - Polls branch raw JSON (no commits API) every 2s for up to 120s.
// - For Save: verifies expected fields; For Delete: verifies the permit is gone.
// - Compatible with window.APP_CONFIG or window.CONFIG.

(function () {
  // ---- Config ----
  const CFG = (window.APP_CONFIG || window.CONFIG || {});
  const OWNER   = CFG.OWNER;
  const REPO    = CFG.REPO;
  const BRANCH  = CFG.DEFAULT_BRANCH || 'main';
  const DATA_DIR= (CFG.DATA_DIR || 'data').replace(/^\/+|\/+$/g, '');

  const $ = (s) => document.querySelector(s);

  // Internal state
  let pollTimer   = null;
  let prTimer     = null;   // optional, for PR status text only (not required)
  let deadline    = 0;
  let startedAt   = 0;
  let ctx         = null;   // { kind: 'save'|'delete', expected:{...}, prUrl?:string, prNum?:string }

  // --------------- UI: progress bar ----------------
  function renderProgress(percent, headline, subline) {
    const el = $('#msgPermit');
    if (!el) return;

    const pct = Math.max(0, Math.min(100, percent|0));
    el.innerHTML = `
      <div style="border:1px solid #2a3242;border-radius:10px;padding:10px;background:#0f1219">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div class="small muted">${headline || 'Processing…'}</div>
          <div class="small muted">${pct}%</div>
        </div>
        <div style="position:relative;height:12px;border:1px solid #2a3242;border-radius:8px;overflow:hidden;background:#0c1118">
          <div style="
              width:${pct}%;
              height:100%;
              background: repeating-linear-gradient(
                45deg,
                #223043 0px, #223043 10px,
                #2d3b4f 10px, #2d3b4f 20px
              );
              box-shadow: inset 0 0 4px rgba(0,0,0,.6);">
          </div>
        </div>
        ${subline ? `<div class="small muted" style="margin-top:8px">${subline}</div>` : ''}
        ${ctx?.prUrl ? `<div class="small" style="margin-top:6px">
            <a class="link" href="${ctx.prUrl}" target="_blank" rel="noopener">View PR #${ctx.prNum || ''}</a>
          </div>` : ''}
      </div>`;
  }

  function showIndeterminate(text) {
    const el = $('#msgPermit');
    if (!el) return;
    el.innerHTML = `
      <div style="border:1px solid #2a3242;border-radius:10px;padding:10px;background:#0f1219">
        <div class="small muted" style="margin-bottom:8px">${text || 'Processing…'}</div>
        <div style="position:relative;height:12px;border:1px solid #2a3242;border-radius:8px;overflow:hidden;background:#0c1118">
          <div style="
              width:40%;height:100%;
              background:linear-gradient(90deg,#1f2937,#334155,#1f2937);
              animation:slideBar 1.1s infinite;opacity:.9;border-right:1px solid #2a3242"></div>
        </div>
        <style>@keyframes slideBar{0%{transform:translateX(-40%)}100%{transform:translateX(260%)}}</style>
      </div>`;
  }

  function finish(msg, ok=true) {
    const el = $('#msgPermit');
    if (el) {
      el.innerHTML = `<span class="small" style="color:${ok ? '#6ee7b7':'#fca5a5'}">${msg}</span>`;
      // clear after a few seconds
      setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 5000);
    }
  }

  // --------------- Helpers ----------------
  function parsePrNumberFromUrl(url) {
    try {
      const m = /\/pull\/(\d+)/.exec(url);
      return m ? m[1] : '';
    } catch { return ''; }
  }

  async function reloadFromBranch() {
    const bust = `?ts=${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const base = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${DATA_DIR}`;
    const [r1, r2] = await Promise.all([
      fetch(`${base}/poles.json${bust}`,   { cache: 'no-store' }),
      fetch(`${base}/permits.json${bust}`, { cache: 'no-store' })
    ]);
    if (!r1.ok || !r2.ok) throw new Error(`raw ${r1.status}/${r2.status}`);
    const [poles, permits] = await Promise.all([r1.json(), r2.json()]);

    // update global STATE so UI re-renders
    const prev = window.STATE || {};
    window.STATE = {
      ...prev,
      poles, permits,
      sha: null, // unknown here
      lastLoaded: new Date().toISOString()
    };

    // KPIs
    const numFmt = new Intl.NumberFormat();
    const now = new Date().toLocaleString();
    const kSha = $('#kSha'), kLoaded = $('#kLoaded'), kPoles = $('#kPoles'), kPermits = $('#kPermits');
    if (kSha)    kSha.textContent = `${BRANCH} (fallback)`;
    if (kLoaded) kLoaded.textContent = now;
    if (kPoles)  kPoles.textContent = numFmt.format(poles.length);
    if (kPermits)kPermits.textContent = numFmt.format(permits.length);

    // let UI rebuild the list
    window.dispatchEvent(new CustomEvent('data:loaded'));
    return { poles, permits };
  }

  // tolerant expected matcher (save)
  function matchesExpectedPermit(list, exp) {
    const rec = list.find(x => String(x.permit_id) === String(exp.permit_id));
    if (!rec) return false;
    const EPS = 1e-9;
    for (const [k, vExp] of Object.entries(exp)) {
      if (k === 'permit_id') continue;
      const v = rec[k];
      if (v === vExp) continue;
      // loose compare
      if (v != null && vExp != null && String(v) == String(vExp)) continue; // eslint-disable-line eqeqeq
      // numeric close
      const n1 = Number(v), n2 = Number(vExp);
      if (!Number.isNaN(n1) && !Number.isNaN(n2) && Math.abs(n1 - n2) < EPS) continue;
      return false;
    }
    return true;
  }

  // --------------- Poll loop ----------------
  async function tick() {
    // deadline
    if (Date.now() > deadline) {
      stop(false, `Still processing — it may take a few more seconds for GitHub to update.`);
      return;
    }

    // Progress percent (heuristic: 15% once PR link seen, 60% once we see PR likely merged (optional), 100% when data matches)
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    renderProgress(15, `PR opened — watching for repository update…`, `Auto-refreshing every 2s (${elapsed}s)`);

    try {
      const { permits } = await reloadFromBranch();

      if (ctx.kind === 'delete') {
        const stillThere = permits.some(r => String(r.permit_id) === String(ctx.expected.permit_id));
        if (!stillThere) {
          renderProgress(100, `Change applied — data is up to date.`, `PR${ctx.prNum ? ' #'+ctx.prNum : ''} merged & data refreshed.`);
          stop(true);
          return;
        } else {
          renderProgress(60, `Waiting for PR merge and CDN update…`, `Auto-refreshing every 2s (${elapsed}s)`);
        }
      } else { // save
        if (matchesExpectedPermit(permits, ctx.expected)) {
          renderProgress(100, `Change applied — data is up to date.`, `PR${ctx.prNum ? ' #'+ctx.prNum : ''} merged & data refreshed.`);
          stop(true);
          return;
        } else {
          renderProgress(60, `Waiting for PR merge and CDN update…`, `Auto-refreshing every 2s (${elapsed}s)`);
        }
      }
    } catch (e) {
      // transient; keep indeterminate and try again
      showIndeterminate(`Waiting for repository update… (${elapsed}s)`);
    }
  }

  function startWatching(kind, expected, prUrl) {
    ctx = { kind, expected, prUrl: prUrl || '', prNum: prUrl ? parsePrNumberFromUrl(prUrl) : '' };
    startedAt = Date.now();
    deadline = startedAt + 120000; // 2 minutes max

    // Initial progress
    showIndeterminate('Submitting… PR opened — monitoring for merge & data update.');

    // begin polling
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(tick, 2000);
    tick(); // run immediately
  }

  function stop(ok, finalText) {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (prTimer)   { clearInterval(prTimer);   prTimer   = null; }
    finish(finalText || (ok ? 'Done.' : 'Stopped.'), !!ok);
    ctx = null;
  }

  // --------------- Wiring ----------------
  // We want to start *after* the request succeeds (when app.js writes the PR link into #msgPermit).
  // To know *what* to look for, we capture the form snapshot at click time (save/delete)
  // and then begin watching once the PR link appears.
  let pendingAction = null; // { kind:'save'|'delete', expected:{...} }

  function captureFormExpected(kind) {
    if (typeof window.UI_collectPermitForm !== 'function') return null;
    const f = window.UI_collectPermitForm();
    if (!f) return null;
    if (kind === 'delete') {
      const id = (document.querySelector('#permit_id')?.value || '').trim();
      if (!id) return null;
      return { permit_id: id };
    }
    // save: must include date per your rule
    if (!f.submitted_at) {
      const el = $('#msgPermit');
      if (el) el.innerHTML = '<span class="small" style="color:#fca5a5">Please select a date before saving.</span>';
      return null;
    }
    return {
      permit_id:     f.permit_id,
      job_name:      f.job_name,
      tag:           f.tag,
      SCID:          f.SCID,
      permit_status: f.permit_status,
      submitted_by:  f.submitted_by,
      submitted_at:  f.submitted_at,
      notes:         f.notes
    };
  }

  function wireButtons() {
    const save = $('#btnSavePermit');
    if (save) {
      save.addEventListener('click', () => {
        const exp = captureFormExpected('save');
        if (exp) {
          pendingAction = { kind: 'save', expected: exp };
          showIndeterminate('Submitting…');
        }
      }, { capture: true });
    }
    const del = $('#btnDeletePermit');
    if (del) {
      del.addEventListener('click', () => {
        const exp = captureFormExpected('delete');
        if (exp) {
          pendingAction = { kind: 'delete', expected: exp };
          showIndeterminate('Submitting delete…');
        }
      }, { capture: true });
    }
  }

  // Observe #msgPermit for the "View PR" link that app.js renders on success
  function wireObserver() {
    const target = $('#msgPermit');
    if (!target) return;
    const mo = new MutationObserver(() => {
      if (!pendingAction) return;

      const a = target.querySelector('a[href*="/pull/"]');
      if (a && a.href) {
        // We have the PR URL -> start full watch flow
        const prUrl = a.href;
        const { kind, expected } = pendingAction;
        pendingAction = null;
        startWatching(kind, expected, prUrl);
      }
    });
    mo.observe(target, { childList: true, subtree: true });
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireButtons();
    wireObserver();
  });
})();
