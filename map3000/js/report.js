// /map3000/js/report.js  — robust v2
import { STATUS_ORDER, statusColor, poleKey } from './config.js';

export function open(){
  buildSafe();
  state.ui.report.classList.add('open');
}
export function close(){ state.ui.report.classList.remove('open'); }
export function print(){ window.print(); }

// ---------- helpers ----------
function dominant(rel){
  if(!rel||!rel.length) return 'NONE';
  const s=rel.map(r=>String(r.permit_status||'').trim());
  const na=s.find(x=>x.startsWith('Not Approved -')); if(na) return na;
  if(s.includes('Submitted - Pending')) return 'Submitted - Pending';
  if(s.includes('Created - NOT Submitted')) return 'Created - NOT Submitted';
  if(s.includes('Approved')) return 'Approved';
  return 'NONE';
}
function el(id){ return /** @type {HTMLElement|null} */(document.getElementById(id)); }
function safeNumber(v, d=0){ return Number.isFinite(v)?v:d; }

// ---------- main builder (safe) ----------
function buildSafe(){
  const wrap = state.ui.report;
  if(!wrap){ console.warn('report: wrap missing'); return; }

  wrap.innerHTML = `
    <header>
      <strong>Visual Intelligence — YEAR 3000</strong>
      <div class="row">
        <button id="rptPrint" class="btn">Print / Save PDF</button>
        <button id="rptClose" class="btn">Close</button>
      </div>
    </header>
    <main>
      <div class="card"><h4>Sunburst: Job → Status Mix</h4><div id="sunburst"></div></div>
      <div class="card"><h4>Treemap: Owner → Status Volume</h4><div id="treemap" style="height:360px"></div></div>
      <div class="card"><h4>Chord: Owner ↔ Status Flow</h4><svg id="chord" width="640" height="420"></svg></div>
      <div class="card"><h4>Severity Density Spark</h4><canvas id="spark" height="80"></canvas></div>
      <div class="card"><h4>Outlier Scanner (Jobs with extreme Not-Approved ratios)</h4><div id="outliers"></div></div>
    </main>`;

  el('rptClose').onclick = close;
  el('rptPrint').onclick = print;

  // ---- aggregates (fully guarded) ----
  const ownersAll = ['BPUB','AEP','MVEC'];
  const byJob = new Map();
  const flow  = {}; ownersAll.forEach(o=>flow[o]={}); STATUS_ORDER.forEach(s=>ownersAll.forEach(o=>flow[o][s]=0));
  const densityWeights = [];
  const outliers = [];

  try{
    for(const p of state.poles||[]){
      const rel = state.byKey.get(poleKey(p))||[];
      const dom = dominant(rel);

      // jobs
      if(!byJob.has(p.job_name)) byJob.set(p.job_name, {});
      const jb = byJob.get(p.job_name); jb[dom]=(jb[dom]||0)+1;

      // owner flow (only known owners counted in chord)
      const own = ownersAll.includes(p.owner)?p.owner:null;
      if(own) flow[own][dom] = (flow[own][dom]||0)+1;

      // density (weights 1..N, worst heaviest)
      const idx = STATUS_ORDER.indexOf(dom); densityWeights.push(idx<0?1:1+(STATUS_ORDER.length-1-idx));

      // outliers per pole’s permits
      const na = rel.filter(r=>String(r.permit_status||'').startsWith('Not Approved -')).length;
      const tot = rel.length||1;
      if(tot>0) outliers.push({job:p.job_name, ratio:na/tot, na, tot});
    }
  }catch(e){ console.error('report: aggregate error', e); }

  // ---- build each viz with isolation ----
  try { buildSunburst(byJob); } catch(e){ console.error('sunburst', e); }
  try { buildTreemap(flow); } catch(e){ console.error('treemap', e); }
  try { buildChord(flow, ownersAll); } catch(e){ console.error('chord', e); }
  try { buildSpark(densityWeights); } catch(e){ console.error('spark', e); }
  try { buildOutliers(outliers); } catch(e){ console.error('outliers', e); }
}

