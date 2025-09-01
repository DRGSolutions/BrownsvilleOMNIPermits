// assets/js/watch.js
// Watches for repo updates ONLY after Save/Delete actions, then reloads data.
// Restores the original commit-SHA polling + reloadAtSha behavior and UI you had,
// with tolerant matching so it stops as soon as the change is present.

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
  let action   = '';    // 'save' | 'delete'

  // --------- UI helpers ----------
  function setMsg(html) {
    const el = $('#msgPermit');
    if (!el) return;
    el.innerHTML = html || '';
  }
  function showProgress(text) {
    setMsg(
      `<div style="border:1px solid #2a3242;border-radius:8px;overflow:hidden;height:10px;background:#0f1219;margin-bottom:6px;">
         <div style="width:100%;height:100%;background:linear-gradient(90deg,#1f2937,#334155,#1f2937);opacity:.8"></div>
       </div>
       <div class="small muted">${text}</div>`
    );
  }
  function done(finalText) {
    setMsg(`<span class="small">${finalText}</span>`);
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
    // blanks equal
    if (isBlank(a) && isBlank(b)) return true;

    a = trimStr(a); b = trimStr(b);

    // dates equal canonically
    const ca = canonicalDate(a), cb = canonicalDate(b);
    if (ca && cb && /^\d{4}-\d{2}-\d{2}$/.test(ca) && ca === cb) return true;

    // exact
    if (a === b) return true;

    // string/number loose
    // eslint-disable-next-line eqeqeq
    if (a != null && b != null && String(a) == String(b)) return true;

    // numeric close
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
    window.STATE = {
      ...prev,
      poles, permits,
      sha,
      lastLoaded: new Date().toISOString(),
    };

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

  // --------- Poll loop ----------
  async function tick() {
    if (Date.now() > deadline) {
      stop(`Still processing — refresh in a moment if it doesn’t update automatically.`);
      return;
    }

    let sha;
    try {
      sha = await getLatestSha();
    } catch {
      // transient; try next tick
      return;
    }
    if (!startSha) startSha = sha;

    if (sha !== startSha) {
      try {
        await reloadAtSha(sha);
      } catch {
        // raw not ready; try again next tick
        return;
      }

      const permits = (window.STATE && window.STATE.permits) || [];
      if (action === 'delete') {
        const exists = permits.some(r => String(r.permit_id) === String(expected.permit_id));
        if (!exists) {
          stop(`Change applied in commit ${sha.slice(0,7)}.`);
          return;
        }
      } else if (action === 'save') {
        if (matchesExpectedPermit(permits, expected)) {
          stop(`Change applied in commit ${sha.slice(0,7)}.`);
          return;
        }
      }
    }
  }

  function start(kind, exp, act) {
    expected = exp;
    action   = act;         // 'save' or 'delete'
    startSha = null;
    deadline = Date.now() + 120000; // ~2 minutes
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

  // --------- Wire to buttons (no changes to your app needed) ----------
  function wire() {
    // Save -> gather expected fields from the form so we can verify later
    const btnSave = $('#btnSavePermit');
    if (btnSave) {
      btnSave.addEventListener('click', () => {
        if (typeof window.UI_collectPermitForm !== 'function') return; // ✅ fixed extra parenthesis
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
          submitted_at:  f.submitted_at, // tolerant matcher handles ISO vs MM/DD/YYYY
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
})();
