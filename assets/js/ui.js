// assets/js/ui.js
import { UTILITIES, PERMIT_STATUSES } from './config.js';
import { state, jobsForUtility, polesFor, getPermitsForPole, getPermitById } from './state.js';
import { callApi } from './api.js';
import { fmt } from './utils.js';

/* ---------- DOM refs (robust: tolerate missing elements) ---------- */
const $ = (id) => document.getElementById(id);

// Filters / status
const elUtil    = $('selUtility');
const elJob     = $('selJobName');
const elSearch  = $('inpTagScid');
const elStatus  = $('status');        // text "Loading…"
const elKPoles  = $('kPoles');
const elKPerms  = $('kPermits');
const elKLoaded = $('kLoaded');
const elKCommit = $('kCommit');
const elList    = $('list');

// Pole form
const elPoleMode   = $('poleMode');
const elPoleOwner  = $('poleOwner');
const elPoleJob    = $('poleJobName');
const elPoleTag    = $('poleTag');
const elPoleSCID   = $('poleSCID');
const elPoleSpec   = $('poleSpec');
const elPoleProp   = $('proposedSpec');
const elPoleLat    = $('poleLat');
const elPoleLon    = $('poleLon');
const elPoleMR     = $('mrLevel');
const elSavePole   = $('btnSavePole');
const elMsgPole    = $('msgPole');

// Permit form
const elPermitPicker = $('permitPicker');       // select of existing permits OR "— New —"
const elPermitId     = $('permitId');
const elPermitStatus = $('permitStatus');
const elPermitBy     = $('permitBy');
const elPermitAt     = $('permitAt');
const elPermitNotes  = $('permitNotes');
const elSavePermit   = $('btnSavePermit');
const elMsgPermit    = $('msgPermit');

// Reload button (if you kept one)
const elReloadBtn = $('btnReload');

/* ---------- helpers ---------- */
export function showStatus(text, isErr=false) {
  if (!elStatus) return;
  elStatus.innerHTML = isErr ? `<span style="color:#ef4444">${text}</span>` : text;
}

function fillSelect(sel, values, { placeholder, value, map=String } = {}) {
  if (!sel) return;
  sel.innerHTML = '';
  if (placeholder) {
    const opt = document.createElement('option');
    opt.value = ''; opt.textContent = placeholder;
    sel.appendChild(opt);
  }
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = map(v);
    if (value != null && String(value) === String(v)) opt.selected = true;
    sel.appendChild(opt);
  }
}

function poleKey(p) { return `${p.job_name} / ${p.tag} / ${p.SCID}`; }

/* ---------- list rendering ---------- */
function renderCounts(sha) {
  if (elKPoles)  elKPoles.textContent  = fmt(state.poles.length);
  if (elKPerms)  elKPerms.textContent  = fmt(state.permits.length);
  if (elKLoaded) elKLoaded.textContent = new Date().toLocaleString();
  if (elKCommit) elKCommit.textContent = sha ? sha.slice(0,7) : '—';
}

