// assets/js/admin/export.js
import { state, polesFor, getPermitsForPole } from '../state.js';
import { downloadCSV } from '../utils.js';
import { PERMIT_STATUSES } from '../config.js';

export function initExport(hooks){
  const selU = document.getElementById('adminUtility');
  const selJ = document.getElementById('adminJob');
  const selS = document.getElementById('adminStatus');
  const btnPoles = document.getElementById('btnExportPoles');
  const btnPerms = document.getElementById('btnExportPermits');

  function refreshJobs(){
    const util = selU.value || '';
    const jobs = new Set(
      state.poles.filter(p => !util || p.owner === util).map(p => p.job_name)
    );
    selJ.innerHTML = '';
    const opt0 = document.createElement('option'); opt0.value = ''; opt0.textContent = jobs.size ? 'All jobs' : '—';
    selJ.appendChild(opt0);
    for (const j of Array.from(jobs).sort()) {
      const o = document.createElement('option'); o.value = j; o.textContent = j;
      selJ.appendChild(o);
    }
  }

  selU.addEventListener('change', refreshJobs);

  btnPoles.addEventListener('click', ()=>{
    const util = selU.value || '';
    const job  = selJ.value || '';
    const poles = polesFor(util, job);
    const rows = [
      ['job_name','tag','SCID','owner','pole_spec','proposed_spec','lat','lon','mr_level'],
      ...poles.map(p => [p.job_name,p.tag,p.SCID,p.owner,p.pole_spec||'',p.proposed_spec||'',p.lat||'',p.lon||'',p.mr_level||''])
    ];
    downloadCSV(`poles-${util||'all'}-${job||'all'}.csv`, rows);
  });

  btnPerms.addEventListener('click', ()=>{
    const util = selU.value || '';
    const job  = selJ.value || '';
    const status = selS.value || '';
    const poles = polesFor(util, job);
    const rows = [['permit_id','job_name','tag','SCID','permit_status','submitted_by','submitted_at','notes']];
    for (const p of poles) {
      const perms = getPermitsForPole(p);
      if (perms.length === 0 && (!status || status === 'NONE')) {
        rows.push(['', p.job_name, p.tag, p.SCID, 'NONE', '', '', '']);
      } else {
        for (const r of perms) {
          if (status && r.permit_status !== status) continue;
          rows.push([r.permit_id, r.job_name, r.tag, r.SCID, r.permit_status, r.submitted_by||'', r.submitted_at||'', r.notes||'']);
        }
      }
    }
    downloadCSV(`permits-${util||'all'}-${job||'all'}-${status||'all'}.csv`, rows);
  });

  // initial
  refreshJobs();
}
