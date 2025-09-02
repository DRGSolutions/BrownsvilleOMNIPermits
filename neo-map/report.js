import { statusColor } from './data.js';

let charts = {};

function destroyCharts(){
  for(const k of Object.keys(charts)){
    try{ charts[k].destroy(); }catch{}
    delete charts[k];
  }
}

function fmt(n){ return n.toLocaleString(); }
function pct(n,d){ return d? Math.round(n*1000/d)/10 : 0; }

function paletteForStatuses(labels){
  return labels.map(s => statusColor(s));
}

function topN(obj, n=10){
  return Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,n);
}

function monthKey(mdy){
  const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(mdy||'').trim());
  if(!m) return null;
  return `${m[3]}-${m[1]}`; // YYYY-MM
}

export function openReport({ poles, permits, counts, ownerCounts, statusCounts }){
  destroyCharts();

  // KPIs
  const kpis = document.getElementById('kpiCards');
  const polesWithPermits = poles.filter(p => p.__hasPermit).length;
  const naTotal = (statusCounts['Not Approved - Cannot Attach']||0) + (statusCounts['Not Approved - PLA Issues']||0) + (statusCounts['Not Approved - MRE Issues']||0) + (statusCounts['Not Approved - Other Issues']||0);
  const pend = statusCounts['Submitted - Pending']||0;
  const appr = statusCounts['Approved']||0;

  kpis.innerHTML = `
    <div class="kpi"><div class="lbl">Total Poles</div><div class="val">${fmt(poles.length)}</div><div class="sub">${fmt(polesWithPermits)} with permits (${pct(polesWithPermits,poles.length)}%)</div></div>
    <div class="kpi"><div class="lbl">Total Permits</div><div class="val">${fmt(permits.length)}</div><div class="sub">Avg ${fmt(Math.round(permits.length / Math.max(1,polesWithPermits)))} per permitted pole</div></div>
    <div class="kpi"><div class="lbl">Not Approved</div><div class="val">${fmt(naTotal)}</div><div class="sub">Pending ${fmt(pend)} · Approved ${fmt(appr)}</div></div>
    <div class="kpi"><div class="lbl">Jobs</div><div class="val">${fmt(counts.jobs)}</div><div class="sub">Median/job: ${fmt(Math.round(counts.polesPerJobMedian||0))} poles</div></div>
  `;

  // Status chart
  const statusLabels = ['Approved','Submitted - Pending','Created - NOT Submitted','Not Approved - Cannot Attach','Not Approved - PLA Issues','Not Approved - MRE Issues','Not Approved - Other Issues','NONE'];
  const statusData = statusLabels.map(k => statusCounts[k]||0);
  charts.status = new Chart(document.getElementById('chStatus'), {
    type:'bar',
    data:{ labels: statusLabels, datasets:[{ label:'Poles', data: statusData, backgroundColor: paletteForStatuses(statusLabels) }]},
    options:{ plugins:{legend:{display:false}}, scales:{x:{grid:{display:false}}, y:{beginAtZero:true}} }
  });

  // Owner chart
  const ownerLabels = Object.keys(ownerCounts);
  const ownerData = ownerLabels.map(k => ownerCounts[k]||0);
  charts.owner = new Chart(document.getElementById('chOwner'), {
    type:'doughnut',
    data:{ labels:ownerLabels, datasets:[{ data: ownerData, backgroundColor:['#7dd3fc','#c4b5fd','#fda4af','#fde68a','#bbf7d0','#a7f3d0'] }]},
    options:{ plugins:{legend:{position:'bottom'}} }
  });

  // Top jobs
  const jobCounts = counts.byJob;
  const topJobs = topN(jobCounts, 12);
  charts.jobs = new Chart(document.getElementById('chJobs'), {
    type:'bar',
    data:{ labels: topJobs.map(r=>r[0]), datasets:[{ label:'Poles', data: topJobs.map(r=>r[1]), backgroundColor:'#60a5fa' }] },
    options:{ indexAxis:'y', plugins:{legend:{display:false}}, scales:{x:{beginAtZero:true}, y:{grid:{display:false}}} }
  });

  // Timeline (permits by month)
  const byMonth = {};
  for(const r of permits){
    const k = monthKey(r.submitted_at);
    if(!k) continue;
    byMonth[k] = (byMonth[k]||0)+1;
  }
  const months = Object.keys(byMonth).sort();
  charts.timeline = new Chart(document.getElementById('chTimeline'), {
    type:'line',
    data:{ labels: months, datasets:[{ label:'Permits', data: months.map(m=>byMonth[m]), borderWidth:2, tension:.25 }] },
    options:{ plugins:{legend:{display:false}}, scales:{x:{grid:{display:false}}, y:{beginAtZero:true}} }
  });

  // Observations
  const notes = [];
  if (naTotal > appr) notes.push(`More Not-Approved than Approved poles → prioritize remediation on NA categories.`);
  if (pend > appr) notes.push(`High Pending vs Approved → follow-ups with authorities could accelerate approvals.`);
  const worstJob = Object.entries(counts.naByJob||{}).sort((a,b)=> (b[1]||0)-(a[1]||0))[0];
  if (worstJob && worstJob[1] > 0) notes.push(`Job “${worstJob[0]}” has the most Not-Approved poles (${worstJob[1]}).`);
  if ((counts.polesPerJobMedian||0) > 0) notes.push(`Median ${Math.round(counts.polesPerJobMedian)} poles per job; consider splitting workstreams above 2× median.`);
  if (!notes.length) notes.push('Overall mix looks healthy. Keep pushing submissions and close the remaining pendings.');

  document.getElementById('observations').innerHTML = notes.map(n=>`<div class="note">${n}</div>`).join('');

  // Show panel
  document.getElementById('report').classList.remove('hidden');
}

export function closeReport(){
  destroyCharts();
  document.getElementById('report').classList.add('hidden');
}
