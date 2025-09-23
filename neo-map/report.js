// neo-map/report.js
// Overall "Open Insights" report — Utility × Permit Status summary using JSON data.
// Now supports clicking a utility row to reveal a per-job (map area) breakdown.

import { poleKey, statusColor } from './data.js';

const STATUS_BUCKETS = [
  'Approved','Submitted - Pending','Created - NOT Submitted',
  'Not Approved - Cannot Attach','Not Approved - Other Issues','NONE'
];

function bucketStatus(s){
  const t = String(s||'').trim();
  if (t === 'Approved') return 'Approved';
  if (t === 'Submitted - Pending') return 'Submitted - Pending';
  if (t === 'Created - NOT Submitted') return 'Created - NOT Submitted';
  if (t.startsWith('Not Approved - Cannot Attach')) return 'Not Approved - Cannot Attach';
  if (t.startsWith('Not Approved -')) return 'Not Approved - Other Issues';
  return 'NONE';
}

const DOM_PRIORITY = [
  s => s.startsWith('Not Approved - Cannot Attach'),
  s => s.startsWith('Not Approved - PLA Issues'),
  s => s.startsWith('Not Approved - MRE Issues'),
  s => s.startsWith('Not Approved - Other Issues'),
  s => s === 'Submitted - Pending',
  s => s === 'Created - NOT Submitted',
  s => s === 'Approved'
];

function dominantBucket(rel){
  if (!rel || !rel.length) return 'NONE';
  const ss = rel.map(r => String(r.permit_status||'').trim());
  for (const pred of DOM_PRIORITY){ const hit = ss.find(pred); if (hit) return bucketStatus(hit); }
  return bucketStatus(ss[0] || 'NONE');
}

function normOwner(o){
  const s = String(o||'').trim().toUpperCase();
  if (!s) return 'UNKNOWN';
  if (s === 'UNKNOWN') return 'UNKNOWN';
  if (s === 'OTHER')   return 'OTHER';
  if (s.includes('BPUB') || s.includes('BROWNSVILLE')) return 'BPUB';
  if (s.includes('AEP')) return 'AEP';
  if (s.includes('MVEC')) return 'MVEC';
  return 'OTHER';
}

/* ---------- overall aggregation ---------- */
function computeOverall(poles, byKey){
  const owners = ['BPUB','AEP','MVEC','OTHER','UNKNOWN'];
  const stats = {
    owners: Object.fromEntries(owners.map(o => [o, { poles:0, byStatus:Object.fromEntries(STATUS_BUCKETS.map(s=>[s,0])) }])),
    all:   { poles:0, byStatus:Object.fromEntries(STATUS_BUCKETS.map(s=>[s,0])) }
  };
  for (const p of (poles||[])){
    const rel = byKey?.get(poleKey(p)) || [];
    const b   = dominantBucket(rel);
    const o   = normOwner(p.owner);
    stats.all.poles += 1;
    stats.all.byStatus[b] += 1;
    stats.owners[o].poles += 1;
    stats.owners[o].byStatus[b] += 1;
  }
  return stats;
}

/* ---------- per-utility per-job breakdown ---------- */
function computeJobsForUtility(poles, byKey, utility){
  // group poles by job name, but only those whose normalized owner === utility
  const byJob = new Map();
  for (const p of (poles||[])){
    if (normOwner(p.owner) !== utility) continue;
    const job = String(p.job_name||'').trim(); if (!job) continue;
    if (!byJob.has(job)) byJob.set(job, []);
    byJob.get(job).push(p);
  }
  // turn into rows with status counts
  const rows = [];
  for (const [job, plist] of byJob.entries()){
    const rec = { job, poles:0, byStatus:Object.fromEntries(STATUS_BUCKETS.map(s=>[s,0])) };
    for (const p of plist){
      const rel = byKey?.get(poleKey(p)) || [];
      const b   = dominantBucket(rel);
      rec.poles += 1;
      rec.byStatus[b] += 1;
    }
    rows.push(rec);
  }
  // sort by poles desc
  rows.sort((a,b)=> b.poles - a.poles || a.job.localeCompare(b.job));
  return rows;
}

/* ---------- HTML renderers ---------- */
function tableRow(label, rec){
  const n = rec.poles || 0;
  const cells = STATUS_BUCKETS.map(s=>{
    const c = rec.byStatus[s]||0, pct = n? Math.round((c*1000)/n)/10 : 0;
    return `<td style="text-align:right; white-space:nowrap;">
              <span style="color:${statusColor(s)}">${c}</span>
              <span class="muted small"> (${pct}%)</span>
            </td>`;
  }).join('');
  return `<tr>
    <th style="text-align:left; padding-right:8px">${label}</th>
    <td style="text-align:right; font-weight:700; padding-right:8px">${n}</td>
    ${cells}
  </tr>`;
}

