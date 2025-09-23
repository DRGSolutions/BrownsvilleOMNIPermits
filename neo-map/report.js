// neo-map/report.js
// Overall "Open Insights" report — same format as area report, but global.
// Uses the current poles + byKey (dominant status per pole) and groups by utility,
// including OTHER and UNKNOWN.

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
  if (s.includes('BPUB') || s.includes('BROWNSVILLE')) return 'BPUB';
  if (s.includes('AEP')) return 'AEP';
  if (s.includes('MVEC')) return 'MVEC';
  return 'OTHER';
}

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

function tableHTML(title, stats){
  const statuses = STATUS_BUCKETS;
  function row(label, rec){
    const n = rec.poles || 0;
    const cells = statuses.map(s=>{
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

  return `
    <div class="card span-2">
      <div class="card-title">${title}</div>
      <div style="overflow-x:auto;">
        <table class="small" style="border-collapse:separate; border-spacing:6px 3px; width:max-content;">
          <thead>
            <tr>
              <th></th>
              <th style="text-align:right; padding-right:8px">Poles</th>
              ${statuses.map(s=>`<th class="muted small" style="text-align:right; white-space:nowrap">${s}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${row('BPUB',     stats.owners.BPUB)}
            ${row('AEP',      stats.owners.AEP)}
            ${row('MVEC',     stats.owners.MVEC)}
            ${row('Other',    stats.owners.OTHER)}
            ${row('Unknown',  stats.owners.UNKNOWN)}
            <tr><td colspan="${2+statuses.length}"><div class="pp-sep"></div></td></tr>
            ${row('<span style="font-weight:700">All utilities</span>', stats.all)}
          </tbody>
        </table>
      </div>
    </div>`;
}

export function openReport({ poles, byKey }){
  const el = document.getElementById('report');
  const body = document.getElementById('reportBody');
  if (!el || !body) return;

  const stats = computeOverall(poles, byKey);
  body.innerHTML = tableHTML('Overall Utility × Permit Status', stats);
  el.classList.remove('hidden');
}

export function closeReport(){
  document.getElementById('report')?.classList.add('hidden');
}