function renderList() {
  if (!elList) return;

  const util = elUtil?.value || '';
  const job  = elJob?.value || '';
  const q    = (elSearch?.value || '').trim().toLowerCase();

  const poles = polesFor(util, job).filter(p => {
    if (!q) return true;
    return (
      String(p.tag).toLowerCase().includes(q) ||
      String(p.SCID).toLowerCase().includes(q)
    );
  });

  elList.innerHTML = '';
  for (const p of poles) {
    const permits = getPermitsForPole(p);
    const permitsHTML = permits.length
      ? `<ul style="margin:.4rem 0 .2rem 1rem;">
          ${permits.map(r => `
            <li class="small">
              <code>${r.permit_id}</code>
              <span class="status">${r.permit_status}</span>
              · by ${r.submitted_by}
              · ${r.submitted_at}
            </li>`).join('')}
        </ul>`
      : `<div class="small muted"><em>Status: NONE (no permits)</em></div>`;

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="flex" style="justify-content:space-between;align-items:flex-start;">
        <div>
          <div class="title">${poleKey(p)}</div>
          <div class="small muted">
            Owner: ${p.owner} · Spec: ${p.pole_spec || '—'} → ${p.proposed_spec || '—'}
          </div>
          <div class="small muted">Coords: ${p.lat ?? '—'}, ${p.lon ?? '—'}</div>
          <div class="small muted">MR Level: ${p.mr_level || '—'}</div>
        </div>
        <button class="btn btn-ghost" data-edit="${p.job_name}|${p.tag}|${p.SCID}">Edit</button>
      </div>
      <div class="spacer"></div>
      <div class="small muted">Permits:</div>
      ${permitsHTML}
    `;
    elList.appendChild(card);
  }

  // wire edit buttons
  elList.querySelectorAll('button[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [job, tag, scid] = btn.dataset.edit.split('|');
      prefillPole(job, tag, scid);
      prefillPermits(job, tag, scid);
      document.getElementById('poleEditorTop')?.scrollIntoView({ behavior:'smooth', block:'start' });
    });
  });
}

/* ---------- filters ---------- */
function refreshJobs() {
  const util = elUtil?.value || '';
  fillSelect(elJob, jobsForUtility(util), { placeholder:'All Jobs' });
  renderList();
}

/* ---------- prefill editors ---------- */
function prefillPole(job, tag, scid) {
  const p = state.poles.find(x =>
    String(x.job_name) === String(job) &&
    String(x.tag)      === String(tag) &&
    String(x.SCID)     === String(scid)
  );

  // mode: default Update if existing, Upsert if not
  if (elPoleMode)  elPoleMode.value = p ? 'update' : 'upsert';
  if (elPoleOwner) elPoleOwner.value = p?.owner || 'BPUB';
  if (elPoleJob)   elPoleJob.value   = job || p?.job_name || '';
  if (elPoleTag)   elPoleTag.value   = tag || p?.tag || '';
  if (elPoleSCID)  elPoleSCID.value  = scid || p?.SCID || '';
  if (elPoleSpec)  elPoleSpec.value  = p?.pole_spec || '';
  if (elPoleProp)  elPoleProp.value  = p?.proposed_spec || '';
  if (elPoleLat)   elPoleLat.value   = p?.lat ?? '';
  if (elPoleLon)   elPoleLon.value   = p?.lon ?? '';
  if (elPoleMR)    elPoleMR.value    = p?.mr_level || '';
}

function prefillPermits(job, tag, scid) {
  const rows = state.permits.filter(r =>
    String(r.job_name) === String(job) &&
    String(r.tag)      === String(tag) &&
    String(r.SCID)     === String(scid)
  );
  const vals = rows.map(r => r.permit_id);
  if (elPermitPicker) {
    elPermitPicker.innerHTML = '';
    const newOpt = document.createElement('option');
    newOpt.value = ''; newOpt.textContent = '— New —';
    elPermitPicker.appendChild(newOpt);
    for (const id of vals) {
      const opt = document.createElement('option');
      opt.value = id; opt.textContent = id;
      elPermitPicker.appendChild(opt);
    }
    elPermitPicker.dataset.job  = job;
    elPermitPicker.dataset.tag  = tag;
    elPermitPicker.dataset.scid = scid;
  }
  // default to blank/new
  setPermitFormForId('');
}

function setPermitFormForId(permitId) {
  const r = permitId ? getPermitById(permitId) : null;

  if (elPermitId)     elPermitId.value     = r?.permit_id || '';
  if (elPermitStatus) elPermitStatus.value = r?.permit_status || 'Created - NOT Submitted';
  if (elPermitBy)     elPermitBy.value     = r?.submitted_by || ''; // required
  if (elPermitNotes)  elPermitNotes.value  = r?.notes || '';

  // Convert "MM/DD/YYYY" to <input type=date> value YYYY-MM-DD
  if (elPermitAt) {
    if (r?.submitted_at && /^\d{2}\/\d{2}\/\d{4}$/.test(r.submitted_at)) {
      const [m,d,y] = r.submitted_at.split('/');
      elPermitAt.value = `${y}-${m}-${d}`;
    } else {
      const today = new Date();
      const ym = String(today.getMonth()+1).padStart(2,'0');
      const yd = String(today.getDate()).padStart(2,'0');
      elPermitAt.value = `${today.getFullYear()}-${ym}-${yd}`;
    }
  }
}

/* ---------- form submit handlers ---------- */
async function onSavePole() {
  if (!elMsgPole) return;
  elMsgPole.textContent = 'Submitting…';

  const mode = elPoleMode?.value || 'upsert';
  const payloadKeys = {
    job_name: elPoleJob?.value?.trim(),
    tag:      elPoleTag?.value?.trim(),
    SCID:     elPoleSCID?.value?.trim(),
  };

  // common fields (optional)
  const patch = {};
  if (elPoleOwner?.value) patch.owner = elPoleOwner.value;
  if (elPoleSpec?.value)  patch.pole_spec = elPoleSpec.value;
  if (elPoleProp?.value)  patch.proposed_spec = elPoleProp.value;
  if (elPoleLat?.value)   patch.lat = parseFloat(elPoleLat.value);
  if (elPoleLon?.value)   patch.lon = parseFloat(elPoleLon.value);
  if (elPoleMR?.value)    patch.mr_level = elPoleMR.value;

  try {
    let change;
    if (mode === 'update') {
      change = { type:'update_pole', keys: payloadKeys, patch };
    } else {
      const pole = { ...payloadKeys, ...patch };
      change = { type:'upsert_pole', pole };
    }
    const out = await callApi(change, { reason: 'Pole edit' });
    elMsgPole.innerHTML = `PR opened. <a class="link" target="_blank" rel="noopener" href="${out.pr_url}">View PR</a>`;
  } catch (e) {
    elMsgPole.innerHTML = `<span class="err">${e.message}</span>`;
  }
}

async function onSavePermit() {
  if (!elMsgPermit) return;
  elMsgPermit.textContent = 'Submitting…';

  const job  = elPermitPicker?.dataset.job  || elJob?.value || '';
  const tag  = elPermitPicker?.dataset.tag  || '';
  const scid = elPermitPicker?.dataset.scid || '';

  const pickedId = elPermitPicker?.value || '';
  const status = elPermitStatus?.value || 'Created - NOT Submitted';
  const subBy  = (elPermitBy?.value || '').trim(); // required
  const dateISO= elPermitAt?.value || '';          // YYYY-MM-DD from <input type=date>
  const notes  = elPermitNotes?.value || '';

  if (!subBy) {
    elMsgPermit.innerHTML = `<span class="err">"Submitted By" is required.</span>`;
    return;
  }

  // convert to MM/DD/YYYY expected by API validator
  let submitted_at = '';
  if (dateISO) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
    submitted_at = m ? `${m[2]}/${m[3]}/${m[1]}` : dateISO;
  }

  try {
    let change;
    if (!pickedId) {
      // new permit → must provide an id
      const id = (elPermitId?.value || '').trim();
      if (!id) throw new Error('Permit ID is required for new permits.');
      change = {
        type: 'upsert_permit',
        permit: {
          permit_id: id,
          job_name: job,
          tag, SCID: scid,
          permit_status: status,
          submitted_by: subBy,
          submitted_at,
          notes
        }
      };
    } else {
      // update existing
      const patch = {
        permit_status: status,
        submitted_by: subBy,
        submitted_at,
        notes
      };
      change = { type:'update_permit', permit_id: pickedId, patch };
    }

    const out = await callApi(change, { reason: 'Permit edit' });
    elMsgPermit.innerHTML = `PR opened. <a class="link" target="_blank" rel="noopener" href="${out.pr_url}">View PR</a>`;
  } catch (e) {
    elMsgPermit.innerHTML = `<span class="err">${e.message}</span>`;
  }
}

/* ---------- public init / post-load ---------- */
export function initUI({ onReload } = {}) {
  // filters
  if (elUtil) {
    fillSelect(elUtil, UTILITIES, { placeholder:'All Utilities' });
    elUtil.addEventListener('change', () => {
      refreshJobs();
      renderList();
    });
  }
  if (elJob) {
    elJob.addEventListener('change', renderList);
  }
  if (elSearch) {
    elSearch.addEventListener('input', renderList);
  }

  // form static options
  if (elPoleOwner) fillSelect(elPoleOwner, UTILITIES);
  if (elPoleMode)  fillSelect(elPoleMode, ['update', 'upsert'], { map:v => v === 'update' ? 'Update (must exist)' : 'Upsert (create if missing)' });

  if (elPermitStatus) fillSelect(elPermitStatus, PERMIT_STATUSES);
  if (elPermitPicker) elPermitPicker.addEventListener('change', () => setPermitFormForId(elPermitPicker.value));

  // save handlers
  elSavePole?.addEventListener('click', (e)=>{ e.preventDefault(); onSavePole(); });
  elSavePermit?.addEventListener('click', (e)=>{ e.preventDefault(); onSavePermit(); });

  // reload button if present
  elReloadBtn?.addEventListener('click', (e)=>{ e.preventDefault(); onReload?.(); });

  // prefills when user types core key fields in pole editor
  [elPoleJob, elPoleTag, elPoleSCID].forEach(inp => {
    inp?.addEventListener('blur', () => {
      const j = elPoleJob?.value, t = elPoleTag?.value, s = elPoleSCID?.value;
      if (j && t && s) { prefillPole(j,t,s); prefillPermits(j,t,s); }
    });
  });
}

export async function renderAfterLoad(sha) {
  renderCounts(sha);
  // set job list for selected util
  refreshJobs();
  renderList();
}
