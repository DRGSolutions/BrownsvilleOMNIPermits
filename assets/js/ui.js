// assets/js/ui.js
// UI is back to: select a POLE first, then edit/create/delete that pole's permits.

(() => {
  const CFG  = (window.APP_CONFIG || {});
  const DATA = window.DATA;

  // Fallback API caller (uses your Vercel function)
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
  const $ = (id) => document.getElementById(id);

  // Filters
  const filterUtility = $('filterUtility');
  const filterJob     = $('filterJob');
  const filterQuery   = $('filterQuery');

  // Counters
  const kPoles   = $('kPoles');
  const kPermits = $('kPermits');
  const kLoaded  = $('kLoaded');
  const kCommit  = $('kCommit');
  const statusEl = $('status');

  // List
  const listEl = $('list');

  // Pole details (read-only)
  const poleFields = {
    job_name:  $('pole_job_name'),
    owner:     $('pole_owner'),
    tag:       $('pole_tag'),
    SCID:      $('pole_scid'),
    pole_spec: $('pole_spec'),
    proposed_spec: $('pole_proposed_spec'),
    lat: $('pole_lat'),
    lon: $('pole_lon'),
    mr_level: $('pole_mr_level'),
  };

  // Permit editor
  const permitSelector = $('permitSelector');
  const permit_id      = $('permit_id');
  const permit_status  = $('permit_status');
  const submitted_by   = $('submitted_by');
  const submitted_at   = $('submitted_at'); // input[type=date]
  const permit_notes   = $('permit_notes');
  const btnSavePermit  = $('btnSavePermit');
  const btnDeletePerm  = $('btnDeletePermit');
  const msgPermit      = $('msgPermit');
  const permitPoleHint = $('permitPoleHint');

  // Admin tools
  const adminUtility = $('adminUtility');
  const adminJob     = $('adminJob');
  const adminStatus  = $('adminStatus');
  const btnExportCSV = $('btnExportCSV');
  const msgExport    = $('msgExport');

  // Mass create
  const bulkJob         = $('bulkJob');
  const bulkStatus      = $('bulkStatus'); // fixed to Submitted - Pending in HTML, value still captured
  const bulkSubmittedBy = $('bulkSubmittedBy');
  const bulkDate        = $('bulkDate');
  const btnMassCreate   = $('btnMassCreate');
  const msgBulk         = $('msgBulk');

  // Current selections
  let currentPole = null;      // selected pole
  let currentPermitId = '';    // '' means New

  // ------- helpers -------
  const fmt = (n) => new Intl.NumberFormat().format(n);
  const toMDY = (iso) => {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
  };
  const toISO = (mdy) => {
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
    permitSelector.innerHTML = '<option value="">— Select a pole first —</option>';
    permitSelector.disabled = true;
    permit_id.value = '';
    permit_status.value = 'NONE';
    submitted_by.value = '';
    submitted_at.value = '';
    permit_notes.value = '';
    btnSavePermit.disabled = true;
    btnDeletePerm.disabled = true;
    permitPoleHint.textContent = 'No pole selected.';
  }

  function fillPoleDetails(p) {
    currentPole = p;
    for (const [k, el] of Object.entries(poleFields)) { el.value = p[k] ?? ''; }

    // Build selector for permits FOR THIS POLE
    const prs = DATA.permitsForPole(p);
    permitSelector.innerHTML = '<option value="">— New —</option>' +
      prs.map(r => `<option value="${r.permit_id}">${r.permit_id} (${r.permit_status || 'NONE'})</option>`).join('');
    permitSelector.disabled = false;

    // Default new permit skeleton
    currentPermitId = '';
    permit_id.value = `PERM-${p.job_name}-${p.tag}-${p.SCID}`;
    permit_status.value = 'NONE';
    submitted_by.value = '';
    submitted_at.value = '';
    permit_notes.value = '';
    btnSavePermit.disabled = false;
    btnDeletePerm.disabled = true;
    permitPoleHint.textContent = `Permits for pole: ${p.job_name} / ${p.tag} / ${p.SCID}`;
  }

  function loadPermitIntoForm(id) {
    currentPermitId = id || '';
    if (!id) { // new
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
    submitted_at.value = toISO(r.submitted_at || '');
    permit_notes.value = r.notes || '';
    btnDeletePerm.disabled = false;
  }

  // ------- filters & list -------
  function rebuildJobOptions() {
    const owner = filterUtility.value || '';
    const jobs  = DATA.getJobNamesFilteredByOwner(owner);
    const cur   = filterJob.value;
    filterJob.innerHTML = ['<option value="">All</option>', ...jobs.map(j => `<option>${j}</option>`)].join('');
    if (cur && jobs.includes(cur)) filterJob.value = cur;

    // Admin job filter (all jobs)
    const allJobs = DATA.getJobNamesFilteredByOwner('');
    adminJob.innerHTML = ['<option value="">All</option>', ...allJobs.map(j => `<option>${j}</option>`)].join('');

    // Eligible jobs for mass create
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

  function poleCardHTML(p, prs) {
    return `
      <div class="flex" style="justify-content:space-between;align-items:flex-start;">
        <div>
          <div class="title">
            ${p.job_name} — <span class="muted small">${p.owner}</span>
          </div>
          <div class="small muted">Tag: <b>${p.tag}</b> · SCID: <b>${p.SCID}</b> · Spec: ${p.pole_spec || '—'} → ${p.proposed_spec || '—'}</div>
          <div class="small muted">Coords: ${p.lat ?? '—'}, ${p.lon ?? '—'} · MR: ${p.mr_level || '—'}</div>
        </div>
        <button class="btn" data-action="select-pole" data-job="${p.job_name}" data-tag="${p.tag}" data-scid="${p.SCID}">Select</button>
      </div>
      <div class="spacer"></div>
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
      card.className = 'card pole-card';
      card.setAttribute('data-job', p.job_name);
      card.setAttribute('data-tag', p.tag);
      card.setAttribute('data-scid', p.SCID);
      card.innerHTML = poleCardHTML(p, prs);
      listEl.appendChild(card);
    }
  }

  // Delegated clicks from list
  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) {
      // Clicking the card selects the pole, too
      const row = e.target.closest('.pole-card');
      if (!row) return;
      const p = DATA.state.poles.find(x =>
        String(x.job_name) === row.dataset.job &&
        String(x.tag)      === row.dataset.tag &&
        String(x.SCID)     === row.dataset.scid
      );
      if (p) fillPoleDetails(p);
      return;
    }

    const job  = btn.getAttribute('data-job');
    const tag  = btn.getAttribute('data-tag');
    const scid = btn.getAttribute('data-scid');

    const p = DATA.state.poles.find(x =>
      String(x.job_name) === job && String(x.tag) === tag && String(x.SCID) === scid
    );
    if (!p) return;

    if (btn.dataset.action === 'select-pole') {
      fillPoleDetails(p);
      return;
    }

    fillPoleDetails(p);
    if (btn.dataset.action === 'edit-permit') {
      permitSelector.value = btn.getAttribute('data-permit-id');
      loadPermitIntoForm(permitSelector.value);
    } else if (btn.dataset.action === 'new-permit') {
      permitSelector.value = '';
      loadPermitIntoForm('');
    }
  });

  permitSelector.addEventListener('change', () => {
    loadPermitIntoForm(permitSelector.value || '');
  });

  // ------- Save / Delete permit -------
  btnSavePermit.addEventListener('click', async () => {
    if (!currentPole) { msgPermit.textContent = 'Select a pole first.'; return; }

    const pid = permit_id.value.trim();
    const st  = permit_status.value;
    const sb  = submitted_by.value.trim();
    const sd  = submitted_at.value ? toMDY(submitted_at.value) : '';
    const nt  = permit_notes.value.trim();

    msgPermit.textContent = 'Saving…';
    try {
      let payload;
      if (currentPermitId) {
        const patch = {
          permit_status: st,
          submitted_by: sb || undefined,
          submitted_at: sd || undefined,
          notes: nt || undefined,
        };
        payload = { actorName: 'Website User', change: { type: 'update_permit', permit_id: currentPermitId, patch } };
      } else {
        if (!pid) throw new Error('Permit ID is required for new permits.');
        if (!sb)  throw new Error('Submitted By is required.');
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
        payload = { actorName: 'Website User', change: { type: 'upsert_permit', permit } };
      }
      const res = await callApi(payload);
      msgPermit.innerHTML = `PR opened. <a class="link" href="${res.pr_url}" target="_blank" rel="noopener">View PR</a>`;
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
      // Preferred: server supports delete_permit
      const res = await callApi({ actorName:'Website User', change:{ type:'delete_permit', permit_id: currentPermitId } });
      msgPermit.innerHTML = `PR opened. <a class="link" href="${res.pr_url}" target="_blank" rel="noopener">View PR</a>`;
      setTimeout(() => DATA.reload().catch(()=>{}), 1500);
    } catch (err) {
      // Fallback: set to NONE if server doesn’t support delete
      if (String(err.message || '').includes('unknown') || String(err.message || '').includes('delete_permit')) {
        try {
          const res = await callApi({ actorName:'Website User', change:{ type:'update_permit', permit_id: currentPermitId, patch:{ permit_status:'NONE', submitted_by: undefined, submitted_at: undefined, notes: undefined } } });
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
  filterUtility.addEventListener('change', () => { rebuildJobOptions(); renderList(); clearPoleDetails(); });
  filterJob.addEventListener('change', () => { renderList(); clearPoleDetails(); });
  filterQuery.addEventListener('input', renderList);

  // ------- Admin: export CSV -------
  $('btnExportCSV').addEventListener('click', () => {
    const own = adminUtility.value || '';
    const job = adminJob.value || '';
    const pst = adminStatus.value || '';

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
      rows.map(r => headers.map(h => `"${(r[h] ?? '').toString().replace(/"/g,'""')}"`).join(','))
    ).join('\n');

    const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `permits_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    msgExport.textContent = `Exported ${rows.length} row(s).`;
  });

  // ------- Mass create -------
  btnMassCreate.addEventListener('click', async () => {
    const job = bulkJob.value || '';
    const sb  = bulkSubmittedBy.value.trim();
    const iso = bulkDate.value || '';
    const mdy = iso ? `${iso.slice(5,7)}/${iso.slice(8,10)}/${iso.slice(0,4)}` : '';

    msgBulk.textContent = '';
    if (!job) { msgBulk.textContent = 'Select a job name.'; return; }
    if (!sb)  { msgBulk.textContent = 'Submitted By is required.'; return; }

    const eligible = new Set(DATA.jobsEligibleForMassCreate());
    if (!eligible.has(job)) { msgBulk.textContent = 'This job is no longer eligible (permits exist).'; return; }

    const obj = DATA.state.jobs.get(job);
    if (!obj || !obj.poles.length) { msgBulk.textContent = 'No poles found for that job.'; return; }

    let ok = 0, fail = 0;
    for (const p of obj.poles) {
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
      } catch { fail++; }
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
      adminUtility.value = filterUtility.value || '';
    }
  };

  DATA.init().catch(err => { statusEl.textContent = `Error: ${err.message || err}`; });
})();
