// assets/js/ui.js
import { PERMIT_STATUSES_UI, STATUS_NONE, STATUS_FOR_API } from './config.js';
import * as S from './state.js';
import * as API from './api.js';

const $ = (id) => document.getElementById(id);

/* Filters + KPIs + List */
const selUtility  = $('selUtility');
const selJobName  = $('selJobName');
const inpTagScid  = $('inpTagScid');
const kPoles      = $('kPoles');
const kPermits    = $('kPermits');
const kLoaded     = $('kLoaded');
const kCommit     = $('kCommit');
const list        = $('list');
const statusBox   = $('status');

/* Pole details (read-only) */
const pdJobName = $('pdJobName');
const pdOwner   = $('pdOwner');
const pdTag     = $('pdTag');
const pdSCID    = $('pdSCID');
const pdPoleSpec= $('pdPoleSpec');
const pdProposedSpec= $('pdProposedSpec');
const pdLat     = $('pdLat');
const pdLon     = $('pdLon');
const pdMrLevel = $('pdMrLevel');

/* Permit editor */
const permitPicker = $('permitPicker');
const permitId     = $('permitId');
const permitStatus = $('permitStatus');
const permitBy     = $('permitBy');
const permitAt     = $('permitAt');
const permitNotes  = $('permitNotes');
const btnSavePermit= $('btnSavePermit');
const msgPermit    = $('msgPermit');

/* Admin */
const exportStatus     = $('exportStatus');
const exportIncludeNone= $('exportIncludeNone');
const btnExportCsv     = $('btnExportCsv');
const msgExport        = $('msgExport');

const bulkStatus = $('bulkStatus');
const bulkBy     = $('bulkBy');
const bulkAt     = $('bulkAt');
const bulkNotes  = $('bulkNotes');
const btnBulk    = $('btnBulkCreate');
const msgBulk    = $('msgBulk');
const bulkHint   = $('bulkHint');

function fmt(n){ return new Intl.NumberFormat().format(n); }
function todayISO(){ return new Date().toISOString().slice(0,10); }

function badgeClass(status) {
  if (!status) return 'status';
  if (status === 'Submitted - Pending') return 'status badge-pending';
  if (status === 'Approved') return 'status badge-approved';
  if (status === 'Created - NOT Submitted') return 'status badge-created';
  if (status === 'Not Approved - Cannot Attach') return 'status badge-na-cannot';
  if (status.startsWith('Not Approved')) return 'status badge-na-other';
  if (status === 'NONE') return 'status badge-none';
  return 'status';
}

function matchPermitToPole(pole, r){
  return r.job_name === pole.job_name && r.tag === pole.tag && r.SCID === pole.SCID;
}

/* ---------- Filters ---------- */
function populateFilters(){
  const { poles } = S.get();
  // Utilities
  const utils = [...new Set(poles.map(p=>p.owner))].sort();
  selUtility.innerHTML = `<option value="">All Utilities</option>` + utils.map(u=>`<option>${u}</option>`).join('');

  // Jobs depend on utility
  const jobs = [...new Set(poles
    .filter(p => !selUtility.value || p.owner === selUtility.value)
    .map(p=>p.job_name))].sort();
  selJobName.innerHTML = `<option value="">All Jobs</option>` + jobs.map(j=>`<option>${j}</option>`).join('');
}

function populateStatusPickers(){
  // Editor & bulk (no NONE)
  permitStatus.innerHTML = STATUS_FOR_API.map(s=>`<option>${s}</option>`).join('');
  bulkStatus.innerHTML   = STATUS_FOR_API.map(s=>`<option>${s}</option>`).join('');
  // Export (include NONE + All)
  exportStatus.innerHTML = `<option value="">All</option>` +
    [STATUS_NONE, ...STATUS_FOR_API].map(s=>`<option>${s}</option>`).join('');
}

/* ---------- List ---------- */
function filteredPoles(){
  const { poles } = S.get();
  const util = selUtility.value || '';
  const job  = selJobName.value || '';
  const q    = (inpTagScid.value || '').trim().toLowerCase();

  return poles.filter(p=>{
    if (util && p.owner !== util) return false;
    if (job && p.job_name !== job) return false;
    if (q && !(String(p.tag).toLowerCase().includes(q) || String(p.SCID).toLowerCase().includes(q))) return false;
    return true;
  });
}

