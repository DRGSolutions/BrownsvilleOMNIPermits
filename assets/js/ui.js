// assets/js/ui.js
(function () {
  const $ = (s) => document.querySelector(s);

  // ---------- helpers ----------
  const poleKey = (p) => `${p.job_name}::${p.tag}::${p.SCID}`;

  function buildPermitIndex(permits) {
    const map = new Map();
    for (const r of (permits || [])) {
      const key = `${r.job_name}::${r.tag}::${r.SCID}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => String(a.permit_id).localeCompare(String(b.permit_id)));
    }
    return map;
  }

  function statusChipHTML(status) {
    const s = String(status || '').trim();
    let cls = 'na_other';
    let extra = '';
    if (s === 'Submitted - Pending') cls = 'pending';
    else if (s === 'Approved') cls = 'approved';
    else if (s === 'Created - NOT Submitted') cls = 'created';
    else if (s === 'Not Approved - Cannot Attach') cls = 'na_cannot';
    else if (s.startsWith('Not Approved -')) cls = 'na_other';
    else if (s === 'NONE') { cls = ''; extra = 'style="background:#94a3b8;color:#0b0c10"'; }
    return `<span class="chip ${cls}" ${extra}>${s || '—'}</span>`;
  }

  function ensureJobFilterOptions(poles) {
    const sel = $('#fJob');
    if (!sel) return;
    const prev = sel.value;
    const jobs = Array.from(new Set((poles || []).map(p => p.job_name))).sort();
    sel.innerHTML = `<option>All</option>` + jobs.map(j => `<option>${j}</option>`).join('');
    if (jobs.includes(prev)) sel.value = prev;
  }

  // ---------- LEFT LIST RENDER ----------
  function renderList() {
    const st = window.STATE || {};
    const poles = st.poles || [];
    const permits = st.permits || [];
    const byKey = buildPermitIndex(permits);

    const util   = $('#fUtility')?.value || 'All';
    const job    = $('#fJob')?.value || 'All';
    const status = $('#fStatus')?.value || 'All';
    const q      = ($('#fSearch')?.value || '').toLowerCase().trim();

    const listEl = $('#list');
    if (!listEl) return;
    listEl.innerHTML = '';

    // filter poles (not permits)
    const filteredPoles = poles.filter(p => {
      if (util !== 'All' && p.owner !== util) return false;
      if (job  !== 'All' && p.job_name !== job) return false;

      const key = poleKey(p);
      const rel = byKey.get(key) || [];

      if (status !== 'All') {
        if (status === 'NONE') {
          if (rel.length !== 0) return false;           // only poles with NO permits
        } else {
          if (!rel.some(r => r.permit_status === status)) return false; // needs at least one match
        }
      }

      if (q) {
        const hay = `${p.job_name} ${p.tag} ${p.SCID} ${p.owner} ${p.mr_level}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    // KPIs on left are updated by app.js; we don't change them here

    for (const p of filteredPoles) {
      const key = poleKey(p);
      const rel = byKey.get(key) || [];
      const showRel = status === 'All'
        ? rel
        : (status === 'NONE' ? [] : rel.filter(r => r.permit_status === status));

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
            showRel.length
              ? showRel.map(r => `
                  <div class="small" style="margin:4px 0;">
                    <code>${r.permit_id}</code>
                    ${statusChipHTML(r.permit_status)}
                    ${r.submitted_by ? ` · by ${r.submitted_by}` : ''}
                    ${r.submitted_at ? ` · ${r.submitted_at}` : ''}
                    <button class="btn" style="margin-left:8px" onclick="window.UI_editPermit('${key}','${encodeURIComponent(r.permit_id)}')">Edit</button>
                  </div>
                `).join('')
              : (
                  rel.length === 0
                    ? `<div class="small" style="margin:6px 0;">
                         ${statusChipHTML('NONE')}
                         <button class="btn" style="margin-left:8px" onclick="window.UI_editPermit('${key}','__new')">New permit for this pole</button>
                       </div>`
                    : `<div class="small muted" style="margin:6px 0;"><em>No permits match this status for this pole.</em></div>`
                )
          }
        </div>
      `;
      listEl.appendChild(card);
    }
  }

  // ---------- RIGHT PANE (read-only pole + permit editor) ----------
  function fillPoleDetails(p) {
    $('#pole_job')?.setAttribute('value', p.job_name || '');
    $('#pole_owner')?.setAttribute('value', p.owner || '');
    $('#pole_tag')?.setAttribute('value', p.tag || '');
    $('#pole_scid')?.setAttribute('value', p.SCID || '');
    $('#pole_spec')?.setAttribute('value', p.pole_spec || '');
    $('#pole_prop')?.setAttribute('value', p.proposed_spec || '');
    $('#pole_lat')?.setAttribute('value', (p.lat ?? '').toString());
    $('#pole_lon')?.setAttribute('value', (p.lon ?? '').toString());
    $('#pole_mr')?.setAttribute('value', p.mr_level || '');

    // keep a hidden selection for other modules (watch.js) to read
    window.UI_CURRENT_POLE_KEY = poleKey(p);
  }

  function fillPermitEditorFor(key, permitId) {
    const st = window.STATE || {};
    const [job_name, tag, SCID] = key.split('::');
    const byKey = buildPermitIndex(st.permits || []);
    const rel = byKey.get(key) || [];

    // Populate dropdown
    const sel = $('#selPermit');
    if (!sel) return;
    const options = [`<option value="__new">— New —</option>`]
      .concat(rel.map(r => `<option value="${encodeURIComponent(r.permit_id)}">${r.permit_id}</option>`));
    sel.innerHTML = options.join('');
    sel.value = permitId || '__new';

    if (permitId && permitId !== '__new') {
      const id = decodeURIComponent(permitId);
      const r = rel.find(x => String(x.permit_id) === id);
      if (r) {
        $('#permit_id').value = r.permit_id || '';
        $('#permit_status').value = r.permit_status || 'Created - NOT Submitted';
        $('#submitted_by').value = r.submitted_by || '';

        // Normalize MM/DD/YYYY -> yyyy-mm-dd for <input type="date">
        const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(r.submitted_at || '');
        $('#submitted_at').value = m ? `${m[3]}-${m[1]}-${m[2]}` : (r.submitted_at || '');

        $('#permit_notes').value = r.notes || '';
      }
    } else {
      // New defaults
      $('#permit_id').value = `PERM-${job_name}-${tag}-${SCID}`;
      $('#permit_status').value = 'Created - NOT Submitted';
      $('#submitted_by').value = '';
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      $('#submitted_at').value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
      $('#permit_notes').value = '';
    }

    // Make current selection available to other modules (save/delete in watch.js)
    window.UI_CURRENT_PERMIT_ID = sel.value === '__new' ? '__new' : decodeURIComponent(sel.value);
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

  // Expose for left-list "Edit" button
  window.UI_editPermit = function (key, permitId) {
    selectPoleByKey(key);
    fillPermitEditorFor(key, permitId || '__new');
    $('#permit_id')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Allow other modules to read the current permit form content
  window.UI_collectPermitForm = function () {
    const key = window.UI_CURRENT_POLE_KEY || '';
    const [job_name, tag, SCID] = key.split('::');
    return {
      job_name, tag, SCID,
      permit_id: ($('#permit_id')?.value || '').trim(),
      permit_status: ($('#permit_status')?.value || '').trim(),
      submitted_by: ($('#submitted_by')?.value || '').trim(),
      // convert yyyy-mm-dd -> MM/DD/YYYY for backend
      submitted_at: (function(){
        const s = $('#submitted_at')?.value || '';
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        return m ? `${m[2]}/${m[3]}/${m[1]}` : s;
      })(),
      notes: ($('#permit_notes')?.value || '').trim()
    };
  };

  // If user switches selected permit in the dropdown
  function wirePermitSelector() {
    const sel = $('#selPermit');
    if (!sel) return;
    sel.addEventListener('change', () => {
      const key = window.UI_CURRENT_POLE_KEY;
      if (!key) return;
      const val = sel.value;
      fillPermitEditorFor(key, val);
    });
  }

  function wireFilters() {
    $('#fUtility')?.addEventListener('change', renderList);
    $('#fJob')?.addEventListener('change', renderList);
    $('#fStatus')?.addEventListener('change', renderList);
    $('#fSearch')?.addEventListener('input', renderList);
  }

  // React to data loads from app.js
  window.addEventListener('data:loaded', () => {
    const st = window.STATE || {};
    ensureJobFilterOptions(st.poles || []);
    renderList();
  });

  document.addEventListener('DOMContentLoaded', () => {
    wireFilters();
    wirePermitSelector();
  });
})();
