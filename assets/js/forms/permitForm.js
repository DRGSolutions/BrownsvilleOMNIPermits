// assets/js/forms/permitForm.js
import { PERMIT_STATUSES } from '../config.js';
import { state, getPermitsForPole } from '../state.js';
import { callApi } from '../api.js';
import { trackPendingChange } from '../pending.js';

let form, msg, sel, summary, inputs;
let currentPole = null;
let currentEdited = null; // original permit object if editing

export function initPermitForm(hooks){
  form = document.getElementById('formPermit');
  msg  = document.getElementById('msgPermit');
  sel  = document.getElementById('permit_select');
  summary = document.getElementById('selPoleSummary');

  inputs = {
    id: document.getElementById('permit_id'),
    status: document.getElementById('permit_status'),
    by: document.getElementById('submitted_by'),
    at: document.getElementById('submitted_at'),
    notes: document.getElementById('notes')
  };

  // default status & date
  if (!inputs.status.value) inputs.status.value = 'Created - NOT Submitted';
  if (!inputs.at.value) inputs.at.valueAsDate = new Date();

  sel.addEventListener('change', onSelectChange);
  form.addEventListener('submit', onSubmit);

  // expose helpers to listView
  hooks.setSelectedPole = setSelectedPole;
  hooks.refreshPermitSelectForPole = refreshSelect;
}

export function startNewPermitForPole(pole){
  setSelectedPole(pole);
  sel.value = ''; // new
  currentEdited = null;
  inputs.id.value = '';
  inputs.id.disabled = false;
  inputs.status.value = 'Created - NOT Submitted';
  inputs.by.value = '';
  inputs.at.valueAsDate = new Date();
  inputs.notes.value = '';
  msg.textContent = '';
  form.scrollIntoView({ behavior:'smooth', block:'start' });
}
export function editPermitForPole(pole, permitId){
  setSelectedPole(pole);
  sel.value = permitId;
  fillFromPermit(permitId);
  form.scrollIntoView({ behavior:'smooth', block:'start' });
}
export function refreshPermitSelectForPole(pole){
  setSelectedPole(pole, true);
}

function setSelectedPole(pole, silent=false){
  currentPole = pole ? { job_name:pole.job_name, tag:pole.tag, SCID:pole.SCID } : null;
  if (!silent) {
    summary.textContent = currentPole
      ? `Selected Pole — ${currentPole.job_name} · Tag ${currentPole.tag} · SCID ${currentPole.SCID}`
      : 'No pole selected.';
  }
  refreshSelect();
}

function refreshSelect(){
  sel.innerHTML = `<option value="">— New —</option>`;
  if (!currentPole) return;
  const list = getPermitsForPole(currentPole);
  for (const r of list) {
    const o = document.createElement('option');
    o.value = r.permit_id; o.textContent = `${r.permit_id} (${r.permit_status})`;
    sel.appendChild(o);
  }
}

function onSelectChange(){
  const id = sel.value;
  if (!id) {
    currentEdited = null;
    inputs.id.value = '';
    inputs.id.disabled = false;
    inputs.status.value = 'Created - NOT Submitted';
    inputs.by.value = '';
    inputs.at.valueAsDate = new Date();
    inputs.notes.value = '';
    msg.textContent = '';
  } else {
    fillFromPermit(id);
  }
}

function mdyToInputDate(mdy) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(mdy||'');
  if (!m) return '';
  return `${m[3]}-${m[1]}-${m[2]}`;
}

function fillFromPermit(permitId){
  const r = state.permits.find(x => String(x.permit_id) === String(permitId));
  if (!r) return;
  currentEdited = r;
  inputs.id.value = r.permit_id;
  inputs.id.disabled = true;
  inputs.status.value = r.permit_status;
  inputs.by.value = r.submitted_by || '';
  inputs.at.value = mdyToInputDate(r.submitted_at);
  inputs.notes.value = r.notes || '';
  msg.textContent = '';
}

async function onSubmit(e){
  e.preventDefault();
  if (!currentPole) { msg.textContent = 'Select a pole first.'; return; }

  const permit_id = inputs.id.value.trim();
  const permit_status = inputs.status.value;
  const submitted_by = inputs.by.value.trim();
  const submitted_at = inputs.at.value; // yyyy-mm-dd (backend normalizes)
  const notes = inputs.notes.value.trim();

  if (!permit_id) { msg.textContent = 'Permit ID is required.'; return; }
  if (!submitted_by) { msg.textContent = 'Submitted By is required.'; return; }

  try {
    let data, expected;
    if (currentEdited && currentEdited.permit_id === permit_id) {
      // UPDATE existing
      const patch = {};
      if (permit_status && permit_status !== currentEdited.permit_status) patch.permit_status = permit_status;
      if (submitted_by && submitted_by !== currentEdited.submitted_by)   patch.submitted_by = submitted_by;
      if (submitted_at) patch.submitted_at = submitted_at;
      if (notes !== (currentEdited.notes || '')) patch.notes = notes || '';
      // If nothing changed, still allow (no-op PR isn’t useful) — require at least one field:
      if (Object.keys(patch).length === 0) throw new Error('No changes to save.');
      data = await callApi({ type:'update_permit', permit_id, patch });
      expected = { ...patch };
    } else {
      // UPSERT new
      const permit = {
        permit_id,
        job_name: currentPole.job_name,
        tag:      currentPole.tag,
        SCID:     currentPole.SCID,
        permit_status,
        submitted_by,
        submitted_at,
        notes
      };
      data = await callApi({ type:'upsert_permit', permit });
      expected = { permit_status, submitted_by }; // enough to detect application
    }

    msg.innerHTML = `<span class="chip chip-ok">Saved</span> · <a class="link" target="_blank" rel="noopener" href="${data.pr_url}">View PR</a>`;
    // Track pending
    trackPendingChange('permit', permit_id, currentPole, expected, data.pr_url);
  } catch (err) {
    msg.innerHTML = `<span class="chip" style="color:#ff9a9a;border-color:#5a2a2a">Error: ${err.message}</span>`;
  }
}

// Re-export helpers for listView
export { startNewPermitForPole, editPermitForPole };