function renderList(){
  const { permits } = S.get();
  const poles = filteredPoles();

  list.innerHTML = '';
  if (!poles.length){
    list.innerHTML = `<div class="muted small">No poles found for current filters.</div>`;
    return;
  }

  for (const p of poles){
    const rel = permits.filter(r => matchPermitToPole(p, r));
    const chip = rel.length ? '' : `<span class="${badgeClass('NONE')}" style="margin-left:6px;">NONE</span>`;

    const li = document.createElement('div');
    li.className = 'card';
    li.innerHTML = `
      <div class="flex" style="justify-content:space-between;align-items:flex-start;">
        <div>
          <div class="title">${p.job_name} · <span class="muted small">Owner: ${p.owner}</span> ${chip}</div>
          <div class="small muted">Tag: <b>${p.tag}</b> · SCID: <b>${p.SCID}</b></div>
          <div class="small muted">Pole Spec: ${p.pole_spec || '—'} · Proposed: ${p.proposed_spec || '—'}</div>
          <div class="small muted">Coords: ${p.lat ?? '—'}, ${p.lon ?? '—'} · MR: ${p.mr_level || '—'}</div>
        </div>
        <button class="btn btn-ghost">Select</button>
      </div>
      <div class="spacer"></div>
      <div class="small muted">Permits:</div>
      ${
        rel.length ? `
          <ul style="margin:.4rem 0 .2rem 1rem;">
            ${rel.map(r=>`
              <li class="small">
                <code>${r.permit_id}</code>
                <span class="${badgeClass(r.permit_status)}">${r.permit_status}</span>
                ${r.submitted_by ? ` · by ${r.submitted_by}` : ''}
                ${r.submitted_at ? ` · ${r.submitted_at}` : ''}
              </li>
            `).join('')}
          </ul>
        ` : `<div class="small muted"><em>No permits (status NONE)</em></div>`
      }
    `;
    li.querySelector('button').addEventListener('click', ()=> selectPole(p));
    list.appendChild(li);
  }
}

/* ---------- Pole select & permit picker ---------- */
function selectPole(p){
  S.set({ currentPole: p });

  // details (read-only)
  pdJobName.value = p.job_name || '';
  pdOwner.value   = p.owner || '';
  pdTag.value     = p.tag || '';
  pdSCID.value    = p.SCID || '';
  pdPoleSpec.value= p.pole_spec || '';
  pdProposedSpec.value= p.proposed_spec || '';
  pdLat.value     = (p.lat ?? '').toString();
  pdLon.value     = (p.lon ?? '').toString();
  pdMrLevel.value = p.mr_level || '';

  // permits list
  const { permits } = S.get();
  const rel = permits.filter(r => matchPermitToPole(p, r));
  permitPicker.innerHTML = `<option value="">— New —</option>` + rel.map(r=>`<option value="${r.permit_id}">${r.permit_id}</option>`).join('');

  permitId.value = `PERM-${p.job_name}-${p.tag}-${p.SCID}`;
  permitStatus.value = 'Created - NOT Submitted';
  permitBy.value = '';
  permitAt.value = todayISO();
  permitNotes.value = '';
  msgPermit.textContent = '';

  updateBulkAvailability();
}

/* ---------- Save single permit ---------- */
async function onSavePermit(){
  const p = S.get().currentPole;
  if (!p){ msgPermit.textContent = 'Select a pole first.'; return; }

  const selId = permitPicker.value || permitId.value.trim();
  if (!selId){ msgPermit.textContent = 'Permit ID is required for new permits.'; return; }
  if (!permitBy.value.trim()){ msgPermit.textContent = 'Submitted By is required.'; return; }

  const payload = {
    actorName: 'Website User',
    reason: `Permit ${selId}`,
    change: {
      type: 'upsert_permit',
      permit: {
        permit_id: selId,
        job_name: p.job_name,
        tag: p.tag,
        SCID: p.SCID,
        permit_status: permitStatus.value,
        submitted_by: permitBy.value.trim(),
        submitted_at: permitAt.value, // server normalizes to MM/DD/YYYY
        notes: permitNotes.value.trim()
      }
    }
  };

  msgPermit.textContent = 'Submitting…';
  try{
    const res = await API.callApi(payload);
    msgPermit.innerHTML = `<span class="ok">PR opened.</span> <a class="link" target="_blank" rel="noopener" href="${res.pr_url}">View PR</a>`;
  }catch(e){
    msgPermit.innerHTML = `<span class="err">${e.message}</span>`;
  }
}

/* ---------- Export CSV ---------- */
function rowsForExport(){
  const util = selUtility.value || '';
  const job  = selJobName.value || '';
  const st   = exportStatus.value || '';
  const { poles, permits } = S.get();

  const pPoles = poles.filter(p=>{
    if (util && p.owner !== util) return false;
    if (job && p.job_name !== job) return false;
    return true;
  });

  const rows = [];

  for (const r of permits){
    const pole = pPoles.find(p => matchPermitToPole(p, r));
    if (!pole) continue;
    if (st && r.permit_status !== st) continue;
    rows.push({
      Utility: pole.owner,
      Job: pole.job_name,
      Tag: pole.tag,
      SCID: pole.SCID,
      PermitID: r.permit_id,
      Status: r.permit_status,
      SubmittedBy: r.submitted_by || '',
      SubmittedAt: r.submitted_at || '',
      Notes: r.notes || ''
    });
  }

  if (exportIncludeNone.checked){
    for (const p of pPoles){
      const has = permits.some(r => matchPermitToPole(p, r));
      if (!has){
        if (!st || st === 'NONE'){
          rows.push({
            Utility: p.owner,
            Job: p.job_name,
            Tag: p.tag,
            SCID: p.SCID,
            PermitID: '',
            Status: 'NONE',
            SubmittedBy: '',
            SubmittedAt: '',
            Notes: ''
          });
        }
      }
    }
  }
  return rows;
}

