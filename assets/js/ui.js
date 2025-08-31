// assets/js/ui.js
(function () {
  const CFG = window.APP_CONFIG || {};
  const $ = (sel) => document.querySelector(sel);
  const listEl = $('#list');

  // Map permit_status => chip CSS class
  const STATUS_CLASS = (s) => {
    if (!s) return '';
    const t = s.toLowerCase();
    if (t.startsWith('submitted')) return 'pending';
    if (t === 'approved') return 'approved';
    if (t.startsWith('created')) return 'created';
    if (t.includes('cannot attach')) return 'na_cannot';
    if (t.startsWith('not approved')) return 'na_other';
    return '';
  };

  // Simple helpers
  const keyOf = (p) => `${p.job_name}::${p.tag}::${p.SCID}`;

  // Remember which pole/permit is selected for editor
  const UI = { selectedPoleKey: null, selectedPermitId: null };
  window.UI = UI;

  // ----- Populate job filter from data
  function populateJobs() {
    const sel = $('#fJob');
    const seen = new Set();
    (window.STATE.poles || []).forEach(p => seen.add(p.job_name));
    const cur = sel.value;
    sel.innerHTML = `<option>All</option>` + [...seen].sort().map(j => `<option>${j}</option>`).join('');
    if ([...seen, 'All'].includes(cur)) sel.value = cur;
  }

  // ----- Render the left list of poles + permits
  function renderList() {
    if (!listEl) return;

    const util = $('#fUtility').value || 'All';
    const job  = $('#fJob').value || 'All';
    const q    = ($('#fSearch').value || '').trim().toLowerCase();

    // Build lookup of permits by pole key
    const byPole = new Map();
    for (const r of (window.STATE.permits || [])) {
      const k = `${r.job_name}::${r.tag}::${r.SCID}`;
      if (!byPole.has(k)) byPole.set(k, []);
      byPole.get(k).push(r);
    }
    for (const arr of byPole.values()) arr.sort((a,b)=>String(a.permit_id).localeCompare(String(b.permit_id)));

    // Filter poles
    const poles = (window.STATE.poles || []).filter(p => {
      if (util !== 'All' && p.owner !== util) return false;
      if (job !== 'All' && p.job_name !== job) return false;
      if (q) {
        const hay = `${p.job_name} ${p.tag} ${p.SCID}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a,b)=>
      String(a.job_name).localeCompare(String(b.job_name)) ||
      String(a.tag).localeCompare(String(b.tag)) ||
      String(a.SCID).localeCompare(String(b.SCID))
    );

    // Paint
    listEl.innerHTML = '';
    for (const p of poles) {
      const k = keyOf(p);
      const permits = byPole.get(k) || [];
      const wrap = document.createElement('div');
      wrap.className = 'pole';
      wrap.innerHTML = `
        <div class="title">
          ${p.job_name} / ${p.tag} / ${p.SCID}
          <span class="muted small">— ${p.owner}</span>
        </div>
        <div class="small muted">Spec: ${p.pole_spec||'—'} → ${p.proposed_spec||'—'} · Coords: ${p.lat ?? '—'}, ${p.lon ?? '—'} · MR: ${p.mr_level||'—'}</div>
        <div class="spacer"></div>
        ${permits.length ? `<div class="small muted" style="margin-bottom:4px">Permits:</div>` : `<div class="small muted"><em>No permits</em></div>`}
        ${permits.length ? `
          <ul style="margin:0 0 6px 1rem;padding:0">
            ${permits.map(r => `
              <li class="small" style="margin:4px 0">
                <code>${r.permit_id}</code>
                <span class="chip ${STATUS_CLASS(r.permit_status)}">${r.permit_status}</span>
                ${r.submitted_by ? ` · by ${r.submitted_by}` : ''}
                ${r.submitted_at ? ` · ${r.submitted_at}` : ''}
                <button class="btn btn-ghost" data-edit="${r.permit_id}" data-key="${k}" style="margin-left:8px;padding:4px 8px;font-size:12px">Edit</button>
              </li>`).join('')}
          </ul>` : ''}
        <button class="btn" data-newpermit="${k}" style="padding:6px 10px;font-size:12px">New permit for this pole</button>
      `;
      listEl.appendChild(wrap);
    }

    // Wire edit/new buttons
    listEl.querySelectorAll('button[data-edit]').forEach(btn=>{
      btn.addEventListener('click',()=> {
        const permitId = btn.getAttribute('data-edit');
        const key = btn.getAttribute('data-key');
        selectPoleByKey(key);
        selectPermitById(permitId);
      });
    });
    listEl.querySelectorAll('button[data-newpermit]').forEach(btn=>{
      btn.addEventListener('click',()=> {
        const key = btn.getAttribute('data-newpermit');
        selectPoleByKey(key);
        beginNewPermitForSelectedPole();
      });
    });

    // Keep job filter in sync with data
    populateJobs();
  }
  window.renderList = renderList;

  // ----- Selecting a pole fills the read-only Pole Details and the permit dropdown
  function selectPoleByKey(key) {
    UI.selectedPoleKey = key;
    const [job, tag, scid] = key.split('::');
    const pole = (window.STATE.poles || []).find(p => p.job_name===job && String(p.tag)===String(tag) && String(p.SCID)===String(scid));
    if (!pole) return;

    // Fill details
    $('#pole_job').value  = pole.job_name || '';
    $('#pole_owner').value= pole.owner || '';
    $('#pole_tag').value  = pole.tag || '';
    $('#pole_scid').value = pole.SCID || '';
    $('#pole_spec').value = pole.pole_spec || '';
    $('#pole_prop').value = pole.proposed_spec || '';
    $('#pole_lat').value  = pole.lat ?? '';
    $('#pole_lon').value  = pole.lon ?? '';
    $('#pole_mr').value   = pole.mr_level || '';

    // Fill permit selector
    const sel = $('#selPermit');
    sel.innerHTML = `<option value="__new">— New —</option>`;
    const permits = (window.STATE.permits || []).filter(r => r.job_name===pole.job_name && String(r.tag)===String(pole.tag) && String(r.SCID)===String(pole.SCID));
    for (const r of permits) {
      const opt = document.createElement('option');
      opt.value = r.permit_id;
      opt.textContent = `${r.permit_id} — ${r.permit_status}`;
      sel.appendChild(opt);
    }
    sel.value = '__new';
    // Clear form fields
    $('#permit_id').value = '';
    $('#permit_status').value = 'Created - NOT Submitted';
    $('#submitted_by').value = '';
    $('#submitted_at').value = '';
    $('#permit_notes').value = '';
    UI.selectedPermitId = null;
  }

  function beginNewPermitForSelectedPole() {
    $('#selPermit').value = '__new';
    $('#permit_id').value = '';
    $('#permit_status').value = 'Created - NOT Submitted';
    $('#submitted_by').value = '';
    $('#submitted_at').value = '';
    $('#permit_notes').value = '';
    UI.selectedPermitId = null;
    $('#msgPermit').textContent = 'Creating a new permit for the selected pole…';
  }

  function selectPermitById(id) {
    const r = (window.STATE.permits || []).find(x => String(x.permit_id) === String(id));
    if (!r) return;
    $('#selPermit').value   = r.permit_id;
    $('#permit_id').value   = r.permit_id;
    $('#permit_status').value = r.permit_status || 'Created - NOT Submitted';
    $('#submitted_by').value  = r.submitted_by || '';
    // convert MM/DD/YYYY -> YYYY-MM-DD for input[type=date]
    if (r.submitted_at && /^\d{2}\/\d{2}\/\d{4}$/.test(r.submitted_at)) {
      const [mm,dd,yy] = r.submitted_at.split('/');
      $('#submitted_at').value = `${yy}-${mm}-${dd}`;
    } else {
      $('#submitted_at').value = '';
    }
    $('#permit_notes').value  = r.notes || '';
    UI.selectedPermitId = r.permit_id;
  }

  // When the user changes the permit dropdown
  $('#selPermit').addEventListener('change', (e) => {
    if (e.target.value === '__new') {
      beginNewPermitForSelectedPole();
    } else {
      selectPermitById(e.target.value);
    }
  });

  // Filters -> re-render
  $('#fUtility').addEventListener('change', renderList);
  $('#fJob').addEventListener('change', renderList);
  $('#fSearch').addEventListener('input', renderList);

  // Save permit
  $('#btnSavePermit').addEventListener('click', async () => {
    try {
      const msg = $('#msgPermit');
      msg.textContent = 'Submitting…';

      if (!UI.selectedPoleKey) { msg.textContent = 'Select a pole first.'; return; }
      const [job_name, tag, SCID] = UI.selectedPoleKey.split('::');

      // If existing selected in dropdown, we will upsert with same id; otherwise require a new id
      let permit_id = $('#selPermit').value !== '__new' ? $('#selPermit').value : ($('#permit_id').value || '').trim();
      if (!permit_id) { msg.textContent = 'Permit ID is required for new permits.'; return; }

      const status = $('#permit_status').value;
      const submitted_by = ($('#submitted_by').value || '').trim();
      if (!submitted_by) { msg.textContent = 'Submitted By is required.'; return; }

      // normalize date to MM/DD/YYYY
      let submitted_at = $('#submitted_at').value; // YYYY-MM-DD from input
      if (submitted_at && /^\d{4}-\d{2}-\d{2}$/.test(submitted_at)) {
        const [y,m,d] = submitted_at.split('-'); submitted_at = `${m}/${d}/${y}`;
      }
      const notes = $('#permit_notes').value || '';

      const payload = {
        actorName: 'Website User',
        reason: `Edit permit ${permit_id}`,
        change: {
          type: 'upsert_permit',
          permit: { permit_id, job_name, tag, SCID, permit_status: status, submitted_by, submitted_at, notes }
        }
      };

      const res = await fetch(CFG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'X-Permits-Key': CFG.SHARED_KEY },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(()=>({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

      msg.innerHTML = `PR opened. <a class="link" href="${data.pr_url}" target="_blank" rel="noopener">View PR</a>`;
      // Soft refresh now; watcher will keep us up to date afterwards
      window.loadData();
    } catch (e) {
      $('#msgPermit').textContent = e.message;
    }
  });

  // Delete permit (requires backend support for delete_permit)
  $('#btnDeletePermit').addEventListener('click', async () => {
    try {
      const msg = $('#msgPermit');
      msg.textContent = 'Deleting…';
      const id = $('#selPermit').value;
      if (!id || id === '__new') { msg.textContent = 'Select an existing permit to delete.'; return; }

      const payload = {
        actorName: 'Website User',
        reason: `Delete permit ${id}`,
        change: { type: 'delete_permit', permit_id: id }
      };

      const res = await fetch(CFG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'X-Permits-Key': CFG.SHARED_KEY },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(()=>({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

      msg.innerHTML = `PR opened. <a class="link" href="${data.pr_url}" target="_blank" rel="noopener">View PR</a>`;
      window.loadData();
    } catch (e) {
      $('#msgPermit').textContent = e.message;
    }
  });

  // Re-render list whenever fresh data arrives
  window.addEventListener('data:loaded', renderList);
})();
