// assets/js/watch.js
// Watches for repo updates ONLY after Save/Delete actions, then reloads data
(function () {
  const $ = (s) => document.querySelector(s);

  const CFG = window.CONFIG || {};
  const OWNER  = CFG.OWNER;
  const REPO   = CFG.REPO;
  const BRANCH = CFG.DEFAULT_BRANCH || 'main';
  const DATA_DIR = CFG.DATA_DIR || 'data';

  let polling = null;
  let deadline = 0;
  let startSha = null;
  let expected = null;   // expected fields to validate against (save) or {permit_id} for delete
  let action = '';       // 'save' | 'delete'

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

  // --------- Data helpers ----------
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

    // Update quick labels if present
    $('#kSha')    && ($('#kSha').textContent = sha.slice(0, 7));
    $('#kLoaded') && ($('#kLoaded').textContent = new Date().toLocaleString());
    $('#kPoles')  && ($('#kPoles').textContent = new Intl.NumberFormat().format(poles.length));
    $('#kPermits')&& ($('#kPermits').textContent = new Intl.NumberFormat().format(permits.length));

    // Ask UI to re-render
    window.dispatchEvent(new CustomEvent('data:loaded'));
  }

  function matchesExpectedPermit(list, exp) {
    // Save: ensure a record with permit_id exists and matches fields present in exp
    const r = list.find(x => String(x.permit_id) === String(exp.permit_id));
    if (!r) return false;
    for (const [k, v] of Object.entries(exp)) {
      if (k === 'permit_id') continue;
      if (String(r[k] ?? '') !== String(v ?? '')) return false;
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
        return; // try again next tick
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
    action = act;         // 'save' or 'delete'
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
        if (typeof window.UI_collectPermitForm !== 'function') return;
        const f = window.UI_collectPermitForm();
        // Require a date (you asked to always require a date)
        if (!f.submitted_at) {
          setMsg('<span class="small" style="color:#fca5a5">Please select a date before saving.</span>');
          return;
        }
        start('permit', {
          permit_id: f.permit_id,
          job_name: f.job_name,
          tag: f.tag,
          SCID: f.SCID,
          permit_status: f.permit_status,
          submitted_by: f.submitted_by,
          submitted_at: f.submitted_at,
          notes: f.notes
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
