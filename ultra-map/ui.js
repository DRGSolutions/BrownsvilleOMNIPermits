import { statusColorHex } from './data.js';

export function toast(msg){
  const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show');
  setTimeout(()=> t.classList.remove('show'), 1500);
}
export function wireUI({ onToggleBoundaries, onReportToggle }){
  document.getElementById('toggleBoundaries').addEventListener('change', e=> onToggleBoundaries(!!e.target.checked));
  document.getElementById('btnReportToggle').addEventListener('click', onReportToggle);
  document.getElementById('btnReportClose').addEventListener('click', onReportToggle);
}
export function chipClassFor(status){
  if (status==='Approved') return 'approved';
  if (status==='Submitted - Pending') return 'pending';
  if (status==='Created - NOT Submitted') return 'created';
  if (status==='Not Approved - Cannot Attach') return 'na_cannot';
  if (String(status||'').startsWith('Not Approved -')) return 'na_other';
  return 'none';
}
export function fillDetails(ctx){
  const d=document.getElementById('detailsBody');
  const p=ctx.pole, rel=ctx.permits||[], latest=ctx.latestStatus;
  d.innerHTML = `
    <div class="card">
      <div class="kv"><div class="muted small">Job</div><div><b>${p.job_name||'—'}</b></div></div>
      <div class="kv"><div class="muted small">Owner</div><div>${p.owner||'—'}</div></div>
      <div class="kv"><div class="muted small">SCID</div><div>${p.SCID||'—'}</div></div>
      <div class="kv"><div class="muted small">Tag</div><div>${p.tag||'—'}</div></div>
      <div class="kv"><div class="muted small">Spec</div><div>${p.pole_spec||'—'} → ${p.proposed_spec||'—'}</div></div>
      <div class="kv"><div class="muted small">MR</div><div>${p.mr_level||'—'}</div></div>
      <div class="kv"><div class="muted small">Coords</div><div>${p.lat}, ${p.lon}</div></div>
      <div class="kv"><div class="muted small">Latest</div><div><span class="badge ${chipClassFor(latest)}">${latest}</span></div></div>
    </div>
    <div class="muted small" style="margin:6px 0">Permits (${rel.length})</div>
    ${
      rel.length ? rel.map(r=>`
        <div class="card">
          <div class="kv"><div class="muted small">ID</div><div><code>${r.permit_id}</code></div></div>
          <div class="kv"><div class="muted small">Status</div><div><span class="badge ${chipClassFor(r.permit_status)}">${r.permit_status}</span></div></div>
          <div class="kv"><div class="muted small">By</div><div>${r.submitted_by||'—'}</div></div>
          <div class="kv"><div class="muted small">Date</div><div>${r.submitted_at||'—'}</div></div>
          ${r.notes? `<div class="kv"><div class="muted small">Notes</div><div style="white-space:pre-wrap">${r.notes}</div></div>`:''}
        </div>
      `).join('') : `<div class="card"><span class="badge none">NONE</span> No permits yet.</div>`
    }
  `;
}
export function renderLegendStatuses(statusCounts){
  const el=document.getElementById('legendStatuses');
  const entries = [
    ['Approved','#34d399'],
    ['Submitted - Pending','#fb923c'],
    ['Created - NOT Submitted','#facc15'],
    ['Not Approved - Cannot Attach','#a78bfa'],
    ['Not Approved - PLA Issues','#ef4444'],
    ['Not Approved - MRE Issues','#ef4444'],
    ['Not Approved - Other Issues','#ef4444'],
    ['NONE','#94a3b8']
  ];
  el.innerHTML = entries.map(([label,color])=>{
    const n=statusCounts[label]||0;
    return `<span class="lg-item">
      <span class="lg-shape" data-shape="circle" style="background:${color}"></span>
      <span>${label} <span class="muted small">(${n})</span></span>
    </span>`;
  }).join('');
}

export function renderReport({ poles, groups, statusCounts, ownerCounts }){
  const el=document.getElementById('reportBody'); const total=poles.length||0;
  const bar=(label,n,color)=>{
    const pct= total? Math.round(100*n/total):0;
    return `<div class="kv"><div class="muted small">${label}</div>
      <div>
        <div style="height:10px;border:1px solid #2a3242;border-radius:999px;overflow:hidden;background:#0c1118">
          <div style="height:100%;width:${pct}%;background:${color}"></div>
        </div>
        <div class="small muted" style="margin-top:4px">${n} <span class="muted">(${pct}%)</span></div>
      </div></div>`;
  };
  el.innerHTML = `
    <div class="card">
      <div class="kv"><div class="muted small">Poles</div><div><b>${total}</b></div></div>
      <div class="kv"><div class="muted small">Jobs</div><div>${groups.size}</div></div>
    </div>
    <div class="card"><div class="muted small" style="margin-bottom:4px">By Status</div>
      ${Object.entries(statusCounts).map(([k,n])=>bar(k,n,statusColorHex(k))).join('')}
    </div>
    <div class="card"><div class="muted small" style="margin-bottom:4px">By Owner</div>
      ${Object.entries(ownerCounts).map(([k,n])=>bar(k,n,'#7dd3fc')).join('')}
    </div>
  `;
}
export function toggleReport(show){ document.getElementById('report').classList.toggle('hidden',!show); }

window.addEventListener('ui:pole-click', (e)=>{
  fillDetails(e.detail);
});
