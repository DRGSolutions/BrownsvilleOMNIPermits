// assets/js/admin.js
(function () {
  const $ = (s) => document.querySelector(s);

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function csvEscape(v) {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function filters() {
    const util = ($('#fUtility')?.value || 'All');
    const job  = ($('#fJob')?.value || 'All');
    const status = ($('#fStatus')?.value || $('#aStatus')?.value || 'All'); // support either id
    return { util, job, status };
  }

  function buildPermitIndex(permits) {
    const map = new Map();
    for (const r of (permits || [])) {
      const key = `${r.job_name}::${r.tag}::${r.SCID}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return map;
  }

  // Build rows so EVERY POLE appears at least once (status NONE when no permits)
  function buildRows() {
    const st = window.STATE || {};
    const poles = st.poles || [];
    const permits = st.permits || [];
    const { util, job, status } = filters();
    const pmap = buildPermitIndex(permits);
    const rows = [];

    for (const p of poles) {
      if (util !== 'All' && p.owner !== util) continue;
      if (job  !== 'All' && p.job_name !== job) continue;

      const key = `${p.job_name}::${p.tag}::${p.SCID}`;
      const rel = pmap.get(key) || [];

      if (rel.length === 0) {
        if (status === 'All' || status === 'NONE') {
          rows.push({
            job_name: p.job_name,
            tag: p.tag,
            SCID: p.SCID,
            owner: p.owner || '',
            pole_spec: p.pole_spec || '',
            proposed_spec: p.proposed_spec || '',
            lat: p.lat ?? '',
            lon: p.lon ?? '',
            mr_level: p.mr_level || '',
            permit_id: '',
            permit_status: 'NONE',
            submitted_by: '',
            submitted_at: '',
            notes: ''
          });
        }
      } else {
        for (const r of rel) {
          if (status !== 'All' && status !== r.permit_status) continue;
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
            permit_id: r.permit_id || '',
            permit_status: r.permit_status || '',
            submitted_by: r.submitted_by || '',
            submitted_at: r.submitted_at || '',
            notes: r.notes || ''
          });
        }
      }
    }
    return rows;
  }

  function downloadCsv(rows) {
    const headers = [
      'job_name','tag','SCID','owner','pole_spec','proposed_spec','lat','lon','mr_level',
      'permit_id','permit_status','submitted_by','submitted_at','notes'
    ];
    const body = rows.map(r => headers.map(h => csvEscape(r[h])).join(',')).join('\n');
    const csv = '\uFEFF' + headers.join(',') + '\n' + body; // BOM for Excel
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    const ts = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    a.download = `permits_export_${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}.csv`;
    a.href = url;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  }

  function setMsg(t) {
    const el = $('#adminMsg'); // matches your index.html
    if (el) el.textContent = t || '';
  }

  function onExport(ev) {
    if (ev) ev.preventDefault(); // if button ever sits in a <form>
    const st = window.STATE || {};
    if (!st.poles || !st.permits) { setMsg('Data not loaded yet.'); return; }
    const rows = buildRows();
    if (!rows.length) { setMsg('Nothing to export with current filters.'); return; }
    downloadCsv(rows);
    setMsg(`Exported ${rows.length} rows.`);
  }

  function enableAndWireButtons() {
    const btn = $('#btnExportCsv');
    if (!btn) return;
    // force type=button so it never submits forms
    if (!btn.type || btn.type.toLowerCase() === 'submit') btn.type = 'button';
    btn.disabled = false;
    btn.removeEventListener('click', onExport);
    btn.addEventListener('click', onExport);
  }

  ready(enableAndWireButtons);
  window.addEventListener('data:loaded', () => { setMsg(''); enableAndWireButtons(); });
})();