function makeCSV(rows){
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = (s)=>`"${String(s??'').replace(/"/g,'""')}"`;
  const lines = [headers.join(',')];
  for (const r of rows){
    lines.push(headers.map(h=>esc(r[h])).join(','));
  }
  return lines.join('\r\n');
}
function download(filename, text){
  const blob = new Blob([text], {type:'text/csv;charset=utf-8;'});
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function onExportCsv(){
  msgExport.textContent = '';
  const rows = rowsForExport();
  if (!rows.length){ msgExport.textContent = 'No rows to export for current filters.'; return; }
  const util = selUtility.value || 'ALL';
  const job  = selJobName.value || 'ALL';
  const st   = exportStatus.value || 'ALL';
  const name = `permits_${util}_${job}_${st}_${Date.now()}.csv`.replace(/\s+/g,'');
  download(name, makeCSV(rows));
  msgExport.textContent = `Exported ${rows.length} rows.`;
}

/* ---------- Bulk create ---------- */
function jobHasAnyPermits(jobName){
  const { permits } = S.get();
  return permits.some(r => r.job_name === jobName);
}
function updateBulkAvailability(){
  const job = selJobName.value || '';
  if (!job){
    bulkHint.textContent = 'Pick a Job Name to check eligibility.';
    btnBulk.disabled = true;
    return;
  }
  const ok = !jobHasAnyPermits(job);
  btnBulk.disabled = !ok;
  bulkHint.textContent = ok
    ? 'Eligible: no existing permits under this Job.'
    : 'Disabled: this Job already has one or more permits.';
}
async function onBulkCreate(){
  msgBulk.textContent = '';
  const job = selJobName.value || '';
  const util = selUtility.value || '';
  if (!job){ msgBulk.textContent = 'Choose a Job Name first.'; return; }
  if (jobHasAnyPermits(job)){ msgBulk.textContent = 'This job already has permits. Bulk create is disabled.'; return; }
  if (!bulkBy.value.trim()){ msgBulk.textContent = 'Submitted By is required.'; return; }

  const { poles, permits } = S.get();
  const jobPoles = poles.filter(p => p.job_name === job && (!util || p.owner === util));
  const anyHas = jobPoles.some(p => permits.some(r => matchPermitToPole(p, r)));
  if (anyHas){ msgBulk.textContent = 'Detected existing permits; aborting.'; return; }

  const created = [];
  btnBulk.disabled = true;
  try{
    for (const p of jobPoles){
      const id = `PERM-${p.job_name}-${p.tag}-${p.SCID}`;
      const payload = {
        actorName: 'Website User',
        reason: `Bulk create for ${p.job_name}`,
        change: {
          type: 'upsert_permit',
          permit: {
            permit_id: id,
            job_name: p.job_name,
            tag: p.tag,
            SCID: p.SCID,
            permit_status: bulkStatus.value,
            submitted_by: bulkBy.value.trim(),
            submitted_at: bulkAt.value || todayISO(),
            notes: bulkNotes.value.trim()
          }
        }
      };
      const res = await API.callApi(payload);
      created.push(res.pr_url);
    }
    msgBulk.innerHTML = `Opened ${created.length} PRs.`;
  }catch(e){
    msgBulk.innerHTML = `<span class="err">${e.message}</span>`;
  }finally{
    btnBulk.disabled = false;
  }
}

/* ---------- Init ---------- */
export async function initUI(){
  try{
    // defaults
    permitAt.value = todayISO();
    bulkAt.value   = todayISO();

    populateStatusPickers();

    // events
    selUtility.addEventListener('change', ()=>{
      populateFilters();
      renderList();
      updateBulkAvailability();
    });
    selJobName.addEventListener('change', ()=>{
      renderList();
      updateBulkAvailability();
    });
    inpTagScid.addEventListener('input', renderList);

    permitPicker.addEventListener('change', ()=>{
      const id = permitPicker.value;
      const { currentPole } = S.get();
      if (!currentPole || !id) return;
      const r = S.get().permits.find(x => x.permit_id === id);
      if (!r) return;
      permitId.value = r.permit_id;
      permitStatus.value = r.permit_status;
      permitBy.value = r.submitted_by || '';
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(r.submitted_at || '');
      permitAt.value = m ? `${m[3]}-${m[1]}-${m[2]}` : todayISO();
      permitNotes.value = r.notes || '';
    });

    btnSavePermit.addEventListener('click', onSavePermit);
    btnExportCsv.addEventListener('click', onExportCsv);
    btnBulk.addEventListener('click', onBulkCreate);

    // load data
    await S.refreshFromGitHub(statusBox);

    // populate UI
    populateFilters();
    renderList();

    const { poles, permits, sha } = S.get();
    kPoles.textContent   = fmt(poles.length);
    kPermits.textContent = fmt(permits.length);
    kLoaded.textContent  = new Date().toLocaleString();
    kCommit.textContent  = sha ? sha.slice(0,7) : '—';
  }catch(e){
    console.error(e);
    statusBox.innerHTML = `<span class="err">${e.message}</span>`;
  }
}
