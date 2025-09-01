// assets/js/watch.js
// Watches for repo updates ONLY after Save/Delete actions, then reloads data.
// Features kept: professional progress bar, status text, auto-refresh; avoids commit API rate limits.
(function () {
  const CFG = (window.APP_CONFIG || window.CONFIG || {});
  const OWNER   = CFG.OWNER;
  const REPO    = CFG.REPO;
  const BRANCH  = CFG.DEFAULT_BRANCH || 'main';
  const DATA_DIR= (CFG.DATA_DIR || 'data').replace(/^\/+|\/+$/g, '');

  const $ = (s) => document.querySelector(s);

  let timer     = null;
  let deadline  = 0;
  let expected  = null;   // expected fields to validate against (save) or {permit_id} for delete
  let action    = '';     // 'save' | 'delete'
  let startedAt = 0;

  // --------- UI helpers ----------
  function setMsg(html) {
    const el = $('#msgPermit');
    if (!el) return;
    el.innerHTML = html || '';
  }
  function showProgress(text) {
    setMsg(
      `<div style="border:1px solid #2a3242;border-radius:8px;overflow:hidden;height:10px;background:#0f1219;margin-bottom:6px;position:relative;">
         <div style="
            width:40%;height:100%;background:linear-gradient(90deg,#1f2937,#334155,#1f2937);
            animation:slide 1.2s infinite;opacity:.9;border-right:1px solid #2a3242"></div>
         <style>@keyframes slide{0%{transform:translateX(-40%)}100%{transform:translateX(260%)}}</style>
       </div>
       <div class="small muted">${text}</div>`
    );
  }
  function done(finalText) {
    setMsg(`<span class="small">${finalText}</span>`);
    // Clear message after a few seconds so the panel doesn't stay noisy
    setTimeout(() => {
      const el = $('#msgPermit');
      if (el && el.textContent === finalText) el.textContent = '';
    }, 4000);
  }

  // --------- Branch-only data reload (no commits API; avoids 403) ----------
  async function reloadFromBranch() {
    const bust = `?ts=${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const base = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${DATA_DIR}`;
    const [r1, r2] = await Promise.all([
      fetch(`${base}/poles.json${bust}`,   { cache: 'no-store' }),
      fetch(`${base}/permits.json${bust}`, { cache: 'no-store' })
    ]);
    if (!r1.ok || !r2.ok) throw new Error(`raw ${r1.status}/${r2.status}`);
    const [poles, permits] = await Promise.all([r1.json(), r2.json()]);

    // Update global STATE so UI can re-render
    const prev = window.STATE || {};
    window.STATE = {
      ...prev,
      poles, permits,
      sha: null, // unknown (since we skipped commits API)
      lastLoaded: new Date().toISOString(),
    };

    // Update KPIs if present
    $('#kSha')     && ($('#kSha').textContent = `${BRANCH} (fallback)`);
    $('#kLoaded')  && ($('#kLoaded').textContent = new Date().toLocaleString());
    $('#kPoles')   && ($('#kPoles').textContent = new Intl.NumberFormat().format(poles.length));
    $('#kPermits') && ($('#kPermits').textContent = new Intl.NumberFormat().format(permits.length));

    // Ask UI to re-render
    window.dispatchEvent(new CustomEvent('data:loaded'));
    return { poles, permits };
  }

  // Tolerant field matcher: compares only fields present in exp.
  function matchesExpectedPermit(list, exp) {
    const rec = list.find(x => String(x.permit_id) === String(exp.permit_id));
    if (!rec) return false;

    // Compare only keys provided in expected; allow string/number equivalence
    const EPS = 1e-9;
    for (const [k, vExp] of Object.entries(exp)) {
      if (k === 'permit_id') continue;
      const v = rec[k];

      // exact
      if (v === vExp) continue;

      // loose string/number
      /* eslint-disable eqeqeq */
      if (v != null && vExp != null && String(v) == String(vExp)) continue;

      // numeric close
      const n1 = Number(v), n2 = Number(vExp);
      if (!Number.isNaN(n1) && !Number.isNaN(n2) && Math.abs(n1 - n2) < EPS) continue;

      // otherwise mismatch
      return false;
    }
    return true;
  }

  // --------- Poll loop ----------
  async function tick() {
    // safety timeout (2 minutes)
    if (Date.now() > deadline) {
      stop(`Still processing — refresh in a moment if it doesn’t update automatically.`);
      return;
    }

    // Reload (branch only) and test expected condition
    try {
      const { permits } = await reloadFromBranch();
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      const m = $('#msgPermit');
      if (m) m.innerHTML = `<div class="small muted">Applying changes… refreshing every 2s (${secs}s)</div>`;

      if (action === 'delete') {
        const exists = permits.some(r => String(r.permit_id) === String(expected.permit_id));
        if (!exists) {
          stop(`Change applied — data is up to date.`);
          return;
        }
      } else if (action === 'save') {
        if (matchesExpectedPermit(permits, expected)) {
          stop(`Change applied — data is up to date.`);
          return;
        }
      }
    } catch (e) {
      // transient (CDN propagation); show progress and try next tick
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      showProgress(`Waiting for repository update… (${secs}s)`);
    }
  }

  function start(exp, kind) {
    expected  = exp;
    action    = kind;           // 'save' or 'delete'
    startedAt = Date.now();
    deadline  = startedAt + 120000; // 2 minutes

    showProgress('Submitting… waiting for repository update (auto-refreshing).');

    if (timer) clearInterval(timer);
    timer = setInterval(tick, 2000);
    tick(); // run immediately
  }

  function stop(msgText) {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    done(msgText || 'Done.');
  }

  // --------- Wire to buttons (keeps your original behavior) ----------
  function wire() {
    // SAVE: gather expected fields from the form so we can verify later
    const btnSave = $('#btnSavePermit');
    if (btnSave) {
      btnSave.addEventListener('click', () => {
        if (typeof window.UI_collectPermitForm !== 'function') return;
        const f = window.UI_collectPermitForm();

        // Require a date (your UX rule)
        if (!f.submitted_at) {
          setMsg('<span class="small" style="color:#fca5a5">Please select a date before saving.</span>');
          return;
        }

        // Prepare the "expected" snapshot we’ll look for
        start({
          permit_id:     f.permit_id,
          job_name:      f.job_name,
          tag:           f.tag,
          SCID:          f.SCID,
          permit_status: f.permit_status,
          submitted_by:  f.submitted_by,
          submitted_at:  f.submitted_at,
          notes:         f.notes
        }, 'save');
      }, { capture: true });
    }

    // DELETE: expected is simply that permit_id disappears
    const btnDel = $('#btnDeletePermit');
    if (btnDel) {
      btnDel.addEventListener('click', () => {
        const id = ($('#permit_id')?.value || '').trim();
        if (!id) return;
        start({ permit_id: id }, 'delete');
      }, { capture: true });
    }

    // Optional compatibility: allow app.js to kick the watcher programmatically
    window.addEventListener('watch:start', () => {
      if (typeof window.UI_collectPermitForm !== 'function') return;
      const f = window.UI_collectPermitForm();
      if (!f || !f.permit_id) return;
      start({
        permit_id:     f.permit_id,
        job_name:      f.job_name,
        tag:           f.tag,
        SCID:          f.SCID,
        permit_status: f.permit_status,
        submitted_by:  f.submitted_by,
        submitted_at:  f.submitted_at,
        notes:         f.notes
      }, 'save');
    });
  }

  document.addEventListener('DOMContentLoaded', wire);
})();
