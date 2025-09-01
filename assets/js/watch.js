// assets/js/watch.js
// Watches AFTER Save/Delete, shows a professional progress bar, and refreshes when data reflects the PR.
// - Starts when "View PR" link appears in #msgPermit, or when 'watch:start' is dispatched.
// - Polls branch raw JSON (no commits API) every 2s for up to 120s.
// - SAVE: baseline-aware matcher -> only checks fields that actually changed; tolerant to blanks & date formats.
// - DELETE: success when the permit disappears.
// - Optionally pings PR merged status every 5s (low rate; safe). Progress shows PR merged when detected.
// - Works with window.APP_CONFIG or window.CONFIG

(function () {
  // ---- Config ----
  const CFG      = (window.APP_CONFIG || window.CONFIG || {});
  const OWNER    = CFG.OWNER;
  const REPO     = CFG.REPO;
  const BRANCH   = CFG.DEFAULT_BRANCH || 'main';
  const DATA_DIR = (CFG.DATA_DIR || 'data').replace(/^\/+|\/+$/g, '');
  const $        = (s) => document.querySelector(s);

  // ---- Internal state ----
  let pollTimer   = null;  // 2s raw.json poll
  let prTimer     = null;  // 5s PR merge check
  let deadline    = 0;
  let startedAt   = 0;

  // context of the current watch
  // { kind:'save'|'delete', prUrl, prNum, expected:{...}, baseline:{...}, changedKeys:Set<string> }
  let ctx = null;

  // ========= UI: progress bar =========
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

  // ========= Helpers =========
  function parsePrNumberFromUrl(url) {
    try { const m = /\/pull\/(\d+)/.exec(url); return m ? m[1] : ''; } catch { return ''; }
  }

  // Normalize date to YYYY-MM-DD for comparison; accept MM/DD/YYYY or ISO
  function canonicalDate(s) {
    if (!s) return '';
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); // YYYY-MM-DD or ISO
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const mdy = /^(0?[1-9]|1[0-2])\/([0-2]?[0-9]|3[01])\/(\d{4})$/.exec(s); // MM/DD/YYYY (allow non-padded)
    if (mdy) return `${mdy[3]}-${String(mdy[1]).padStart(2,'0')}-${String(mdy[2]).padStart(2,'0')}`;
    return String(s);
  }

  const isBlank = (v) => v === '' || v === null || v === undefined;
  const trimStr = (v) => (typeof v === 'string' ? v.trim() : v);

  function eqLoose(a, b) {
    // blanks equal
    if (isBlank(a) && isBlank(b)) return true;

    // trim strings
    a = trimStr(a); b = trimStr(b);

    // dates equal canonically
    const ca = canonicalDate(a), cb = canonicalDate(b);
    if (ca && cb && /^\d{4}-\d{2}-\d{2}$/.test(ca) && ca === cb) return true;

    // exact
    if (a === b) return true;

    // string/number equivalence
    /* eslint-disable eqeqeq */
    if (a != null && b != null && String(a) == String(b)) return true;

    // numeric close
    const n1 = Number(a), n2 = Number(b);
    if (!Number.isNaN(n1) && !Number.isNaN(n2) && Math.abs(n1 - n2) < 1e-9) return true;

    return false;
  }

  function findPermit(list, id) {
    return list.find(x => String(x.permit_id) === String(id));
  }

  // Build the set of keys that actually changed vs baseline (so we only check those).
  function computeChangedKeys(baseline, expected) {
    const keys = new Set();
    if (!baseline) {
      // New permit: check core fields if provided
      ['permit_status', 'submitted_by', 'submitted_at', 'notes', 'job_name', 'tag', 'SCID'].forEach(k => {
        if (!isBlank(expected[k])) keys.add(k);
      });
      return keys;
    }
    for (const k of ['permit_status','submitted_by','submitted_at','notes','job_name','tag','SCID']) {
      const b = baseline[k], e = expected[k];
      if (!eqLoose(b, e)) keys.add(k);
    }
    // if nothing appears changed (e.g., user hit save without change), still require presence
    if (keys.size === 0) keys.add('permit_id');
    return keys;
  }

  // Success for SAVE: record exists and for all changedKeys eqLoose(rec[k], expected[k])
  function saveSatisfied(list, expected, baseline, changedKeys) {
    const rec = findPermit(list, expected.permit_id);
    if (!rec) return false;
    for (const k of changedKeys) {
      if (k === 'permit_id') continue;
      if (!eqLoose(rec[k], expected[k])) return false;
    }
    return true;
  }

  // ========= Data reload (branch-only; cache-busted) =========
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
    $('#kSha')     && ($('#kSha').textContent = `${BRANCH} (fallback)`);
    $('#kLoaded')  && ($('#kLoaded').textContent = now);
    $('#kPoles')   && ($('#kPoles').textContent = fmt.format(poles.length));
    $('#kPermits') && ($('#kPermits').textContent = fmt.format(permits.length));

    // Let UI rebuild the list
    window.dispatchEvent(new CustomEvent('data:loaded'));
    return { poles, permits };
  }

  // ========= Optional PR merged ping (every 5s; safe) =========
  async function checkPrMerged(prNum) {
    if (!prNum) return null;
    try {
      // 204 if merged; 404 if not
      const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/pulls/${prNum}/merge?_=${Date.now()}`, { cache: 'no-store' });
      if (r.status === 204) return true;
      if (r.status === 404) return false;
      return null;
    } catch { return null; }
  }

  // ========= Poll loop =========
  function progressForSecs(s, merged) {
    // 15% after PR link, 60% while waiting, 80% once merged detected, 100% on data match
    if (s <= 2) return 15;
    if (merged) return Math.min(95, 80 + Math.floor((s-2)/2)); // creep towards 95%
    return Math.min(90, 15 + Math.floor(((s - 2) / 108) * 75));
  }

  async function tick() {
    if (Date.now() > deadline) {
      stop(false, `Still processing — GitHub may need a few more seconds.`);
      return;
    }
    const secs = Math.floor((Date.now() - startedAt) / 1000);

    // Optionally peek PR merged status (every ~5s)
    let merged = false;
    if (ctx.prNum && secs % 5 === 0) {
      const m = await checkPrMerged(ctx.prNum);
      merged = m === true;
    }

    renderProgress(
      progressForSecs(secs, merged),
      merged ? `PR merged — waiting for raw files to update…` : `PR opened — watching for repository update…`,
      `Auto-refreshing every 2s (${secs}s)`
    );

    // Reload branch and test success condition
    try {
      const { permits } = await reloadFromBranch();

      if (ctx.kind === 'delete') {
        const exists = !!findPermit(permits, ctx.expected.permit_id);
        if (!exists) {
          renderProgress(100, `Change applied — data is up to date.`, `PR${ctx.prNum ? ' #'+ctx.prNum : ''} merged & data refreshed.`);
          stop(true);
          return;
        }
      } else {
        // Save
        if (saveSatisfied(permits, ctx.expected, ctx.baseline, ctx.changedKeys)) {
          renderProgress(100, `Change applied — data is up to date.`, `PR${ctx.prNum ? ' #'+ctx.prNum : ''} merged & data refreshed.`);
          stop(true);
          return;
        }
      }
    } catch {
      // transient CDN delay — keep going
      showIndeterminate(merged ? 'PR merged — waiting for raw files…' : 'Waiting for repository update…');
    }
  }

  function startWatching(kind, expected, prUrl) {
    // baseline snapshot from current STATE before polling
    const permits = (window.STATE && window.STATE.permits) || [];
    const baseline = findPermit(permits, expected.permit_id) || null;
    const changedKeys = computeChangedKeys(baseline, expected);

    ctx = {
      kind,
      expected,
      baseline,
      changedKeys,
      prUrl: prUrl || '',
      prNum: prUrl ? parsePrNumberFromUrl(prUrl) : ''
    };
    startedAt = Date.now();
    deadline  = startedAt + 120000; // 2 minutes

    showIndeterminate('Submitting… PR opened — monitoring for merge & data update.');

    if (pollTimer) clearInterval(pollTimer);
    if (prTimer)   clearInterval(prTimer);

    pollTimer = setInterval(tick, 2000);
    tick(); // immediate first pass
  }

  function stop(ok, finalText) {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (prTimer)   { clearInterval(prTimer);   prTimer   = null; }
    finish(finalText || (ok ? 'Done.' : 'Stopped.'), !!ok);
    ctx = null;
  }

  // ========= Wiring =========
  // Capture form snapshot on click; begin watching when PR link appears
  let pendingAction = null; // { kind, expected }

  function captureFormExpected(kind) {
    if (typeof window.UI_collectPermitForm !== 'function') return null;
    const f = window.UI_collectPermitForm();
    if (!f) return null;

    if (kind === 'delete') {
      const id = (document.querySelector('#permit_id')?.value || '').trim();
      if (!id) return null;
      return { permit_id: id };
    }

    // Save path: date is required in your UI
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
      submitted_at:  f.submitted_at, // any format; matcher normalizes
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
    const a = $('#msgPermit a[href*="/pull/"]');
    startWatching('save', exp, a?.href || '');
  });

  document.addEventListener('DOMContentLoaded', () => {
    wireButtons();
    wireObserver();
  });
})();
