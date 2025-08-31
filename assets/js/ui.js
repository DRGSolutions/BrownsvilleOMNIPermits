// assets/js/ui.js
import { loadData, startWatcher, getState } from './data.js';
import { PERMIT_STATUSES } from './config.js';

// ---- helpers
const $ = (s) => document.querySelector(s);
function text(el, v){ if (el) el.textContent = v; }
function html(el, v){ if (el) el.innerHTML = v; }

// ---- status chip styles (yellow is clearly yellow)
function statusStyles(status) {
  let fg = '#a3a3a3', bg = '#262626';
  switch (status) {
    case 'Created - NOT Submitted': fg = '#fde047'; bg = '#3a3000'; break;           // bright yellow
    case 'Submitted - Pending':    fg = '#fb923c'; bg = '#331c00'; break;            // orange
    case 'Approved':               fg = '#22c55e'; bg = '#0f2a19'; break;            // green
    case 'Not Approved - Cannot Attach': fg = '#a855f7'; bg = '#1f1030'; break;     // purple
    case 'Not Approved - PLA Issues':
    case 'Not Approved - MRE Issues':
    case 'Not Approved - Other Issues': fg = '#ef4444'; bg = '#2a0f12'; break;       // red
    case 'NONE': fg = '#9ca3af'; bg = '#1f2937'; break;
  }
  return { fg, bg, bd: `${fg}33` };
}
function chip(s){
  const c = statusStyles(s);
  return `<span class="status" style="color:${c.fg};background:${c.bg};border:1px solid ${c.bd}">${s}</span>`;
}

// ---- render counts + list
function renderCounts(st){
  text($('#kPoles'), st.poles.length);
  text($('#kPermits'), st.permits.length);
  text($('#kLoaded'), st.lastLoadedAt ? st.lastLoadedAt.toLocaleString() : '—');
  text($('#kCommit'), st.sha ? st.sha.slice(0,7) : '—');
}

function applyFilters(poles) {
  const util = $('#filterUtility').value || '';
  const job  = $('#filterJob').value || '';
  const q    = ($('#filterSearch').value || '').trim().toLowerCase();
  return poles.filter(p => {
    if (util && p.owner !== util) return false;
    if (job && p.job_name !== job) return false;
    if (q && !(String(p.tag).toLowerCase().includes(q) || String(p.SCID).toLowerCase().includes(q))) return false;
    return true;
  });
}

function buildJobs(st){
  const sel = $('#filterJob');
  const util = $('#filterUtility').value || '';
  const jobs = new Set(st.poles.filter(p => !util || p.owner===util).map(p => p.job_name));
  const cur  = sel.value;
  sel.innerHTML = `<option value="">All</option>` + [...jobs].sort().map(j=>`<option>${j}</option>`).join('');
  if ([...jobs].includes(cur)) sel.value = cur;
}

function renderList(st){
  const list = $('#list');
  const poles = applyFilters(st.poles);

  // Preindex permits by composite key
  const permByKey = {};
  for (const r of st.permits) {
    const k = `${r.job_name}::${r.tag}::${r.SCID}`;
    (permByKey[k] ||= []).push(r);
  }

  list.innerHTML = poles.map(p => {
    const key = `${p.job_name}::${p.tag}::${p.SCID}`;
    const prs = (permByKey[key] || []).sort((a,b)=>a.permit_id.localeCompare(b.permit_id));
    return `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <div class="title">${p.job_name} / ${p.tag} / ${p.SCID} <span class="muted small">— ${p.owner}</span></div>
            <div class="small muted">
              Spec: ${p.pole_spec||'—'} → ${p.proposed_spec||'—'} · Coords: ${p.lat ?? '—'}, ${p.lon ?? '—'} · MR: ${p.mr_level||'—'}
            </div>
          </div>
          <button class="btn btn-ghost" data-edit="${key}">Edit</button>
        </div>
        <div class="spacer"></div>
        <div class="small muted">Permits:</div>
        ${
          prs.length
            ? `<ul style="margin:.4rem 0 .2rem 1rem;">${
                prs.map(r=>`<li class="small"><code>${r.permit_id}</code> ${chip(r.permit_status||'NONE')} ${r.submitted_by?`· by ${r.submitted_by}`:''} ${r.submitted_at?`· ${r.submitted_at}`:''} ${r.notes?`· <span class="muted">${r.notes}</span>`:''}</li>`).join('')
              }</ul>`
            : `<div class="small muted"><em>No permits</em></div>`
        }
      </div>`;
  }).join('');

  // hook edit buttons
  list.querySelectorAll('button[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => loadPoleIntoEditor(btn.dataset.edit));
  });
}

