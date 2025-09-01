// assets/js/watch.js
// Watches AFTER Save/Delete, shows a professional progress bar, and refreshes when data reflects the PR.
// - Starts when the "View PR" link appears OR when 'watch:start' is dispatched by app.js
// - Polls branch raw JSON (no commits API) every 2s for up to 120s (avoids rate limits)
// - SAVE: verifies expected fields (tolerant to date formats & blank vs missing)
// - DELETE: verifies the permit is gone
// - Works with window.APP_CONFIG or window.CONFIG

(function () {
  // ---- Config ----
  const CFG = (window.APP_CONFIG || window.CONFIG || {});
  const OWNER    = CFG.OWNER;
  const REPO     = CFG.REPO;
  const BRANCH   = CFG.DEFAULT_BRANCH || 'main';
  const DATA_DIR = (CFG.DATA_DIR || 'data').replace(/^\/+|\/+$/g, '');

  const $ = (s) => document.querySelector(s);

  // Internal state
  let pollTimer   = null;
  let deadline    = 0;
  let startedAt   = 0;
  let ctx         = null; // { kind:'save'|'delete', expected:{...}, prUrl?:string, prNum?:string }

  // --------------- UI: progress bar ----------------
  function renderProgress(percent, headline, subline) {
    const el = $('#msgPermit'); if (!el) return;
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
            <a class="link" href="${ctx.prUrl}" target="_blank" rel="noopener">View PR${ctx.prNum ? ' #'+ctx.prNum : ''}</a>
          </div>` : ''}
      </div>`;
  }

  function showIndeterminate(text) {
    const el = $('#msgPermit'); if (!el) return;
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
    const el = $('#msgPermit'); if (!el) return;
    el.innerHTML = `<span class="small" style="color:${ok ? '#6ee7b7':'#fca5a5'}">${msg}</span>`;
    setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 5000);
  }

  // --------------- Helpers ----------------
  function parsePrNumberFromUrl(url) {
    try { const m = /\/pull\/(\d+)/.exec(url); return m ? m[1] : ''; } catch { return ''; }
  }

  function canonicalDate(s) {
    if (!s) return '';
    // accept ISO, YYYY-MM-DDTHH:mm:ssZ
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    // accept MM/DD/YYYY
    const mdy = /^(0[1-9]|1[0-2])\/([0-2][0-9]|3[01])\/(\d{4})$/.exec(s);
    if (mdy) return `${mdy[3]}-${mdy[1]}-${mdy[2]}`;
    return String(s);
  }

  function eqLoose(a, b) {
    // Treat '', null, undefined as equivalent blanks
    const blank = (v) => v === '' || v === null || v === undefined;
    if (blank(a) && blank(b)) return true;

    // Dates: compare canonically
    const ca = canonicalDate(a), cb = canonicalDate(b);
    if (ca && cb && ca.length === 10 && cb.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(ca) && ca === cb) return true;

    // Exact
    if (a === b) return true;

    // String/number equivalence
    /* eslint-disable eqeqeq */
    if (a != null && b != null && String(a) == String(b)) return true;

    // Numeric close
    const n1 = Number(a), n2 = Number(b);
    if (!Number.isNaN(n1) && !Number.isNaN(n2) && Math.abs(n1 - n2) < 1e-9) return true;

    return false;
  }

  // SAVE: does merged list contain the record with expected fields?
  function matchesExpectedPermit(list, exp) {
    const rec = list.find(x => String(x.permit_id) === String(exp.permit_id));
    if (!rec) return false;
    for (const [k, vExp] of Object.entries(exp)) {
      if (k === 'permit_id') continue;
      const v = rec[k];
      if (!eqLoose(v, vExp)) return false;
    }
    return true;
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

    // Update global STATE so UI re-renders
    const prev = window.STATE || {};
    window.STATE = { ...prev, poles, permits, sha: null, lastLoaded: new Date().toISOString() };

    // KPIs
    const fmt = new Intl.NumberFormat();
    const now = new Date().toLocaleString();
    const kSha = $('#kSha'), kLoaded = $('#kLoaded'), kPoles = $('#kPoles'), kPermits = $('#kPermits');
    if (kSha)    kSha.textContent = `${BRANCH} (fallback)`;
    if (kLoaded) kLoaded.textContent = now;
    if (kPoles)  kPoles.textContent = fmt.format(poles.length);
    if (kPermits)kPermits.textContent = fmt.format(permits.length);

    // Ask UI to rebuild the list
    window.dispatchEvent(new CustomEvent('data:loaded'));
    return { poles, permits };
  }

  // --------------- Poll loop ----------------
  function progressForSecs(s) {
    // UI heuristic: 15% after PR opened, up to 90% while waiting, 100% on success.
    if (s <= 2) return 15;
    if (s >= 110) return 90;
    return 15 + Math.floor(((s - 2) / 108) * 75); // ~15..90
  }

  async function tick() {
    // stop after 120s
    if (Date.now() > deadline) {
      stop(false, `Still processing — it may take a few more seconds for GitHub to update.`);
      return;
    }

    const secs = Math.floor((Date.now() - startedAt) / 1000);
    renderProgress(progressForSecs(secs), `PR opened — watching for repository update…`, `Auto-refreshing every 2s (${secs}s)`);

    try {
      const { permits } = await reloadFromBranch();

      if (ctx.kind === 'delete') {
        const exists = permits.some(r => String(r.permit_id) === String(ctx.expected.permit_id));
        if (!exists) {
          renderProgress(100, `Change applied — data is up to date.`, `PR${ctx.prNum ? ' #'+ctx.prNum : ''} merged & data refreshed.`);
          stop(true);
          return;
        }
      } else { // save
        if (matchesExpectedPermit(permits, ctx.expected)) {
          renderProgress(100, `Change applied — data is up to date.`, `PR${ctx.prNum ? ' #'+ctx.prNum : ''} merged & data refreshed.`);
          stop(true);
          return;
        }
      }
    } catch {
      // transient CDN propagation — keep indeterminate feel but don’t spam
      showIndeterminate(`Waiting for repository update…`);
    }
  }

  function startWatching(kind, expected, prUrl) {
    ctx = { kind, expected, prUrl: prUrl || '', prNum: prUrl ? parsePrNumberFromUrl(prUrl) : '' };
    startedAt = Date.now();
    deadline  = startedAt + 120000; // 2 minutes

    showIndeterminate('Submitting… PR opened — monitoring for merge & data update.');

    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(tick, 2000);
    tick(); // run immediately
  }

  function stop(ok, finalText) {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    finish(finalText || (ok ? 'Done.' : 'Stopped.'), !!ok);
    ctx = null;
  }

  // --------------- Wiring ----------------
  // Capture form snapshot on click; begin watching when the PR link appears
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

    // Save: you require a date
    if (!f.submitted_at) {
      const el = $('#msgPermit');
      if (el) el.innerHTML = '<span class="small" style="color:#fca5a5">Please select a date before saving.</span>';
      return null;
    }

    // Build tolerant expected snapshot
    return {
      permit_id:     f.permit_id,
      job_name:      f.job_name,
      tag:           f.tag,
      SCID:          f.SCID,
      permit_status: f.permit_status,
      submitted_by:  f.submitted_by,
      submitted_at:  f.submitted_at, // any format; matcher normalizes
      notes:         f.notes // matcher treats '' and undefined as equal
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

  // Start when the PR link appears inside #msgPermit
  function wireObserver() {
    const target = $('#msgPermit'); if (!target) return;
    const mo = new MutationObserver(() => {
      if (!pendingAction) return;
      const a = target.querySelector('a[href*="/pull/"]');
      if (a && a.href) {
        const prUrl = a.href;
        const { kind, expected } = pendingAction;
        pendingAction = null;
        startWatching(kind, expected, prUrl);
      }
    });
    mo.observe(target, { childList: true, subtree: true });
  }

  // Also allow app.js to kick it off programmatically (optional)
  window.addEventListener('watch:start', () => {
    if (pendingAction) return; // already waiting for PR link
    const exp = captureFormExpected('save');
    if (!exp) return;
    // If app.js already wrote the PR link, grab it; else start without it
    const a = $('#msgPermit a[href*="/pull/"]');
    startWatching('save', exp, a?.href || '');
  });

  document.addEventListener('DOMContentLoaded', () => {
    wireButtons();
    wireObserver();
  });
})();