function overallCardHTML(stats){
  return `
    <div class="card span-2">
      <div class="card-title">Overall Utility × Permit Status</div>
      <div style="overflow-x:auto;">
        <table class="small" style="border-collapse:separate; border-spacing:6px 3px; width:max-content;">
          <thead>
            <tr>
              <th></th>
              <th style="text-align:right; padding-right:8px">Poles</th>
              ${STATUS_BUCKETS.map(s=>`<th class="muted small" style="text-align:right; white-space:nowrap">${s}</th>`).join('')}
            </tr>
          </thead>
          <tbody id="overall-utilities">
            <tr data-utility="BPUB"   class="row-click"><th style="text-align:left; cursor:pointer;">BPUB</th><td style="text-align:right; font-weight:700; padding-right:8px">${stats.owners.BPUB.poles}</td>${STATUS_BUCKETS.map(s=>`<td style="text-align:right; white-space:nowrap;"><span style="color:${statusColor(s)}">${stats.owners.BPUB.byStatus[s]}</span></td>`).join('')}</tr>
            <tr data-utility="AEP"    class="row-click"><th style="text-align:left; cursor:pointer;">AEP</th><td style="text-align:right; font-weight:700; padding-right:8px">${stats.owners.AEP.poles}</td>${STATUS_BUCKETS.map(s=>`<td style="text-align:right; white-space:nowrap;"><span style="color:${statusColor(s)}">${stats.owners.AEP.byStatus[s]}</span></td>`).join('')}</tr>
            <tr data-utility="MVEC"   class="row-click"><th style="text-align:left; cursor:pointer;">MVEC</th><td style="text-align:right; font-weight:700; padding-right:8px">${stats.owners.MVEC.poles}</td>${STATUS_BUCKETS.map(s=>`<td style="text-align:right; white-space:nowrap;"><span style="color:${statusColor(s)}">${stats.owners.MVEC.byStatus[s]}</span></td>`).join('')}</tr>
            <tr data-utility="OTHER"  class="row-click"><th style="text-align:left; cursor:pointer;">Other</th><td style="text-align:right; font-weight:700; padding-right:8px">${stats.owners.OTHER.poles}</td>${STATUS_BUCKETS.map(s=>`<td style="text-align:right; white-space:nowrap;"><span style="color:${statusColor(s)}">${stats.owners.OTHER.byStatus[s]}</span></td>`).join('')}</tr>
            <tr data-utility="UNKNOWN" class="row-click"><th style="text-align:left; cursor:pointer;">Unknown</th><td style="text-align:right; font-weight:700; padding-right:8px">${stats.owners.UNKNOWN.poles}</td>${STATUS_BUCKETS.map(s=>`<td style="text-align:right; white-space:nowrap;"><span style="color:${statusColor(s)}">${stats.owners.UNKNOWN.byStatus[s]}</span></td>`).join('')}</tr>
            <tr><td colspan="${2+STATUS_BUCKETS.length}"><div class="pp-sep"></div></td></tr>
            ${tableRow('<span style="font-weight:700">All utilities</span>', stats.all)}
          </tbody>
        </table>
      </div>
    </div>
    <div id="utility-breakdown" class="card span-2" style="display:none;"></div>
  `;
}

function jobsBreakdownCardHTML(utilLabel, rows){
  const body = rows.map(rec => tableRow(rec.job, rec)).join('');
  return `
    <div class="card-title">Jobs for ${utilLabel}</div>
    <div class="small muted" style="margin-bottom:8px">Click a job name on the map to view its area report.</div>
    <div style="overflow-x:auto;">
      <table class="small" style="border-collapse:separate; border-spacing:6px 3px; width:max-content;">
        <thead>
          <tr>
            <th style="text-align:left">Job</th>
            <th style="text-align:right; padding-right:8px">Poles</th>
            ${STATUS_BUCKETS.map(s=>`<th class="muted small" style="text-align:right; white-space:nowrap">${s}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${body || `<tr><td colspan="${2+STATUS_BUCKETS.length}" class="muted">No jobs found for this utility.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

/* ---------- Public API ---------- */
export function openReport({ poles, byKey }){
  const el = document.getElementById('report');
  const body = document.getElementById('reportBody');
  if (!el || !body) return;

  const stats = computeOverall(poles, byKey);
  body.innerHTML = overallCardHTML(stats);

  // wire utility row clicks → breakdown
  const rows = body.querySelectorAll('#overall-utilities tr.row-click');
  rows.forEach(tr => {
    tr.addEventListener('click', () => {
      const util = tr.getAttribute('data-utility');
      const label = (util === 'OTHER') ? 'Other' : (util === 'UNKNOWN' ? 'Unknown' : util);
      const jobs = computeJobsForUtility(poles, byKey, util);
      const target = document.getElementById('utility-breakdown');
      if (target){
        target.style.display = 'block';
        target.innerHTML = jobsBreakdownCardHTML(label, jobs);
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  el.classList.remove('hidden');
}

export function closeReport(){
  document.getElementById('report')?.classList.add('hidden');
}
