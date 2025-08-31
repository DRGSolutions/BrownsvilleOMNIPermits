// assets/js/ui.js
// All DOM wiring, consistent job_name usage, working Edit, filters, and mass-create.

(() => {
  const CFG = (window.APP_CONFIG || {});
  const DATA = window.DATA;

  // Fallback API caller if a dedicated API module isn't present
  const callApi = (async payload => {
    const impl =
      (window.API && (window.API.request || window.API.call || window.API.callApi)) ||
      (async (p) => {
        const res = await fetch(CFG.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Permits-Key': CFG.SHARED_KEY },
          body: JSON.stringify(p)
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`);
        return j;
      });
    return impl(payload);
  });

  // ------- DOM -------
  const el = (id) => document.getElementById(id);

  const filterUtility = el('filterUtility');
  const filterJob     = el('filterJob');
  const filterQuery   = el('filterQuery');

  const kPoles   = el('kPoles');
  const kPermits = el('kPermits');
  const kLoaded  = el('kLoaded');
  const kCommit  = el('kCommit');
  const statusEl = el('status');
  const listEl   = el('list');

  // Pole details (read-only)
  const poleFields = {
    job_name:  el('pole_job_name'),
    owner:     el('pole_owner'),
    tag:       el('pole_tag'),
    SCID:      el('pole_scid'),
    pole_spec: el('pole_spec'),
    proposed_spec: el('pole_proposed_spec'),
    lat: el('pole_lat'),
    lon: el('pole_lon'),
    mr_level: el('pole_mr_level'),
  };

  // Permit editor
  const permitSelector = el('permitSelector');
  const permit_id      = el('permit_id');
  const permit_status  = el('permit_status');
  const submitted_by   = el('submitted_by');
  const submitted_at   = el('submitted_at');
  const permit_notes   = el('permit_notes');
  const btnSavePermit  = el('btnSavePermit');
  const btnDeletePerm  = el('btnDeletePermit');
  const msgPermit      = el('msgPermit');
  const permitPoleHint = el('permitPoleHint');

  // Admin tools
  const adminUtility = el('adminUtility');
  const adminJob     = el('adminJob');
  const adminStatus  = el('adminStatus');
  const btnExportCSV = el('btnExportCSV');
  const msgExport    = el('msgExport');

  const bulkJob         = el('bulkJob');
  const bulkStatus      = el('bulkStatus'); // fixed: Submitted - Pending
  const bulkSubmittedBy = el('bulkSubmittedBy');
  const bulkDate        = el('bulkDate');
  const btnMassCreate   = el('btnMassCreate');
  const msgBulk         = el('msgBulk');

  // Current selections
  let currentPole = null;      // {job_name, tag, SCID, ...}
  let currentPermitId = '';    // selected permit_id or '' for New

  // ------- helpers -------
  const fmt = (n) => new Intl.NumberFormat().format(n);
  const toMDY = (iso) => { // yyyy-mm-dd -> mm/dd/yyyy
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
  };
  const toISO = (mdy) => { // mm/dd/yyyy -> yyyy-mm-dd
    if (!mdy) return '';
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(mdy);
    return m ? `${m[3]}-${m[1]}-${m[2]}` : mdy;
  };

  function statusClass(s) {
    switch (String(s)) {
      case 'Approved': return 's-approved';
      case 'Submitted - Pending': return 's-pending';
      case 'Created - NOT Submitted': return 's-created';
      case 'Not Approved - Cannot Attach': return 's-na-cannot';
      case 'Not Approved - PLA Issues':
      case 'Not Approved - MRE Issues':
      case 'Not Approved - Other Issues': return 's-na-other';
      case 'NONE':
      default: return '';
    }
  }

  function statusChip(s) {
    if (!s || s === 'NONE') return '<span class="status">NONE</span>';
    const cls = statusClass(s);
    const extra = s === 'Created - NOT Submitted' ? ' data-bg="true"' : '';
    return `<span class="status ${cls}"${extra}>${s}</span>`;
  }

  function clearPoleDetails() {
    currentPole = null;
    for (const k in poleFields) poleFields[k].value = '';
    permitSelector.innerHTML = '<option value="">— New —</option>';
    permitSelector.disabled = true;
    permit_id.value = ''; permit_status.value = 'NONE';
    submitted_by.value = '';
    submitted_at.value = ''; // browser date input
    permit_notes.value = '';
    btnSavePermit.disabled = true;
    btnDeletePerm.disabled = true;
    permitPoleHint.textContent = 'No pole selected.';
  }

  function fillPoleDetails(p) {
    currentPole = p;
    poleFields.job_name.value  = p.job_name || '';
    poleFields.owner.value     = p.owner || '';
    poleFields.tag.value       = p.tag || '';
    poleFields.SCID.value      = p.SCID || '';
    poleFields.pole_spec.value = p.pole_spec || '';
    poleFields.proposed_spec.value = p.proposed_spec || '';
    poleFields.lat.value       = p.lat ?? '';
    poleFields.lon.value       = p.lon ?? '';
    poleFields.mr_level.value  = p.mr_level || '';

    // Build permit selector for this pole
    const prs = DATA.permitsForPole(p);
    permitSelector.innerHTML = '<option value="">— New —</option>' +
      prs.map(r => `<option value="${r.permit_id}">${r.permit_id} (${r.permit_status || 'NONE'})</option>`).join('');
    permitSelector.disabled = false;
    btnSavePermit.disabled = false;
    btnDeletePerm.disabled = true;
    currentPermitId = '';
    permit_id.value = '';
    permit_status.value = 'NONE';
    submitted_by.value = '';
    submitted_at.value = '';
    permit_notes.value = '';
    permitPoleHint.textContent = `Editing permits for pole: ${p.job_name} / ${p.tag} / ${p.SCID}`;
  }

  function loadPermitIntoForm(id) {
    currentPermitId = id || '';
    if (!id) {
      permit_id.value = `PERM-${currentPole.job_name}-${currentPole.tag}-${currentPole.SCID}`;
      permit_status.value = 'NONE';
      submitted_by.value = '';
      submitted_at.value = '';
      permit_notes.value = '';
      btnDeletePerm.disabled = true;
      return;
    }
    const r = DATA.findPermitById(id);
    if (!r) return;
    permit_id.value = r.permit_id || '';
    permit_status.value = r.permit_status || 'NONE';
    submitted_by.value = r.submitted_by || '';
    // r.submitted_at is MDY; show as input[type=date] ISO
    submitted_at.value = toISO(r.submitted_at || '');
    permit_notes.value = r.notes || '';
    btnDeletePerm.disabled = false;
  }

  // ------- filters & list -------
  function rebuildJobOptions() {
    const owner = filterUtility.value || '';
    const jobs = DATA.getJobNamesFilteredByOwner(owner);
    const current = filterJob.value;
    filterJob.innerHTML = ['<option value="">All</option>', ...jobs.map(j => `<option>${j}</option>`)].join('');
    // restore if still present
    if (current && jobs.includes(current)) filterJob.value = current;

    // Admin job list mirrors all jobs (no owner filter) for exports
    const allJobs = DATA.getJobNamesFilteredByOwner('');
    adminJob.innerHTML = ['<option value="">All</option>', ...allJobs.map(j => `<option>${j}</option>`)].join('');

    // Mass-create job list: only eligible ones
    const eligible = DATA.jobsEligibleForMassCreate();
    bulkJob.innerHTML = ['<option value="">Select job…</option>', ...eligible.map(j => `<option>${j}</option>`)].join('');
  }

  function renderCounters() {
    const S = DATA.state;
    kPoles.textContent   = fmt(S.poles.length);
    kPermits.textContent = fmt(S.permits.length);
    kLoaded.textContent  = S.lastLoaded ? S.lastLoaded.toLocaleString() : '—';
    kCommit.textContent  = S.commitSha ? S.commitSha.slice(0,7) : '—';
    statusEl.innerHTML   = `<span class="status s-approved">Loaded</span>`;
  }

  function renderList() {
    const owner = filterUtility.value || '';
    const job   = filterJob.value || '';
    const q     = filterQuery.value || '';

    const poles = DATA.polesFiltered({ owner, job_name: job, q });

    listEl.innerHTML = '';
    for (const p of poles) {
      const prs = DATA.permitsForPole(p);
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="title">
          ${p.job_name} — <span class="muted small">${p.owner}</span>
        </div>
        <div class="small muted">Tag: <b>${p.tag}</b> · SCID: <b>${p.SCID}</b> · Spec: ${p.pole_spec || '—'} → ${p.proposed_spec || '—'}</div>
        <div class="small muted">Coords: ${p.lat ?? '—'}, ${p.lon ?? '—'} · MR: ${p.mr_level || '—'}</div>
        <div style="height:6px"></div>
        <div class="small muted">Permits:</div>
        ${
          prs.length
            ? `<ul style="margin:.4rem 0 .2rem 1rem;">
                 ${prs.map(r => `
                   <li class="small">
                     <code>${r.permit_id}</code>
                     ${statusChip(r.permit_status)}
                     ${r.submitted_by ? ` · by ${r.submitted_by}` : ''}
                     <button class="btn" style="margin-left:8px" data-action="edit-permit" data-permit-id="${r.permit_id}" data-job="${p.job_name}" data-tag="${p.tag}" data-scid="${p.SCID}">Edit</button>
                   </li>
                 `).join('')}
               </ul>`
            : `<div class="small muted"><em>No permits (NONE)</em>
                 <button class="btn" style="margin-left:8px" data-action="new-permit" data-job="${p.job_name}" data-tag="${p.tag}" data-scid="${p.SCID}">Create</button>
               </div>`
        }
      `;
      listEl.appendChild(card);
    }
  }

  // Delegated clicks from the list for Edit/New
  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const job  = btn.getAttribute('data-job');
    const tag  = btn.getAttribute('data-tag');
    const scid = btn.getAttribute('data-scid');

    // Find pole by composite key
    const pole = DATA.state.poles.find(p =>
      String(p.job_name) === job && String(p.tag) === tag && String(p.SCID) === scid
    );
    if (!pole) return;

    fillPoleDetails(pole);

    if (btn.dataset.action === 'edit-permit') {
      const pid = btn.getAttribute('data-permit-id');
      permitSelector.value = pid;
      loadPermitIntoForm(pid);
    } else {
      // new permit
      permitSelector.value = '';
      loadPermitIntoForm('');
    }

    // Scroll to editor
    document.querySelector('.card .title + .row')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // When the selector changes
  permitSelector.addEventListener('change', () => {
    loadPermitIntoForm(permitSelector.value || '');
  });

  // ------- Save/Delete permit -------
  btnSavePermit.addEventListener('click', async () => {
    if (!currentPole) { msgPermit.textContent = 'Select a pole first.'; return; }

    const pid = permit_id.value.trim();
    const st  = permit_status.value;
    const sb  = submitted_by.value.trim();
    const sd  = submitted_at.value ? toMDY(submitted_at.value) : ''; // make MDY
    const nt  = permit_notes.value.trim();

    msgPermit.textContent = 'Saving…';

    try {
      let payload;
      if (currentPermitId) {
        // UPDATE existing
        const patch = {
          permit_status: st,
          submitted_by: sb || undefined,
          submitted_at: sd || undefined,
          notes: nt || undefined,
        };
        payload = {
          actorName: 'Website User',
          change: { type: 'update_permit', permit_id: currentPermitId, patch }
        };
      } else {
        if (!pid) throw new Error('Permit ID is required for new permits.');
        if (!sb) throw new Error('Submitted By is required.');
        // UPSERT new
        const permit = {
          permit_id: pid,
          job_name: currentPole.job_name,
          tag: currentPole.tag,
          SCID: currentPole.SCID,
          permit_status: st,
          submitted_by: sb,
          submitted_at: sd || toMDY(new Date().toISOString().slice(0,10)),
          notes: nt || undefined
        };
        payload = {
          actorName: 'Website User',
          change: { type: 'upsert_permit', permit }
        };
      }

      const res = await callApi(payload);
      msgPermit.innerHTML = `PR opened. <a class="link" href="${res.pr_url}" target="_blank" rel="noopener">View PR</a>`;
      // refresh after a short delay, or rely on your watcher if present
      setTimeout(() => DATA.reload().catch(()=>{}), 1500);
    } catch (err) {
      msgPermit.textContent = err.message || String(err);
    }
  });

  btnDeletePerm.addEventListener('click', async () => {
    if (!currentPermitId) return;
    if (!confirm(`Delete permit ${currentPermitId}?`)) return;
    msgPermit.textContent = 'Deleting…';
    try {
      // Prefer a dedicated delete operation if your API supports it.
      const payload = {
        actorName: 'Website User',
        change: { type: 'delete_permit', permit_id: currentPermitId }
      };
      const res = await callApi(payload);
      msgPermit.innerHTML = `PR opened. <a class="link" href="${res.pr_url}" target="_blank" rel="noopener">View PR</a>`;
      setTimeout(() => DATA.reload().catch(()=>{}), 1500);
    } catch (err) {
      // Fallback: mark as NONE if delete is not supported server-side
      if (String(err.message || '').includes('unknown') || String(err.message || '').includes('delete_permit')) {
        try {
          const payload = {
            actorName: 'Website User',
            change: { type: 'update_permit', permit_id: currentPermitId, patch: { permit_status: 'NONE', submitted_by: undefined, submitted_at: undefined, notes: undefined } }
          };
          const res = await callApi(payload);
          msgPermit.innerHTML = `PR opened. <a class="link" href="${res.pr_url}" target="_blank" rel="noopener">View PR</a>`;
          setTimeout(() => DATA.reload().catch(()=>{}), 1500);
          return;
        } catch (e2) {
          msgPermit.textContent = e2.message || String(e2);
          return;
        }
      }
      msgPermit.textContent = err.message || String(err);
    }
  });

  // ------- Filters -------
  filterUtility.addEventListener('change', () => {
    rebuildJobOptions();
    renderList();
  });
  filterJob.addEventListener('change', renderList);
  filterQuery.addEventListener('input', renderList);

  // ------- Admin: export CSV -------
  btnExportCSV.addEventListener('click', () => {
    const own = adminUtility.value || '';
    const job = adminJob.value || '';
    const pst = adminStatus.value || '';

    // Rows: one per permit matching filters; include core pole fields
    const rows = [];
    for (const p of DATA.polesFiltered({ owner: own, job_name: job, q: '' })) {
      const prs = DATA.permitsForPole(p);
      if (!prs.length && (!pst || pst === 'NONE')) {
        rows.push({ job_name: p.job_name, owner: p.owner, tag: p.tag, SCID: p.SCID,
          permit_id: '', permit_status: 'NONE', submitted_by: '', submitted_at: '', notes: '' });
      } else {
        for (const r of prs) {
          if (pst && String(r.permit_status) !== pst) continue;
          rows.push({ job_name: p.job_name, owner: p.owner, tag: p.tag, SCID: p.SCID,
            permit_id: r.permit_id, permit_status: r.permit_status || 'NONE',
            submitted_by: r.submitted_by || '', submitted_at: r.submitted_at || '', notes: r.notes || '' });
        }
      }
    }

    if (!rows.length) { msgExport.textContent = 'No rows for current filters.'; return; }

    const headers = ['job_name','owner','tag','SCID','permit_id','permit_status','submitted_by','submitted_at','notes'];
    const csv = [headers.join(',')].concat(
      rows.map(r => headers.map(h => {
        const v = (r[h] ?? '').toString().replace(/"/g, '""');
        return `"${v}"`;
      }).join(','))
    ).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `permits_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    msgExport.textContent = `Exported ${rows.length} row(s).`;
  });

  // ------- Admin: mass-create -------
  btnMassCreate.addEventListener('click', async () => {
    const job = bulkJob.value || '';
    const sb  = bulkSubmittedBy.value.trim();
    const dt  = bulkDate.value ? (bulkDate.value) : ''; // ISO yyyy-mm-dd
    const mdy = dt ? `${dt.slice(5,7)}/${dt.slice(8,10)}/${dt.slice(0,4)}` : '';

    msgBulk.textContent = '';

    if (!job) { msgBulk.textContent = 'Select a job name.'; return; }
    if (!sb)  { msgBulk.textContent = 'Submitted By is required.'; return; }

    // verify still eligible
    const eligible = new Set(DATA.jobsEligibleForMassCreate());
    if (!eligible.has(job)) { msgBulk.textContent = 'This job is no longer eligible (permits exist).'; return; }

    // create one permit per pole in this job (id deterministic)
    const jobObj = DATA.state.jobs.get(job);
    if (!jobObj || !jobObj.poles.length) { msgBulk.textContent = 'No poles found for that job.'; return; }

    // sequentially to avoid GitHub API rate issues
    let ok = 0, fail = 0;
    for (const p of jobObj.poles) {
      const permit = {
        permit_id: `PERM-${p.job_name}-${p.tag}-${p.SCID}`,
        job_name: p.job_name, tag: p.tag, SCID: p.SCID,
        permit_status: 'Submitted - Pending',
        submitted_by: sb,
        submitted_at: mdy || toMDY(new Date().toISOString().slice(0,10)),
        notes: ''
      };
      try {
        await callApi({ actorName: 'Website User', change: { type: 'upsert_permit', permit } });
        ok++;
      } catch (e) { fail++; }
    }
    msgBulk.textContent = `Mass-create complete: ${ok} success, ${fail} failed.`;
    setTimeout(() => DATA.reload().catch(()=>{}), 1500);
  });

  // ------- entry -------
  window.UI = {
    onDataLoaded() {
      renderCounters();
      rebuildJobOptions();
      renderList();
      clearPoleDetails();

      // mirror utility to admin filter initial value
      adminUtility.value = filterUtility.value || '';
    }
  };

  // Kick off load
  DATA.init().catch(err => {
    statusEl.textContent = `Error: ${err.message || err}`;
  });
})();
