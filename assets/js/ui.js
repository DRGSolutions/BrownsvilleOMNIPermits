// assets/js/ui.js
(function () {
  const CFG = window.APP_CONFIG || {};
  const $ = (sel) => document.querySelector(sel);

  const STATUS_CLASS = (s) => {
    if (!s) return '';
    const t = s.toLowerCase();
    if (t.startsWith('submitted')) return 'pending';            // orange
    if (t === 'approved') return 'approved';                    // green
    if (t.startsWith('created')) return 'created';              // yellow
    if (t.includes('cannot attach')) return 'na_cannot';        // purple
    if (t.startsWith('not approved')) return 'na_other';        // red
    return '';
  };

  const UI = { selectedPoleKey: null, selectedPermitId: null };
  window.UI = UI;

  const keyOf = (p) => `${p.job_name}::${p.tag}::${p.SCID}`;

  function populateJobs() {
    const sel = $('#fJob');
    const seen = new Set();
    (window.STATE.poles || []).forEach(p => seen.add(p.job_name));
    const cur = sel.value;
    sel.innerHTML = `<option>All</option>` + [...seen].sort().map(j => `<option>${j}</option>`).join('');
    if (cur && (cur === 'All' || seen.has(cur))) sel.value = cur;
  }

  function renderList() {
    const listEl = $('#list');
    const util = $('#fUtility').value || 'All';
    const job  = $('#fJob').value || 'All';
    const q    = ($('#fSearch').value || '').trim().toLowerCase();

    const byPole = new Map();
    for (const r of (window.STATE.permits || [])) {
      const k = `${r.job_name}::${r.tag}::${r.SCID}`;
      if (!byPole.has(k)) byPole.set(k, []);
      byPole.get(k).push(r);
    }
    for (const arr of byPole.values()) arr.sort((a,b)=>String(a.permit_id).localeCompare(String(b.permit_id)));

    const poles = (window.STATE.poles || []).filter(p=>{
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

    populateJobs();

    listEl.innerHTML = '';
    for (const p of poles) {
      const k = keyOf(p);
      const permits = byPole.get(k) || [];

      const wrap = document.createElement('div');
      wrap.className = 'pole';
      wrap.innerHTML = `
        <div class="title">${p.job_name} / ${p.tag} / ${p.SCID} <span class="muted small">— ${p.owner}</span></div>
        <div class="small muted">
          <b>Tag:</b> ${p.tag} · <b>SCID:</b> ${p.SCID} ·
          Spec: ${p.pole_spec||'—'} → ${p.proposed_spec||'—'} ·
          Coords: ${p.lat ?? '—'}, ${p.lon ?? '—'} · MR: ${p.mr_level||'—'}
        </div>
        <div class="spacer"></div>
        ${permits.length ? `<div class="small muted" style="margin-bottom:4px">Permits:</div>` : `<div class="small muted"><em>No permits</em></div>`}
        ${permits.length ? `
          <ul style="margin:0 0 6px 1rem;padding:0">
            ${permits.map(r=>{
              const notes = r.notes ? String(r.notes).replace(/\s+/g,' ').slice(0,120) + (r.notes.length>120?'…':'') : '';
              return `
                <li class="small" style="margin:4px 0">
                  <code>${r.permit_id}</code>
                  <span class="chip ${STATUS_CLASS(r.permit_status)}">${r.permit_status||''}</span>
                  ${r.submitted_by ? ` · by ${r.submitted_by}` : ''}
                  ${r.submitted_at ? ` · ${r.submitted_at}` : ''}
                  ${notes ? ` · <span class="muted" title="${r.notes.replace(/"/g,'&quot;')}">notes: ${notes}</span>` : ''}
                  <button class="btn btn-ghost" data-edit="${r.permit_id}" data-key="${k}" style="margin-left:8px;padding:4px 8px;font-size:12px">Edit</button>
                </li>`;
            }).join('')}
          </ul>` : ''}
        <button class="btn" data-newpermit="${k}" style="padding:6px 10px;font-size:12px">New permit for this pole</button>
      `;
      listEl.appendChild(wrap);
    }

    listEl.querySelectorAll('button[data-edit]').forEach(btn=>{
      btn.addEventListener('click',()=> {
        selectPoleByKey(btn.getAttribute('data-key'));
        selectPermitById(btn.getAttribute('data-edit'));
      });
    });
    listEl.querySelectorAll('button[data-newpermit]').forEach(btn=>{
      btn.addEventListener('click',()=> {
        selectPoleByKey(btn.getAttribute('data-newpermit'));
        beginNewPermitForSelectedPole();
      });
    });
  }
  window.renderList = renderList;

  function selectPoleByKey(key) {
    UI.selectedPoleKey = key;
    const [job, tag, scid] = key.split('::');
    const pole = (window.STATE.poles || []).find(p => p.job_name===job && String(p.tag)===String(tag) && String(p.SCID)===String(scid));
    if (!pole) return;

    $('#pole_job').value  = pole.job_name || '';
    $('#pole_owner').value= pole.owner || '';
    $('#pole_tag').value  = pole.tag || '';
    $('#pole_scid').value = pole.SCID || '';
    $('#pole_spec').value = pole.pole_spec || '';
    $('#pole_prop').value = pole.proposed_spec || '';
    $('#pole_lat').value  = pole.lat ?? '';
    $('#pole_lon').value  = pole.lon ?? '';
    $('#pole_mr').value   = pole.mr_level || '';

    const sel = $('#selPermit');
    sel.innerHTML = `<option value="__new">— New —</option>`;
    const permits = (window.STATE.permits || []).filter(r => r.job_name===pole.job_name && String(r.tag)===String(pole.tag) && String(r.SCID)===String(pole.SCID));
    for (const r of permits) {
      const opt = document.createElement('option');
      opt.value = r.permit_id;
      opt.textContent = `${r.permit_id} — ${r.permit_status||''}`;
      sel.appendChild(opt);
    }
    sel.value = '__new';
    clearPermitForm();
  }

  function clearPermitForm() {
    $('#permit_id').value = '';
    $('#permit_status').value = 'Created - NOT Submitted';
    $('#submitted_by').value = '';
    $('#submitted_at').value = '';
    $('#permit_notes').value = '';
    UI.selectedPermitId = null;
    $('#msgPermit').textContent = '';
  }

  function beginNewPermitForSelectedPole(){ $('#selPermit').value='__new'; clearPermitForm(); }

  function selectPermitById(id) {
    const r = (window.STATE.permits || []).find(x => String(x.permit_id) === String(id));
    if (!r) return;
    $('#selPermit').value     = r.permit_id;
    $('#permit_id').value     = r.permit_id;
    $('#permit_status').value = r.permit_status || 'Created - NOT Submitted';
    $('#submitted_by').value  = r.submitted_by || '';
    if (r.submitted_at && /^\d{2}\/\d{2}\/\d{4}$/.test(r.submitted_at)) {
      const [mm,dd,yy] = r.submitted_at.split('/');
      $('#submitted_at').value = `${yy}-${mm}-${dd}`;
    } else { $('#submitted_at').value = ''; }
    $('#permit_notes').value  = r.notes || '';
    UI.selectedPermitId       = r.permit_id;
  }

  $('#selPermit').addEventListener('change',(e)=>{ e.target.value==='__new'?beginNewPermitForSelectedPole():selectPermitById(e.target.value); });
  $('#fUtility').addEventListener('change', renderList);
  $('#fJob').addEventListener('change', renderList);
  $('#fSearch').addEventListener('input', renderList);

  async function callApi(change, reason) {
    const res = await fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Permits-Key': CFG.SHARED_KEY },
      body: JSON.stringify({ actorName: 'Website User', reason, change })
    });
    const data = await res.json().catch(()=>({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function normalizeDateToMDY(inputValue) {
    let s = (inputValue || '').trim();
    if (!s) return null;
    // from <input type="date"> YYYY-MM-DD → MM/DD/YYYY
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y,m,d] = s.split('-'); return `${m}/${d}/${y}`;
    }
    // already MM/DD/YYYY
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
    return null; // invalid
  }

  // --- Save permit (DATE REQUIRED) ---
  $('#btnSavePermit').addEventListener('click', async () => {
    const btn = $('#btnSavePermit'); const btnDel = $('#btnDeletePermit'); const msg = $('#msgPermit');
    try {
      btn.disabled = true; btnDel.disabled = true; msg.textContent = 'Submitting…';

      if (!UI.selectedPoleKey) { msg.textContent = 'Select a pole first.'; return; }
      const [job_name, tag, SCID] = UI.selectedPoleKey.split('::');

      const isExisting = $('#selPermit').value !== '__new';
      let permit_id = isExisting ? $('#selPermit').value : ($('#permit_id').value||'').trim();
      if (!permit_id) { msg.textContent='Permit ID is required for new permits.'; return; }

      const permit_status = $('#permit_status').value;
      const submitted_by  = ($('#submitted_by').value||'').trim();
      if (!submitted_by){ msg.textContent='Submitted By is required.'; return; }

      const rawDate = $('#submitted_at').value;
      const submitted_at = normalizeDateToMDY(rawDate);
      if (!submitted_at) { msg.textContent='A valid "Submitted At" date is required (MM/DD/YYYY).'; return; }

      const notes = $('#permit_notes').value || '';

      const payload = {
        type:'upsert_permit',
        permit:{ permit_id, job_name, tag, SCID, permit_status, submitted_by, submitted_at, notes }
      };

      const data = await callApi(payload, `Edit permit ${permit_id}`);
      msg.innerHTML = `PR opened. <a class="link" href="${data.pr_url}" target="_blank" rel="noopener">View PR</a>`;
      // Start on-demand 2s watcher + progress banner
      window.watchForRepoUpdate && window.watchForRepoUpdate(data.pr_url);

    } catch (e) {
      msg.textContent = e.message;
    } finally {
      btn.disabled = false; btnDel.disabled = false;
    }
  });

  // --- Delete permit ---
  $('#btnDeletePermit').addEventListener('click', async () => {
    const btn = $('#btnDeletePermit'); const btnSave = $('#btnSavePermit'); const msg = $('#msgPermit');
    try {
      btn.disabled = true; btnSave.disabled = true; msg.textContent = 'Deleting…';
      const id = $('#selPermit').value;
      if (!id || id==='__new'){ msg.textContent='Select an existing permit to delete.'; return; }

      const data = await callApi({ type:'delete_permit', permit_id:id }, `Delete permit ${id}`);
      msg.innerHTML = `PR opened. <a class="link" href="${data.pr_url}" target="_blank" rel="noopener">View PR</a>`;
      window.watchForRepoUpdate && window.watchForRepoUpdate(data.pr_url);

    } catch (e) {
      msg.textContent = e.message;
    } finally {
      btn.disabled = false; btnSave.disabled = false;
    }
  });

  window.addEventListener('data:loaded', renderList);
})();
