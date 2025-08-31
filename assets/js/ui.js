// assets/js/ui.js
(function () {
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => new Intl.NumberFormat().format(n);

  // Map a permit_status to a CSS class + inline color (for NONE)
  function statusChipHTML(status) {
    const s = String(status || '').trim();
    let cls = 'na_other';
    let extra = '';
    if (s === 'Submitted - Pending') cls = 'pending';
    else if (s === 'Approved') cls = 'approved';
    else if (s === 'Created - NOT Submitted') cls = 'created';
    else if (s === 'Not Approved - Cannot Attach') cls = 'na_cannot';
    else if (s.startsWith('Not Approved -')) cls = 'na_other';
    else if (s === 'NONE') { cls = ''; extra = 'style="background:#94a3b8;color:#0b0c10"'; } // gray chip for NONE
    return `<span class="chip ${cls}" ${extra}>${s || '—'}</span>`;
  }

  // Composite key for a pole
  const poleKey = (p) => `${p.job_name}::${p.tag}::${p.SCID}`;

  // ------- State helpers -------
  function buildPermitIndex(permits) {
    const map = new Map();
    for (const r of (permits || [])) {
      const key = `${r.job_name}::${r.tag}::${r.SCID}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    // stable sort by permit_id for nicer display
    for (const arr of map.values()) {
      arr.sort((a, b) => String(a.permit_id).localeCompare(String(b.permit_id)));
    }
    return map;
  }

  function ensureJobFilterOptions(poles) {
    const sel = $('#fJob');
    if (!sel) return;
    const prev = sel.value;
    const jobs = Array.from(new Set((poles || []).map(p => p.job_name))).sort();
    sel.innerHTML = `<option>All</option>` + jobs.map(j => `<option>${j}</option>`).join('');
    if (jobs.includes(prev)) sel.value = prev;
  }

  // ------- Rendering the left list (INCLUDES poles with zero permits) -------
  function renderList() {
    const st = window.STATE || {};
    const poles = st.poles || [];
    const permits = st.permits || [];
    const byKey = buildPermitIndex(permits);

    // Filters
    const util = $('#fUtility')?.value || 'All';
    const job = $('#fJob')?.value || 'All';
    const q = ($('#fSearch')?.value || '').toLowerCase().trim();

    const listEl = $('#list');
    listEl.innerHTML = '';

    // Filter poles first (not permits!)
    const filteredPoles = poles.filter(p => {
      if (util !== 'All' && p.owner !== util) return false;
      if (job !== 'All' && p.job_name !== job) return false;
      if (q) {
        const hay = `${p.job_name} ${p.tag} ${p.SCID} ${p.owner} ${p.mr_level}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    // KPIs
    $('#kPoles').textContent = fmt(filteredPoles.length);
    $('#kPermits').textContent = fmt(permits.length);

    // Build each pole card (even if the pole has ZERO permits)
    for (const p of filteredPoles) {
      const key = poleKey(p);
      const rel = byKey.get(key) || [];

      const card = document.createElement('div');
      card.className = 'pole';
      card.innerHTML = `
        <div class="title">
          ${p.job_name}
          <span class="muted small"> · Tag: <b>${p.tag}</b> · SCID: <b>${p.SCID}</b></span>
        </div>
        <div class="small muted">
          Owner: ${p.owner || '—'} · Spec: ${p.pole_spec || '—'} → ${p.proposed_spec || '—'} · MR: ${p.mr_level || '—'}
        </div>
        <div class="spacer"></div>
        <div class="small muted">Permits:</div>
        <div>
          ${
            rel.length
              ? rel.map(r => `
                  <div class="small" style="margin:4px 0;">
                    <code>${r.permit_id}</code>
                    ${statusChipHTML(r.permit_status)}
                    ${r.submitted_by ? ` · by ${r.submitted_by}` : ''}
                    ${r.submitted_at ? ` · ${r.submitted_at}` : ''}
                    <button class="btn" style="margin-left:8px" onclick="window.UI_editPermit('${key}','${encodeURIComponent(r.permit_id)}')">Edit</button>
                  </div>
                `).join('')
              : `<div class="small" style="margin:6px 0;">
                   ${statusChipHTML('NONE')}
                   <button class="btn" style="margin-left:8px" onclick="window.UI_editPermit('${key}','__new')">New permit for this pole</button>
                 </div>`
          }
        </div>
      `;
      listEl.appendChild(card);
    }
  }

  // ------- Right panel editor hookups -------
  function fillPoleDetails(p) {
    $('#pole_job').value = p.job_name || '';
    $('#pole_owner').value = p.owner || '';
    $('#pole_tag').value = p.tag || '';
    $('#pole_scid').value = p.SCID || '';
    $('#pole_spec').value = p.pole_spec || '';
    $('#pole_prop').value = p.proposed_spec || '';
    $('#pole_lat').value = (p.lat ?? '').toString();
    $('#pole_lon').value = (p.lon ?? '').toString();
    $('#pole_mr').value = p.mr_level || '';
  }

  function fillPermitEditorFor(key, permitId) {
    const st = window.STATE || {};
    const [job_name, tag, SCID] = key.split('::');
    const byKey = buildPermitIndex(st.permits || []);
    const rel = byKey.get(key) || [];

    // Populate the dropdown
    const sel = $('#selPermit');
    const opts = [`<option value="__new">— New —</option>`]
      .concat(rel.map(r => `<option value="${encodeURIComponent(r.permit_id)}">${r.permit_id}</option>`));
    sel.innerHTML = opts.join('');
    sel.value = permitId || '__new';

    if (permitId && permitId !== '__new') {
      const id = decodeURIComponent(permitId);
      const r = rel.find(x => String(x.permit_id) === id);
      if (r) {
        $('#permit_id').value = r.permit_id || '';
        $('#permit_status').value = r.permit_status || 'Created - NOT Submitted';
        $('#submitted_by').value = r.submitted_by || '';
        // Normalize date to yyyy-mm-dd for input[type=date] if it's MM/DD/YYYY
        const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(r.submitted_at || '');
        $('#submitted_at').value = m ? `${m[3]}-${m[1]}-${m[2]}` : (r.submitted_at || '');
        $('#permit_notes').value = r.notes || '';
      }
    } else {
      // New default
      $('#permit_id').value = `PERM-${job_name}-${tag}-${SCID}`;
      $('#permit_status').value = 'Created - NOT Submitted';
      $('#submitted_by').value = '';
      // default to today
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      $('#submitted_at').value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
      $('#permit_notes').value = '';
    }
  }

  function selectPoleByKey(key) {
    const st = window.STATE || {};
    const poles = st.poles || [];
    const [job_name, tag, SCID] = key.split('::');
    const p = poles.find(x =>
      String(x.job_name) === job_name &&
      String(x.tag) === tag &&
      String(x.SCID) === SCID
    );
    if (!p) return;
    fillPoleDetails(p);
    fillPermitEditorFor(key, '__new');
  }

  // Expose editor entry points for the left list buttons
  window.UI_editPermit = function(key, permitId) {
    selectPoleByKey(key);
    fillPermitEditorFor(key, permitId || '__new');
    // Scroll to editor if on small screens
    $('#permit_id')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ------- Wire filters & data load -------
  function wireFilters() {
    $('#fUtility')?.addEventListener('change', renderList);
    $('#fJob')?.addEventListener('change', renderList);
    $('#fSearch')?.addEventListener('input', renderList);
  }

  window.addEventListener('data:loaded', () => {
    const st = window.STATE || {};
    ensureJobFilterOptions(st.poles || []);
    renderList();
  });

  document.addEventListener('DOMContentLoaded', wireFilters);
})();
