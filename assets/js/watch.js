// assets/js/watch.js
// Watches for repo updates ONLY after Save/Delete actions, then reloads data.
// This version keeps your original commit-SHA polling logic and adds a
// professional modal progress overlay (no behavioral changes elsewhere).

(function () {
  const $ = (s) => document.querySelector(s);

  // Support either CONFIG or APP_CONFIG
  const CFG      = (window.CONFIG || window.APP_CONFIG || {});
  const OWNER    = CFG.OWNER;
  const REPO     = CFG.REPO;
  const BRANCH   = CFG.DEFAULT_BRANCH || 'main';
  const DATA_DIR = (CFG.DATA_DIR || 'data').replace(/^\/+|\/+$/g, '');

  let polling  = null;
  let deadline = 0;
  let startSha = null;
  let expected = null;  // expected fields to validate against (save) or {permit_id} for delete
  let action   = '';    // 'save' | 'delete' | 'bulk'

  // Track for overlay step 2
  let sawRepoUpdate = false;
  let startedAt = 0;

  // ---------- ULTRA PROFESSIONAL PROGRESS OVERLAY ----------
  let ov = null; // elements cache

  function ensureOverlay() {
    if (ov) return;
    // style
    const css = document.createElement('style');
    css.textContent = `
      .prp-overlay{position:fixed;inset:0;background:rgba(11,12,16,.72);backdrop-filter:blur(6px);
        display:none;align-items:center;justify-content:center;z-index:9999}
      .prp-overlay.show{display:flex}
      .prp-card{width:min(560px,92vw);background:var(--panel,#0f1219);border:1px solid var(--border,#1f2430);
        border-radius:16px;padding:18px 18px 16px;box-shadow:0 12px 48px rgba(0,0,0,.55)}
      .prp-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px}
      .prp-title{font-weight:700;font-size:16px}
      .prp-sub{font-size:12px;color:var(--muted,#9aa3b2)}
      .prp-barbg{position:relative;height:14px;border:1px solid #2a3242;border-radius:10px;overflow:hidden;background:#0c1118}
      .prp-fill{height:100%;width:0%;
        background:repeating-linear-gradient(45deg,#223043 0px,#223043 10px,#2d3b4f 10px,#2d3b4f 20px);
        animation:prp-stripe 1.1s linear infinite;box-shadow:inset 0 0 4px rgba(0,0,0,.55)}
      @keyframes prp-stripe{0%{background-position:0 0}100%{background-position:40px 0}}
      .prp-rows{display:flex;align-items:center;justify-content:space-between;margin-top:8px}
      .prp-pct{font-size:12px;color:var(--muted,#9aa3b2)}
      .prp-steps{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
      .prp-step{font-size:11px;color:var(--muted,#9aa3b2);border:1px solid #2a3242;border-radius:999px;padding:2px 8px}
      .prp-step.active{color:#d1fae5;border-color:#1f3b2f;background:#0f2b22}
      .prp-foot{display:flex;justify-content:space-between;align-items:center;margin-top:10px}
      .prp-link{color:#7dd3fc;text-decoration:none;font-size:12px}
      .prp-link:hover{text-decoration:underline}
    `;
    document.head.appendChild(css);

    // markup
    const wrap = document.createElement('div');
    wrap.className = 'prp-overlay';
    wrap.innerHTML = `
      <div class="prp-card">
        <div class="prp-head">
          <div class="prp-title" id="prpTitle">Processing…</div>
          <div class="prp-sub"   id="prpSub">Submitting request…</div>
        </div>
        <div class="prp-barbg"><div class="prp-fill" id="prpFill" style="width:0%"></div></div>
        <div class="prp-rows">
          <div class="prp-steps">
            <span class="prp-step prp-step--1 active" id="prpS1">1&nbsp;PR opened</span>
            <span class="prp-step prp-step--2"        id="prpS2">2&nbsp;Repo updated</span>
            <span class="prp-step prp-step--3"        id="prpS3">3&nbsp;Data refreshed</span>
          </div>
          <div class="prp-pct" id="prpPct">0%</div>
        </div>
        <div class="prp-foot">
          <span class="prp-sub" id="prpFootNote"></span>
          <a id="prpLink" class="prp-link" target="_blank" rel="noopener" style="display:none">View PR</a>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    ov = {
      root: wrap,
      title: $('#prpTitle'),
      sub:   $('#prpSub'),
      fill:  $('#prpFill'),
      pct:   $('#prpPct'),
      s1:    $('#prpS1'),
      s2:    $('#prpS2'),
      s3:    $('#prpS3'),
      foot:  $('#prpFootNote'),
      link:  $('#prpLink')
    };
  }

  function overlayOpen(headline, sub, prUrl) {
    ensureOverlay();
    ov.root.classList.add('show');
    ov.title.textContent = headline || 'Updating data';
    ov.sub.textContent   = sub || 'PR opened — monitoring for merge & data update…';
    ov.fill.style.width  = '15%';
    ov.pct.textContent   = '15%';
    ov.s1.classList.add('active'); ov.s2.classList.remove('active'); ov.s3.classList.remove('active');
    ov.foot.textContent  = '';
    if (prUrl) {
      ov.link.style.display = '';
      ov.link.href = prUrl;
    } else {
      ov.link.style.display = 'none';
      ov.link.removeAttribute('href');
    }
  }
  function overlayPercent(p) {
    ensureOverlay();
    const pct = Math.max(0, Math.min(100, p|0));
    ov.fill.style.width = pct + '%';
    ov.pct.textContent  = pct + '%';
  }
  function overlayStep(n) {
    ensureOverlay();
    ov.s1.classList.toggle('active', n >= 1);
    ov.s2.classList.toggle('active', n >= 2);
    ov.s3.classList.toggle('active', n >= 3);
  }
  function overlayText(sub) {
    ensureOverlay();
    ov.sub.textContent = sub || '';
  }
  function overlayClose() {
    if (!ov) return;
    ov.root.classList.remove('show');
  }

  // --------- UI helpers (existing) ----------
  function setMsg(html) {
    const el = $('#msgPermit');
    if (!el) return;
    el.innerHTML = html || '';
  }
  function showProgress(text) {
    // Keep existing inline status AND show overlay (no logic change)
    setMsg(
      `<div style="border:1px solid #2a3242;border-radius:8px;overflow:hidden;height:10px;background:#0f1219;margin-bottom:6px;">
         <div style="width:100%;height:100%;background:linear-gradient(90deg,#1f2937,#334155,#1f2937);opacity:.8"></div>
       </div>
       <div class="small muted">${text}</div>`
    );
    // open overlay at 15%
    overlayOpen('Updating data', text, findPrLinkHref());
    overlayPercent(15);
    overlayStep(1);
  }
  function done(finalText) {
    setMsg(`<span class="small">${finalText}</span>`);
    overlayPercent(100);
    overlayStep(3);
    overlayText('Change applied — data is up to date.');
    // allow users to see 100% briefly
    setTimeout(overlayClose, 800);
    setTimeout(() => setMsg(''), 4000);
  }

  // --------- Tolerant compare helpers ----------
  const isBlank = (v) => v === '' || v === null || v === undefined;
  const trimStr = (v) => (typeof v === 'string' ? v.trim() : v);

  // Normalize date to YYYY-MM-DD for comparison (accept MM/DD/YYYY or ISO)
  function canonicalDate(s) {
    if (!s) return '';
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); // YYYY-MM-DD or ISO
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const mdy = /^(0?[1-9]|1[0-2])\/([0-2]?[0-9]|3[01])\/(\d{4})$/.exec(s); // allow non-padded
    if (mdy) return `${mdy[3]}-${String(mdy[1]).padStart(2,'0')}-${String(mdy[2]).padStart(2,'0')}`;
    return String(s);
  }

  function eqLoose(a, b) {
    if (isBlank(a) && isBlank(b)) return true;
    a = trimStr(a); b = trimStr(b);
    const ca = canonicalDate(a), cb = canonicalDate(b);
    if (ca && cb && /^\d{4}-\d{2}-\d{2}$/.test(ca) && ca === cb) return true;
    if (a === b) return true;
    // eslint-disable-next-line eqeqeq
    if (a != null && b != null && String(a) == String(b)) return true;
    const n1 = Number(a), n2 = Number(b);
    if (!Number.isNaN(n1) && !Number.isNaN(n2) && Math.abs(n1 - n2) < 1e-9) return true;
    return false;
  }

  // --------- Data helpers (SHA + raw@SHA) ----------
  async function getLatestSha() {
    const r = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/commits/${BRANCH}?_=${Date.now()}`,
      { cache: 'no-store' }
    );
    if (!r.ok) throw new Error(`GitHub API ${r.status}`);
    const j = await r.json();
    return j.sha;
  }

  async function reloadAtSha(sha) {
    const bust = `?ts=${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const base = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${sha}/${DATA_DIR}`;
    const [r1, r2] = await Promise.all([
      fetch(`${base}/poles.json${bust}`,   { cache: 'no-store' }),
      fetch(`${base}/permits.json${bust}`, { cache: 'no-store' }),
    ]);
    if (!r1.ok || !r2.ok) throw new Error(`raw ${r1.status}/${r2.status}`);
    const [poles, permits] = await Promise.all([r1.json(), r2.json()]);

    const prev = window.STATE || {};
    window.STATE = { ...prev, poles, permits, sha, lastLoaded: new Date().toISOString() };

    // KPIs
    $('#kSha')     && ($('#kSha').textContent = sha.slice(0, 7));
    $('#kLoaded')  && ($('#kLoaded').textContent = new Date().toLocaleString());
    $('#kPoles')   && ($('#kPoles').textContent = new Intl.NumberFormat().format(poles.length));
    $('#kPermits') && ($('#kPermits').textContent = new Intl.NumberFormat().format(permits.length));

    // UI re-render
    window.dispatchEvent(new CustomEvent('data:loaded'));
  }

  // Save: ensure a record with permit_id exists and matches provided fields (tolerant)
  function matchesExpectedPermit(list, exp) {
    const rec = list.find(x => String(x.permit_id) === String(exp.permit_id));
    if (!rec) return false;
    for (const [k, v] of Object.entries(exp)) {
      if (k === 'permit_id') continue;
      if (!eqLoose(rec[k], v)) return false;
    }
    return true;
  }

  // --------- Helper: find PR link currently shown in msg area (if any) ----------
  function findPrLinkHref() {
    const a = $('#msgPermit a[href*="/pull/"]');
    return a && a.href ? a.href : '';
  }

  // --------- Poll loop ----------
  function basePercent() {
    const secs = Math.max(0, (Date.now() - startedAt) / 1000);
    // 15% -> 85% over time while waiting
    return Math.max(15, Math.min(85, 15 + (secs / 120) * 70));
  }

  async function tick() {
    if (Date.now() > deadline) {
      overlayText('Still processing — raw files may take a few more seconds.');
      overlayPercent(95);
      stop(`Still processing — refresh in a moment if it doesn’t update automatically.`);
      return;
    }

    let sha;
    try {
      sha = await getLatestSha();
    } catch {
      // transient; keep animating
      overlayPercent(basePercent());
      return;
    }
    if (!startSha) startSha = sha;

    if (sha !== startSha) {
      // we see repo head moved; step 2
      if (!sawRepoUpdate) {
        sawRepoUpdate = true;
        overlayStep(2);
        overlayText('Repository updated — fetching merged data…');
        overlayPercent(90);
      }

      try {
        await reloadAtSha(sha);
      } catch {
        // raw not ready; keep waiting
        overlayPercent(92);
        return;
      }

      const permits = (window.STATE && window.STATE.permits) || [];

      // NEW: bulk mode just completes after successful reload
      if (action === 'bulk') {
        overlayStep(3);
        overlayText('Change applied — data refreshed.');
        overlayPercent(100);
        stop(`Change applied in commit ${sha.slice(0,7)}.`);
        return;
      }

      if (action === 'delete') {
        const exists = permits.some(r => String(r.permit_id) === String(expected.permit_id));
        if (!exists) {
          overlayStep(3);
          overlayText('Change applied — data refreshed.');
          overlayPercent(100);
          stop(`Change applied in commit ${sha.slice(0,7)}.`);
          return;
        }
      } else if (action === 'save') {
        if (matchesExpectedPermit(permits, expected)) {
          overlayStep(3);
          overlayText('Change applied — data refreshed.');
          overlayPercent(100);
          stop(`Change applied in commit ${sha.slice(0,7)}.`);
          return;
        }
      }

      // repo moved but data not yet visible (CDN lag)
      overlayPercent(93);
      overlayText('Waiting for raw files to update…');
    } else {
      // repo HEAD unchanged yet
      overlayPercent(basePercent());
      overlayText('PR opened — watching for repository update…');
    }
  }

  function start(kind, exp, act) {
    expected = exp;
    action   = act;         // 'save' or 'delete' or 'bulk'
    startSha = null;
    sawRepoUpdate = false;
    startedAt = Date.now();
    deadline = startedAt + 120000; // ~2 minutes

    // Existing inline status + new overlay
    showProgress('Submitting… waiting for repository update (auto-refreshing).');

    if (polling) clearInterval(polling);
    polling = setInterval(tick, 2000);
  }

  function stop(msg) {
    if (polling) {
      clearInterval(polling);
      polling = null;
    }
    done(msg || 'Done.');
  }

  // --------- Wire to buttons (no behavioral changes) ----------
  function wire() {
    // Save -> gather expected fields from the form so we can verify later
    const btnSave = $('#btnSavePermit');
    if (btnSave) {
      btnSave.addEventListener('click', () => {
        if (typeof window.UI_collectPermitForm !== 'function') return;
        const f = window.UI_collectPermitForm();

        // Require a date (per your rule)
        if (!f.submitted_at) {
          setMsg('<span class="small" style="color:#fca5a5">Please select a date before saving.</span>');
          return;
        }

        start('permit', {
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

    // Delete -> expected is simply that permit_id disappears
    const btnDel = $('#btnDeletePermit');
    if (btnDel) {
      btnDel.addEventListener('click', () => {
        const id = ($('#permit_id')?.value || '').trim();
        if (!id) return;
        start('permit', { permit_id: id }, 'delete');
      }, { capture: true });
    }
  }

  document.addEventListener('DOMContentLoaded', wire);

  // NEW: allow external triggers (e.g., mass Apply) to reuse the same overlay + polling
  window.addEventListener('watch:start', () => {
    // bulk mode: no single-record expectation; we complete after repo updates & reload succeeds
    start('bulk', null, 'bulk');
  }, { passive: true });
})();
