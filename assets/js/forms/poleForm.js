// assets/js/forms/poleForm.js
import { UTILITIES } from '../config.js';
import { callApi } from '../api.js';
import { trackPendingChange } from '../pending.js';

let form, msg, ownerSel;

export function initPoleForm(hooks){
  form = document.getElementById('formPole');
  msg  = document.getElementById('msgPole');
  ownerSel = document.getElementById('pole_owner');

  form.addEventListener('change', maybeToggleUpdate);
  form.addEventListener('submit', onSubmit);

  // default owner
  if (ownerSel && !ownerSel.value) ownerSel.value = 'BPUB';
}

function maybeToggleUpdate(){
  const mode = form.mode.value;
  const keyFields = ['job_name','tag','SCID'];
  for (const k of keyFields) {
    const el = form.querySelector(`[name="${k}"]`);
    el.disabled = (mode === 'update'); // prevent key mutation in update
  }
}

export function prefillPoleForm(pole){
  // Set update mode and fill fields
  form.mode.value = 'update';
  for (const k of ['job_name','tag','SCID','owner','pole_spec','proposed_spec','lat','lon','mr_level']) {
    const el = form.querySelector(`[name="${k}"]`);
    if (!el) continue;
    const v = pole[k];
    el.value = (v === undefined || v === null) ? '' : String(v);
  }
  maybeToggleUpdate();
  document.getElementById('msgPole').textContent = '';
  form.scrollIntoView({ behavior:'smooth', block:'start' });
}

async function onSubmit(e){
  e.preventDefault();
  msg.textContent = 'Submitting…';

  const fd = new FormData(form);
  const mode = fd.get('mode');
  const keys = {
    job_name: (fd.get('job_name')||'').trim(),
    tag:      (fd.get('tag')||'').trim(),
    SCID:     (fd.get('SCID')||'').trim()
  };
  const body = {
    owner: (fd.get('owner')||'').trim() || undefined,
    pole_spec: (fd.get('pole_spec')||'').trim() || undefined,
    proposed_spec: (fd.get('proposed_spec')||'').trim() || undefined,
    lat: fd.get('lat') ? Number(fd.get('lat')) : undefined,
    lon: fd.get('lon') ? Number(fd.get('lon')) : undefined,
    mr_level: (fd.get('mr_level')||'').trim() || undefined
  };

  try {
    let data, expected;
    if (mode === 'upsert') {
      const pole = { ...keys, ...body };
      data = await callApi({ type:'upsert_pole', pole });
      expected = { ...body }; // fields we expect to see changed
    } else {
      const patch = {};
      for (const [k,v] of Object.entries(body)) if (v !== undefined && v !== '') patch[k] = v;
      if (Object.keys(patch).length === 0) throw new Error('Provide at least one field to update.');
      data = await callApi({ type:'update_pole', keys, patch });
      expected = { ...patch };
    }
    msg.innerHTML = `<span class="chip chip-ok">Saved</span> · <a class="link" target="_blank" rel="noopener" href="${data.pr_url}">View PR</a>`;
    const id = `${keys.job_name}/${keys.tag}/${keys.SCID}`;
    trackPendingChange('pole', id, keys, expected, data.pr_url);
  } catch (err) {
    msg.innerHTML = `<span class="chip" style="color:#ff9a9a;border-color:#5a2a2a">Error: ${err.message}</span>`;
  }
}
