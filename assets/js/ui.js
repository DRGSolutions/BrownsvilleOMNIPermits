// assets/js/ui.js
// Full UI: filters, list, permit editor (edit/upsert/delete), mass create, admin CSV,
// pending-change monitor, status chips with requested colors, and robust bindings.

(() => {
  const CFG  = window.APP_CONFIG || {};
  const DATA = window.DATA || {};
  const API  = window.API  || {};
  const { STATE, loadData, getLatestSha, setStatus } = DATA;

  // Surface errors in the UI
  window.addEventListener('error', (e) => {
    const s = document.getElementById('status');
    if (s) s.innerHTML = `<span class="err">JS error: ${e.message}</span>`;
  });
  window.addEventListener('unhandledrejection', (e) => {
    const s = document.getElementById('status');
    const msg = (e.reason && e.reason.message) ? e.reason.message : String(e.reason);
    if (s) s.innerHTML = `<span class="err">Async error: ${msg}</span>`;
  });

  // ---------- DOM ----------
  const elStatus     = document.getElementById('status');
  const elList       = document.getElementById('list');
  const elSelUtility = document.getElementById('selUtility'); // BPUB/AEP/MVEC/All
  const elSelJob     = document.getElementById('selJob');
  const elSearch     = document.getElementById('searchInput'); // search by tag/SCID
  const elKPoles     = document.getElementById('kPoles');
  const elKPermits   = document.getElementById('kPermits');
  const elKLoaded    = document.getElementById('kLoaded');

  // Permit form elements
  const elPermitForm  = document.getElementById('formPermit');
  const fPermitId     = elPermitForm?.querySelector('[name="permit_id"]');
  const fJobName      = elPermitForm?.querySelector('[name="job_name"]');
  const fTag          = elPermitForm?.querySelector('[name="tag"]');
  const fSCID         = elPermitForm?.querySelector('[name="SCID"]');
  const fStatus       = elPermitForm?.querySelector('[name="permit_status"]');
  const fSubmittedBy  = elPermitForm?.querySelector('[name="submitted_by"]');
  const fSubmittedAt  = elPermitForm?.querySelector('[name="submitted_at"]');
  const fNotes        = elPermitForm?.querySelector('[name="notes"]');
  const elPermitMsg   = document.getElementById('msgPermit');
  const elBtnDelete   = document.getElementById('btnDeletePermit');

  // Mass create elements
  const elMassForm     = document.getElementById('formMassCreate');
  const mJob           = elMassForm?.querySelector('[name="mass_job"]');
  const mSubmittedBy   = elMassForm?.querySelector('[name="mass_submitted_by"]');
  const mDate          = elMassForm?.querySelector('[name="mass_date"]');   // <input type=date>
  const mNotes         = elMassForm?.querySelector('[name="mass_notes"]');
  const elMassMsg      = document.getElementById('msgMass');
  const elMassGo       = document.getElementById('btnMassCreate');

  // Admin export elements
  const elAdminForm    = document.getElementById('formAdminExport');
  const aUtility       = elAdminForm?.querySelector('[name="admin_utility"]');
  const aJob           = elAdminForm?.querySelector('[name="admin_job"]');
  const aStatus        = elAdminForm?.querySelector('[name="admin_status"]');
  const elAdminMsg     = document.getElementById('msgAdmin');
  const elAdminGo      = document.getElementById('btnExportCsv');

  // Make the scrolling area taller as requested
  if (elList) elList.style.maxHeight = '76vh';

  // ---------- Helpers ----------
  const fmt = n => new Intl.NumberFormat().format(n);

  const STATUS_COLORS = {
    'Created - NOT Submitted': { bg: '#fde047', text: '#3b2f00', border: '#facc15' }, // bright yellow
    'Submitted - Pending':     { bg: '#fb923c', text: '#3d2500', border: '#f97316' }, // orange
    'Approved':                { bg: '#34d399', text: '#062e24', border: '#10b981' }, // green
    'Not Approved - Cannot Attach': { bg: '#a78bfa', text: '#2c1657', border: '#7c3aed' }, // purple
    'Not Approved - PLA Issues':    { bg: '#fca5a5', text: '#4a0d0d', border: '#ef4444' }, // red
    'Not Approved - MRE Issues':    { bg: '#fca5a5', text: '#4a0d0d', border: '#ef4444' }, // red
    'Not Approved - Other Issues':  { bg: '#fca5a5', text: '#4a0d0d', border: '#ef4444' }  // red
  };
  function chip(status) {
    const c = STATUS_COLORS[status] || { bg:'#e5e7eb', text:'#111827', border:'#d1d5db' };
    return `style="background:${c.bg};color:${c.text};border:1px solid ${c.border};padding:2px 8px;border-radius:999px;font-size:12px"`;
  }

  function todayMDY() {
    const d = new Date();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const yy = d.getFullYear();
    return `${mm}/${dd}/${yy}`;
  }

  function toMDYFromInputDate(val) {
    // input type=date gives YYYY-MM-DD
    if (!val) return todayMDY();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val);
    if (m) return `${m[2]}/${m[3]}/${m[1]}`;
    return val; // pass through
  }

  function uniqueJobsByOwner(owner) {
    const s = new Set();
    for (const p of STATE.poles) if (!owner || owner==='All' || p.owner===owner) s.add(p.job_name);
    return [...s].sort();
  }

  function permitsForPole(p) {
    return STATE.permits.filter(r =>
      String(r.job_name)===String(p.job_name) &&
      String(r.tag)     ===String(p.tag) &&
      String(r.SCID)    ===String(p.SCID)
    ).sort((a,b) => String(a.permit_id).localeCompare(String(b.permit_id)));
  }

  function anyPermitsForJob(jobName) {
    return STATE.permits.some(r => String(r.job_name) === String(jobName));
  }

  // ---------- Pending monitor ----------
  const pending = new Map(); // key `permit:<id>` -> { type, id, expected, prUrl, state, started, appliedSha }
  let watcher = null;

  function matchesPatch(obj, expected) {
    // tolerate minor differences and string/number mismatches
    const EPS = 1e-9;
    for (const [k, vExp] of Object.entries(expected || {})) {
      const vObj = obj?.[k];
      if (vObj === vExp) continue;
      if (vObj != null && vExp != null && String(vObj) === String(vExp)) continue;
      const nObj = Number(vObj), nExp = Number(vExp);
      if (!Number.isNaN(nObj) && !Number.isNaN(nExp) && Math.abs(nObj - nExp) < EPS) continue;
      return false;
    }
    return true;
  }

  function renderPending() {
    const panel = document.getElementById('pendingPanel');
    const list  = document.getElementById('pendingList');
    if (!panel || !list) return;

    if (pending.size === 0) {
      panel.style.display = 'none';
      list.innerHTML = 'No pending changes.';
      return;
    }
    panel.style.display = 'block';

    list.innerHTML = [...pending.values()].map(it => {
      const secs = Math.floor((Date.now() - it.started) / 1000);
      const pr = it.prUrl ? ` · <a class="link" target="_blank" rel="noopener" href="${it.prUrl}">PR</a>` : '';
      return `<div>
        ${it.type} <code>${it.id}</code>
        — <span class="status" style="border-color:${it.state==='applied'?'#1f3b2f':'#664c00'};color:${it.state==='applied'?'#6ee7b7':'#ffda6a'}">
          ${it.state === 'applied' ? 'applied' : 'pending'}
        </span>
        ${pr} · ${secs}s
        ${it.appliedSha ? ` · in <code>${it.appliedSha.slice(0,7)}</code>` : ''}
      </div>`;
    }).join('');
  }
  window.renderPending = renderPending;

  function trackPending(type, id, expected, prUrl) {
    pending.set(`${type}:${id}`, { type, id, expected, prUrl, state:'pending', started: Date.now(), appliedSha: null });
    renderPending();
    ensureWatcher();
  }

  function ensureWatcher() {
    if (watcher) return;
    watcher = setInterval(checkPending, 2000);
  }

  async function checkPending() {
    if (pending.size === 0) {
      clearInterval(watcher);
      watcher = null;
      return;
    }
    let sha;
    try {
      sha = await getLatestSha();
    } catch (e) {
      console.warn('SHA poll failed', e);
      return;
    }
    // If repo head moved, reload fresh data once
    const oldRef = STATE.currentRef;
    if (sha !== oldRef) {
      await loadData();
    }

    let anyApplied = false;
    for (const [key, it] of [...pending.entries()]) {
      if (it.type === 'permit') {
        const obj = STATE.permits.find(r => String(r.permit_id) === String(it.id));
        if (it.expected && it.expected.__deleted) {
          // delete expected
          if (!obj) {
            it.state = 'applied'; it.appliedSha = sha; pending.delete(key); anyApplied = true;
          }
        } else {
          if (obj && matchesPatch(obj, it.expected)) {
            it.state = 'applied'; it.appliedSha = sha; pending.delete(key); anyApplied = true;
          }
        }
      }
    }
    renderPending();
    if (anyApplied && typeof window.renderList === 'function') window.renderList();
  }

  // ---------- Render list ----------
  function renderList() {
    if (!elList) return;

    const owner = elSelUtility?.value || 'All';
    const job   = elSelJob?.value || '';
    const q     = (elSearch?.value || '').trim().toLowerCase();

    // Build a filtered pole list
    let poles = STATE.poles.slice();
    if (owner && owner !== 'All') poles = poles.filter(p => p.owner === owner);
    if (job) poles = poles.filter(p => p.job_name === job);
    if (q) {
      poles = poles.filter(p => {
        const hay = `${p.tag} ${p.SCID}`.toLowerCase();
        return hay.includes(q);
      });
    }

    elList.innerHTML = '';
    for (const p of poles) {
      const rel = permitsForPole(p);
      const none = rel.length === 0;

      const permitsHtml = none
        ? `<div class="small muted"><em>NONE</em></div>`
        : `<ul style="margin:.4rem 0 .2rem 1rem;">
            ${rel.map(r => `
              <li class="small">
                <code>${r.permit_id}</code>
                <span ${chip(r.permit_status)}>${r.permit_status}</span>
                · by ${r.submitted_by} · ${r.submitted_at}
                <button class="btn btn-ghost" data-edit="${r.permit_id}" style="margin-left:8px;">Edit</button>
                <button class="btn btn-danger" data-delete="${r.permit_id}" style="margin-left:6px;">Delete</button>
              </li>`).join('')}
           </ul>`;

      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="flex" style="justify-content:space-between;align-items:flex-start;">
          <div>
            <div class="title">${p.job_name}</div>
            <div class="small muted">
              <b>Tag:</b> ${p.tag} · <b>SCID:</b> ${p.SCID} · <b>Owner:</b> ${p.owner}
            </div>
            <div class="small muted">
              <b>Pole Spec:</b> ${p.pole_spec||'—'} · <b>Proposed:</b> ${p.proposed_spec||'—'}
            </div>
            <div class="small muted">
              <b>Coords:</b> ${p.lat ?? '—'}, ${p.lon ?? '—'} · <b>MR:</b> ${p.mr_level || '—'}
            </div>
          </div>
        </div>
        <div class="spacer"></div>
        <div class="small muted">Permits:</div>
        ${permitsHtml}
      `;
      elList.appendChild(card);
    }

    // Bind edit/delete buttons
    elList.querySelectorAll('button[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-edit');
        prefillPermit(id);
        elPermitForm?.scrollIntoView({ behavior:'smooth', block:'start' });
      });
    });
    elList.querySelectorAll('button[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-delete');
        if (!confirm(`Delete permit ${id}? This will open a PR.`)) return;
        try {
          const resp = await API.deletePermit(id, 'User requested delete');
          setPermitMsg(`Deleted via PR. <a class="link" target="_blank" rel="noopener" href="${resp.pr_url}">View PR</a>`, true);
          trackPending('permit', id, { __deleted: true }, resp.pr_url);
        } catch (e) {
          setPermitMsg(e.message, false);
        }
      });
    });
  }
  window.renderList = renderList;

  // ---------- Filters population ----------
  function populateFilters() {
    if (elSelUtility) {
      // keep current selection if any
      if (!elSelUtility.dataset.ready) {
        elSelUtility.innerHTML = `
          <option value="All">All Utilities</option>
          <option value="BPUB">BPUB</option>
          <option value="AEP">AEP</option>
          <option value="MVEC">MVEC</option>`;
        elSelUtility.dataset.ready = '1';
      }
    }
    if (elSelJob) {
      const owner = elSelUtility?.value || 'All';
      const jobs = uniqueJobsByOwner(owner);
      const cur = elSelJob.value;
      elSelJob.innerHTML = `<option value="">All Jobs</option>` + jobs.map(j => `<option>${j}</option>`).join('');
      if (jobs.includes(cur)) elSelJob.value = cur;
    }
  }

  // ---------- Permit form ----------
  function setPermitMsg(msg, ok) {
    if (!elPermitMsg) return;
    elPermitMsg.innerHTML = ok ? `<span class="ok">${msg}</span>` : `<span class="err">${msg}</span>`;
  }

  function prefillPermit(permit_id) {
    const r = STATE.permits.find(x => String(x.permit_id) === String(permit_id));
    if (!r) return;
    if (fPermitId)    fPermitId.value    = r.permit_id;
    if (fJobName)     fJobName.value     = r.job_name;
    if (fTag)         fTag.value         = r.tag;
    if (fSCID)        fSCID.value        = r.SCID;
    if (fStatus)      fStatus.value      = r.permit_status;
    if (fSubmittedBy) fSubmittedBy.value = r.submitted_by || '';
    if (fSubmittedAt) {
      // convert MM/DD/YYYY -> YYYY-MM-DD for input date
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(r.submitted_at || '');
      fSubmittedAt.value = m ? `${m[3]}-${m[1]}-${m[2]}` : '';
    }
    if (fNotes)       fNotes.value       = r.notes || '';
    if (elBtnDelete)  elBtnDelete.disabled = false;
  }

  function readPermitForm() {
    const obj = {
      permit_id:    fPermitId?.value.trim(),
      job_name:     fJobName?.value.trim(),
      tag:          fTag?.value.trim(),
      SCID:         fSCID?.value.trim(),
      permit_status:fStatus?.value,
      submitted_by: fSubmittedBy?.value.trim(),
      submitted_at: toMDYFromInputDate(fSubmittedAt?.value),
      notes:        fNotes?.value.trim()
    };
    return obj;
  }

  if (elPermitForm) {
    // Initialize defaults
    if (fSubmittedAt && !fSubmittedAt.value) {
      const t = new Date();
      fSubmittedAt.value = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
    }
    if (elBtnDelete) elBtnDelete.disabled = true;

    elPermitForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      setPermitMsg('Submitting…', true);
      const form = readPermitForm();

      try {
        // required fields
        if (!form.permit_id) {
          // If user didn’t give an ID, build one from job/tag/SCID
          if (!form.job_name || !form.tag || !form.SCID) throw new Error('Need job_name, tag, SCID to build permit_id.');
          form.permit_id = API.buildPermitId(form.job_name, form.tag, form.SCID);
        }
        if (!form.submitted_by) throw new Error('Submitted By is required.');

        const exists = STATE.permits.some(r => String(r.permit_id) === String(form.permit_id));
        if (exists) {
          // update only changed fields
          const old = STATE.permits.find(r => String(r.permit_id) === String(form.permit_id));
          const patch = {};
          for (const k of ['job_name','tag','SCID','permit_status','submitted_by','submitted_at','notes']) {
            if (String(old[k] ?? '') !== String(form[k] ?? '')) patch[k] = form[k];
          }
          if (Object.keys(patch).length === 0) { setPermitMsg('No changes to save.', true); return; }
          const resp = await API.updatePermit(form.permit_id, patch, 'User edit');
          setPermitMsg(`Updated via PR. <a class="link" target="_blank" rel="noopener" href="${resp.pr_url}">View PR</a>`, true);
          trackPending('permit', form.permit_id, patch, resp.pr_url);
        } else {
          const resp = await API.upsertPermit(form, 'User upsert');
          setPermitMsg(`Created via PR. <a class="link" target="_blank" rel="noopener" href="${resp.pr_url}">View PR</a>`, true);
          // Expect all fields to appear
          trackPending('permit', form.permit_id, {
            job_name: form.job_name, tag: form.tag, SCID: form.SCID,
            permit_status: form.permit_status,
            submitted_by: form.submitted_by,
            submitted_at: form.submitted_at
          }, resp.pr_url);
          if (elBtnDelete) elBtnDelete.disabled = false;
        }
      } catch (err) {
        setPermitMsg(err.message, false);
      }
    });

    if (elBtnDelete) {
      elBtnDelete.addEventListener('click', async (e) => {
        e.preventDefault();
        const id = fPermitId?.value.trim();
        if (!id) return;
        if (!confirm(`Delete permit ${id}? This will open a PR.`)) return;
        try {
          const resp = await API.deletePermit(id, 'User requested delete');
          setPermitMsg(`Deleted via PR. <a class="link" target="_blank" rel="noopener" href="${resp.pr_url}">View PR</a>`, true);
          trackPending('permit', id, { __deleted: true }, resp.pr_url);
        } catch (err) {
          setPermitMsg(err.message, false);
        }
      });
    }
  }

  // ---------- Mass create ----------
  function setMassMsg(msg, ok) {
    if (!elMassMsg) return;
    elMassMsg.innerHTML = ok ? `<span class="ok">${msg}</span>` : `<span class="err">${msg}</span>`;
  }

  function refreshMassState() {
    if (!mJob || !elMassGo) return;
    const job = mJob.value;
    const blocked = job && anyPermitsForJob(job); // only allowed when no permits exist in the job
    elMassGo.disabled = !job || blocked;
    const hint = document.getElementById('massHint');
    if (hint) {
      hint.innerHTML = blocked
        ? `<span class="err">Mass create is only allowed when the job has <b>no existing permits</b>.</span>`
        : `<span class="muted">Will create "Submitted - Pending" permits for each pole in the job without permits.</span>`;
    }
  }

  if (elMassForm) {
    if (mDate && !mDate.value) {
      // default to today
      const d = new Date();
      mDate.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    elMassGo?.addEventListener('click', async (e) => {
      e.preventDefault();
      setMassMsg('Starting…', true);
      try {
        const job = mJob?.value.trim();
        const by  = mSubmittedBy?.value.trim();
        const dt  = toMDYFromInputDate(mDate?.value);
        const nt  = mNotes?.value.trim();

        if (!job) throw new Error('Choose a job.');
        if (!by) throw new Error('Submitted By is required.');

        // Guard: only when job truly has no existing permits
        if (anyPermitsForJob(job)) throw new Error('This job already has permits; mass-create is disabled.');

        const results = await API.massCreatePermitsForJob({
          job_name: job, submitted_by: by, dateMDY: dt, notes: nt
        });

        const okCount  = results.filter(r => r.ok).length;
        const fail     = results.filter(r => !r.ok);
        const prLinks  = results.filter(r => r.ok && r.pr_url).map(r => `<a class="link" href="${r.pr_url}" target="_blank" rel="noopener">${r.permit_id}</a>`);
        setMassMsg(`Created ${okCount}/${results.length} permits. ${prLinks.length ? 'View PRs: ' + prLinks.join(', ') : ''}`, true);

        // Track all ok ones as pending
        for (const r of results) {
          if (r.ok) trackPending('permit', r.permit_id, { permit_status:'Submitted - Pending' }, r.pr_url);
        }
      } catch (err) {
        setMassMsg(err.message, false);
      }
    });
  }

  // ---------- Admin CSV export ----------
  function setAdminMsg(msg, ok) {
    if (!elAdminMsg) return;
    elAdminMsg.innerHTML = ok ? `<span class="ok">${msg}</span>` : `<span class="err">${msg}</span>`;
  }

  function exportCsv(rows, filename) {
    const header = Object.keys(rows[0] || {}).join(',');
    const body = rows.map(r => Object.values(r).map(v => {
      const s = (v == null) ? '' : String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
      return s;
    }).join(',')).join('\n');
    const csv = header + '\n' + body;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename || 'export.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (elAdminForm) {
    elAdminGo?.addEventListener('click', (e) => {
      e.preventDefault();
      try {
        const owner = aUtility?.value || 'All';
        const job   = aJob?.value || '';
        const ps    = aStatus?.value || '';

        // Filter permits by utility/job/status
        let rows = STATE.permits.slice();

        if (owner && owner !== 'All') {
          // Keep only permits whose job/pole owner matches. Need pole lookup to know owner.
          const keyToOwner = new Map(STATE.poles.map(p => [`${p.job_name}::${p.tag}::${p.SCID}`, p.owner]));
          rows = rows.filter(r => keyToOwner.get(`${r.job_name}::${r.tag}::${r.SCID}`) === owner);
        }
        if (job) rows = rows.filter(r => r.job_name === job);
        if (ps)  rows = rows.filter(r => r.permit_status === ps);

        // Build export rows including permit + owner + coords for convenience
        const poleIdx = new Map(STATE.poles.map(p => [`${p.job_name}::${p.tag}::${p.SCID}`, p]));
        const out = rows.map(r => {
          const p = poleIdx.get(`${r.job_name}::${r.tag}::${r.SCID}`) || {};
          return {
            permit_id: r.permit_id,
            job_name: r.job_name,
            tag: r.tag,
            SCID: r.SCID,
            permit_status: r.permit_status,
            submitted_by: r.submitted_by,
            submitted_at: r.submitted_at,
            notes: r.notes || '',
            owner: p.owner || '',
            pole_spec: p.pole_spec || '',
            proposed_spec: p.proposed_spec || '',
            lat: p.lat ?? '',
            lon: p.lon ?? '',
            mr_level: p.mr_level || ''
          };
        });

        if (!out.length) { setAdminMsg('No rows match your filters.', false); return; }
        exportCsv(out, `permits_${Date.now()}.csv`);
        setAdminMsg(`Exported ${out.length} rows.`, true);
      } catch (err) {
        setAdminMsg(err.message, false);
      }
    });
  }

  // ---------- Event bindings ----------
  function safeBind(el, ev, fn) { if (el && el.addEventListener) el.addEventListener(ev, fn); }

  safeBind(elSelUtility, 'change', () => { populateFilters(); renderList(); refreshMassState(); });
  safeBind(elSelJob,     'change', () => { renderList(); refreshMassState(); });
  safeBind(elSearch,     'input',  () => renderList());

  // ---------- Boot ----------
  window.addEventListener('load', async () => {
    populateFilters();
    if (typeof loadData === 'function') await loadData();
    populateFilters(); // once more after data arrives (so jobs list is accurate)
    refreshMassState();
  });

})();