// ---------- visualizations ----------
function buildSunburst(byJob){
  const host = el('sunburst'); if(!host) return;
  host.innerHTML='';
  const data = {name:'jobs', children:[...byJob.entries()].map(([job,cnts])=>({
    name:job, children:Object.entries(cnts).map(([s,c])=>({name:s, value:safeNumber(c)}))
  }))};
  const w=560, r=w/2;
  const root=d3.hierarchy(data).sum(d=>d.value||0);
  d3.partition().size([2*Math.PI, r])(root);
  const arc=d3.arc().startAngle(d=>d.x0).endAngle(d=>d.x1).innerRadius(d=>d.y0).outerRadius(d=>d.y1-1);
  const svg=d3.select(host).append('svg').attr('width',w).attr('height',w).append('g').attr('transform',`translate(${r},${r})`);
  svg.selectAll('path').data(root.descendants().filter(d=>d.depth))
    .enter().append('path').attr('d',arc)
    .attr('fill',d=>d.depth===2?statusColor(d.data.name).trim():'#1f2937')
    .attr('stroke','#0b1220')
    .append('title').text(d=>`${d.ancestors().map(a=>a.data.name).reverse().slice(1).join(' → ')}: ${d.value}`);
}

function buildTreemap(flow){
  const host = el('treemap'); if(!host) return;
  host.innerHTML='';
  const owners = Object.keys(flow);
  const tData = {name:'owners', children:owners.map(o=>({
    name:o, children:Object.entries(flow[o]).map(([s,c])=>({name:s, value:safeNumber(c)}))
  }))};
  const w = host.clientWidth || 560, h = 360;
  const root=d3.hierarchy(tData).sum(d=>d.value||0); d3.treemap().size([w,h]).paddingInner(2)(root);
  const svg=d3.select(host).append('svg').attr('width',w).attr('height',h);
  const g=svg.selectAll('g').data(root.leaves()).enter().append('g').attr('transform',d=>`translate(${d.x0},${d.y0})`);
  g.append('rect').attr('width',d=>d.x1-d.x0).attr('height',d=>d.y1-d.y0).attr('fill',d=>statusColor(d.data.name)).attr('stroke','#0b1220');
  g.append('text').attr('x',6).attr('y',16).attr('fill','#e5e7eb').attr('font-size','12')
    .text(d=>`${d.parent?.data?.name||''} · ${d.data.name} (${d.value})`);
}

function buildChord(flow, owners){
  const host = el('chord'); if(!host) return;
  const svg=d3.select(host); svg.selectAll('*').remove();
  const statuses=STATUS_ORDER;
  const matrix = owners.map(o=>statuses.map(s=>safeNumber(flow[o]?.[s]||0)));
  const cw=+svg.attr('width')||640, ch=+svg.attr('height')||420, r=Math.min(cw,ch)/2-30;
  const chord=d3.chord().padAngle(0.03)(d3.transpose(matrix));
  const g=svg.append('g').attr('transform',`translate(${cw/2},${ch/2})`);
  const color=d3.scaleOrdinal(statuses.map(statusColor));
  g.selectAll('path.group').data(chord.groups).enter().append('path')
    .attr('class','group').style('fill',d=>color(statuses[d.index])).style('stroke','#0b1220')
    .attr('d',d3.arc().innerRadius(r).outerRadius(r+10));
  g.append('g').selectAll('path').data(chord)
    .enter().append('path').attr('d',d3.ribbon().radius(r))
    .style('fill',d=>color(statuses[d.target.index])).style('stroke','#0b1220')
    .append('title').text(d=>`${owners[d.source.index]} → ${statuses[d.target.index]}: ${d.source.value}`);
}

function buildSpark(weights){
  const host = /** @type {HTMLCanvasElement|null} */(el('spark')); if(!host) return;
  const seq = weights.slice().sort((a,b)=>a-b);
  if(window.sparkChart) window.sparkChart.destroy();
  window.sparkChart = new Chart(host,{type:'line', data:{labels:seq.map((_,i)=>i), datasets:[{data:seq, borderWidth:1.4, pointRadius:0, tension:.35}]},
    options:{plugins:{legend:{display:false}}, scales:{x:{display:false}, y:{display:false}}}});
}

function buildOutliers(rows){
  const host = el('outliers'); if(!host) return;
  host.innerHTML='';
  rows.filter(r=>Number.isFinite(r.ratio)).sort((a,b)=>b.ratio-a.ratio).slice(0,12).forEach(o=>{
    const row=document.createElement('div'); row.className='row'; row.style.cssText='justify-content:space-between; margin:6px 0; border-bottom:1px solid #162032; padding-bottom:6px';
    row.innerHTML=`<div><b>${o.job}</b> <span class="muted">NA ${o.na}/${o.tot}</span></div><div style="font-weight:800">${(o.ratio*100).toFixed(1)}%</div>`;
    host.appendChild(row);
  });
}
