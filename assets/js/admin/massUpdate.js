// assets/js/admin/massUpdate.js
import { state, polesFor, getPermitsForPole } from '../state.js';
import { callApi } from '../api.js';

export function initMassUpdate(hooks){
  const selU = document.getElementById('selUtility');
  const selJ = document.getElementById('selJob');

  const statusEl = document.getElementById('mass_status');
  const byEl     = document.getElementById('mass_submitted_by');
  const atEl     = document.getElementById('mass_submitted_at');
  const notesEl  = document.getElementById('mass_notes');
  const btn      = document.getElementById('btnMassCreate');
  const msg      = document.getElementById('msgMass');

  if (!atEl.value) atEl.valueAsDate = new Date();

  async function onClick(){
    msg.textContent = '';
    const util = selU.value || '';
    const job  = selJ.value || '';
    if (!job) { msg.textContent = 'Select a Job (left filters)'; return; }

    // Block if any permit exists for the job (frontend pre-check; backend re-enforces)
    const poles = polesFor(util, job);
    const any = poles.some(p => getPermitsForPole(p).length > 0);
    if (any) { msg.textContent = 'This job already has permits. Mass create allowed only when none exist.'; return; }

    const t = {
      permit_status: statusEl.value || 'Created - NOT Submitted',
      submitted_by:  (byEl.value || '').trim(),
      submitted_at:  atEl.value,
      notes:         notesEl.value || ''
    };
    if (!t.submitted_by) { msg.textContent = 'Template "Submitted By" is required.'; return; }

    try {
      const data = await callApi({ type:'bulk_upsert_permits_for_job', job_name: job, template: t });
      msg.innerHTML = `<span class="chip chip-ok">Queued</span> · <a class="link" target="_blank" rel="noopener" href="${data.pr_url}">View PR</a>`;
    } catch (err) {
      msg.innerHTML = `<span class="chip" style="color:#ff9a9a;border-color:#5a2a2a">Error: ${err.message}</span>`;
    }
  }

  btn.addEventListener('click', onClick);
}
