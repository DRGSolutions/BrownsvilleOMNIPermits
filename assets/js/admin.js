// assets/js/admin.js
(function(){
  const $ = (s)=>document.querySelector(s);

  function csvEscape(v){
    if (v == null) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
    return s;
  }

  function buildRows(){
    const util = ($('#fUtility')?.value || 'All');
    const job  = ($('#fJob')?.value || 'All');
    const statusSel = document.querySelector('#aStatus'); // optional
    const status = statusSel ? (statusSel.value || 'All') : 'All';

    // index poles by composite key
    const map = new Map();
    (window.STATE.poles || []).forEach(p=>{
      map.set(`${p.job_name}::${p.tag}::${p.SCID}`, p);
    });

    const rows = [];
    for (const r of (window.STATE.permits || [])) {
      const key = `${r.job_name}::${r.tag}::${r.SCID}`;
      const p = map.get(key) || {};
      if (util !== 'All' && p.owner !== util) continue;
      if (job  !== 'All' && r.job_name !== job) continue;
      if (status !== 'All' && r.permit_status !== status) continue;

      rows.push({
        job_name: r.job_name,
        tag: r.tag,
        SCID: r.SCID,
        owner: p.owner || '',
        pole_spec: p.pole_spec || '',
        proposed_spec: p.proposed_spec || '',
        lat: p.lat ?? '',
        lon: p.lon ?? '',
        mr_level: p.mr_level || '',

        permit_id: r.permit_id,
        permit_status: r.permit_status || '',
        submitted_by: r.submitted_by || '',
        submitted_at: r.submitted_at || '',
        notes: r.notes || ''
      });
    }
    return rows;
  }

  function downloadCsv(rows){
    const headers = [
      'job_name','tag','SCID','owner','pole_spec','proposed_spec','lat','lon','mr_level',
      'permit_id','permit_status','submitted_by','submitted_at','notes'
    ];
    const body = rows.map(r => headers.map(h => csvEscape(r[h])).join(',')).join('\n');
    const csv = '\uFEFF' + headers.join(',') + '\n' + body; // BOM for Excel
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date();
    const pad = (n)=>String(n).padStart(2,'0');
    const fname = `permits_export_${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}.csv`;
    a.href = url; a.download = fname; document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 100);
  }

  function onExport(){
    try{
      const rows = buildRows();
      if (!rows.length) {
        const n = document.querySelector('#msgExport');
        if (n) n.textContent = 'Nothing to export with current filters.';
        return;
      }
      downloadCsv(rows);
      const n = document.querySelector('#msgExport');
      if (n) n.textContent = `Exported ${rows.length} rows.`;
    }catch(e){
      const n = document.querySelector('#msgExport');
      if (n) n.textContent = e.message || 'Export failed';
    }
  }

  // Wire up both possible IDs, whichever exists in your HTML
  document.addEventListener('click', (e)=>{
    if (e.target?.id === 'btnExportCsv' || e.target?.id === 'btnExport') onExport();
  });

  // Refresh counts / enable button after data load
  window.addEventListener('data:loaded', ()=>{
    const btn = document.querySelector('#btnExportCsv, #btnExport');
    if (btn) btn.disabled = false;
    const n = document.querySelector('#msgExport'); if (n) n.textContent = '';
  });
})();
