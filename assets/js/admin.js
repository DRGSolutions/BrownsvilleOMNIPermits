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
    const status = ($('#aStatus')?.value || 'All'); // optional status filter
    return { util, job, status };
  }

  function buildRows() {
    const st = window.STATE || {};
    const poles = st.poles || [];
    const permits = st.permits || [];

    const { util, job, status } = filters();

    // index poles by composite key
    const pmap = new Map();
    for (const p of poles) pmap.set(`${p.job_name}::${p.tag}::${p.SCID}`, p);

    const rows = [];
    for (const r of permits) {
      const key = `${r.job_name}::${r.tag}::${r.SCID}`;
      const p = pmap.get(key) || {};

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
    const el = $('#msgExport');
    if (el) el.textContent = t || '';
  }

  function onExport(ev) {
    if (ev) ev.preventDefault(); // in case the button is inside a <form>
    const st = window.STATE || {};
    if (!st.poles || !st.permits) { setMsg('Data not loaded yet.'); return; }

    const rows = buildRows();
    if (!rows.length) { setMsg('Nothing to export with current filters.'); return; }

    downloadCsv(rows);
    setMsg(`Exported ${rows.length} rows.`);
  }

  function enableAndWireButtons() {
    const btns = Array.from(document.querySelectorAll('#btnExportCsv, #btnExport, [data-action="export"]'));
    btns.forEach((btn) => {
      // ensure it's clickable even if inside a form
      if (btn.tagName === 'BUTTON' && (!btn.type || btn.type.toLowerCase() === 'submit')) {
        btn.type = 'button';
      }
      btn.disabled = false;
      btn.removeEventListener('click', onExport);
      btn.addEventListener('click', onExport);
    });
  }

  // Initial wiring and whenever data finishes loading
  ready(enableAndWireButtons);
  window.addEventListener('data:loaded', () => { setMsg(''); enableAndWireButtons(); });
})();