function fillPermitStatusOptions(){
  const sel = $('#pe_status');
  sel.innerHTML = PERMIT_STATUSES.map(s => `<option>${s}</option>`).join('');
}

// ---- editor binding
function loadPoleIntoEditor(key){
  const st = getState();
  const [job, tag, scid] = key.split('::');

  const p = st.poles.find(x => x.job_name===job && x.tag===tag && x.SCID===scid);
  if (!p) return;

  // Fill read-only pole details
  $('#pd_job').value = p.job_name;
  $('#pd_owner').value = p.owner || '';
  $('#pd_tag').value = p.tag || '';
  $('#pd_scid').value = p.SCID || '';
  $('#pd_polespec').value = p.pole_spec || '';
  $('#pd_propspec').value = p.proposed_spec || '';
  $('#pd_lat').value = (p.lat ?? '').toString();
  $('#pd_lon').value = (p.lon ?? '').toString();
  $('#pd_mr').value = p.mr_level || '';

  // Build permits list for this pole
  const sel = $('#pe_existing');
  const prs = st.permits.filter(r => r.job_name===job && r.tag===tag && r.SCID===scid)
                        .sort((a,b)=>a.permit_id.localeCompare(b.permit_id));
  sel.innerHTML = `<option value="__new">— New —</option>` + prs.map(r => `<option value="${r.permit_id}">${r.permit_id}</option>`).join('');
  sel.value = prs.length ? prs[0].permit_id : '__new';
  loadPermitIntoFields(sel.value, job, tag, scid);

  sel.onchange = () => loadPermitIntoFields(sel.value, job, tag, scid);
}

function loadPermitIntoFields(selVal, job, tag, scid){
  const st = getState();
  if (selVal === '__new'){
    $('#pe_id').value = `PERM-${job}-${tag}-${scid}`;
    $('#pe_status').value = 'Submitted - Pending'; // default
    $('#pe_by').value = '';
    $('#pe_date').valueAsDate = new Date();
    $('#pe_notes').value = '';
    return;
  }
  const r = st.permits.find(x => x.permit_id===selVal);
  if (!r) return;
  $('#pe_id').value = r.permit_id || '';
  $('#pe_status').value = r.permit_status || 'NONE';
  $('#pe_by').value = r.submitted_by || '';
  // convert MM/DD/YYYY to yyyy-mm-dd if possible
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(r.submitted_at || '');
  $('#pe_date').value = m ? `${m[3]}-${m[1]}-${m[2]}` : '';
  $('#pe_notes').value = r.notes || '';
}

// ---- wiring filters
function wireFilters(){
  $('#filterUtility').addEventListener('change', () => {
    buildJobs(getState());
    renderList(getState());
  });
  $('#filterJob').addEventListener('change', () => renderList(getState()));
  $('#filterSearch').addEventListener('input', () => renderList(getState()));
}

// ---- init
async function initialLoad(){
  html($('#status'),'Loading…');
  try {
    await loadData();
    fillPermitStatusOptions();
    buildJobs(getState());
    renderCounts(getState());
    renderList(getState());
    html($('#status'), '<span class="ok">Loaded.</span>');
    setTimeout(() => html($('#status'), ''), 1200);
  } catch (e) {
    html($('#status'), `<span class="err">${e.message}</span>`);
  }
}

export async function initUI(){
  await initialLoad();
  wireFilters();

  startWatcher((st) => {
    buildJobs(st);
    renderCounts(st);
    renderList(st);
    const s = $('#status');
    if (s) { s.innerHTML = '<span class="ok">Updated from repo.</span>'; setTimeout(()=>s.textContent='', 1200); }
  });
}

// auto-boot (in case app.js is missing)
if (!window.__APP_UI_BOOT__) {
  window.__APP_UI_BOOT__ = true;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initUI().catch(console.error));
  } else {
    initUI().catch(console.error);
  }
}
