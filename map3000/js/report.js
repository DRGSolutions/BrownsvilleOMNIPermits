import { STATUS_ORDER, statusColor, poleKey } from './config.js';

let charts=[];

export function open(){
  build();
  state.ui.report.classList.add('open');
}
export function close(){
  state.ui.report.classList.remove('open');
}
export function print(){
  window.print();
}

function build(){
  const el = state.ui.report;
  el.innerHTML = `
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

  document.getElementById('rptClose').onclick = close;
  document.getElementById('rptPrint').onclick = print;

  // aggregates
  const owners=['BPUB','AEP','MVEC'];
  const byJob=new Map(), flow={}, density=[], outliers=[];
  owners.forEach(o=>flow[o]={}); STATUS_ORDER.forEach(s=>owners.forEach(o=>flow[o][s]=0));

  for(const p of state.poles){
    const rel=state.byKey.get(poleKey(p))||[];
    const dom=dominant(rel);
    if(!byJob.has(p.job_name)) byJob.set(p.job_name,{}); byJob.get(p.job_name)[dom]=(byJob.get(p.job_name)[dom]||0)+1;
    const own=owners.includes(p.owner)?p.owner:'OTHER';
    if(flow[own]) flow[own][dom]++;

    density.push(dom); // we convert to weights later
    const na = rel.filter(r=>String(r.permit_status||'').startsWith('Not Approved -')).length;
    const tot=rel.length||1; const ratio=na/tot;
    if(tot>1 || na>=1) outliers.push({job:p.job_name, ratio, na, tot});
  }

  makeSunburst(byJob);
  makeTreemap(flow);
  makeChord(flow, owners);
  makeSpark(density);
  makeOutliers(outliers);
}

function dominant(rel){
  if(!rel||!rel.length) return 'NONE';
  const s=rel.map(r=>String(r.permit_status||'').trim());
  if(s.find(x=>x.startsWith('Not Approved -'))) return s.find(x=>x.startsWith('Not Approved -'));
  if(s.includes('Submitted - Pending')) return 'Submitted - Pending';
  if(s.includes('Created - NOT Submitted')) return 'Created - NOT Submitted';
  if(s.includes('Approved')) return 'Approved';
  return 'NONE';
}

/* ---- Report viz helpers (d3 + Chart.js) ---- */
function makeSunburst(byJob){
  d3.select('#sunburst').selectAll('*').remove();
  const rootData = {name:'jobs', children:[...byJob.entries()].map(([job,cnts])=>({name:job, children:Object.entries(cnts).map(([s,c])=>({name:s, value:c}))}))};
  const w=560, r=w/2, root=d3.hierarchy(rootData).sum(d=>d.value||0);
  d3.partition().size([2*Math.PI, r])(root);
  const arc=d3.arc().startAngle(d=>d.x0).endAngle(d=>d.x1).innerRadius(d=>d.y0).outerRadius(d=>d.y1-1);
  const svg=d3.select('#sunburst').append('svg').attr('width',w).attr('height',w).append('g').attr('transform',`translate(${r},${r})`);
  svg.selectAll('path').data(root.descendants().filter(d=>d.depth))
    .enter().append('path').attr('d',arc)
    .attr('fill',d=>d.depth===2?statusColor(d.data.name).trim():'#1f2937')
    .attr('stroke','#0b1220').append('title').text(d=>`${d.ancestors().map(a=>a.data.name).reverse().slice(1).join(' → ')}: ${d.value}`);
}

function makeTreemap(flow){
  d3.select('#treemap').selectAll('*').remove();
  const owners=Object.keys(flow);
  const tData={name:'owners', children:owners.map(o=>({name:o, children:Object.entries(flow[o]).map(([s,c])=>({name:s,value:c}))}))};
  const w=document.getElementById('treemap').clientWidth, h=360;
  const root=d3.hierarchy(tData).sum(d=>d.value||0); d3.treemap().size([w,h]).paddingInner(2)(root);
  const svg=d3.select('#treemap').append('svg').attr('width',w).attr('height',h);
  const g=svg.selectAll('g').data(root.leaves()).enter().append('g').attr('transform',d=>`translate(${d.x0},${d.y0})`);
  g.append('rect').attr('width',d=>d.x1-d.x0).attr('height',d=>d.y1-d.y0).attr('fill',d=>statusColor(d.data.name)).attr('stroke','#0b1220');
  g.append('text').attr('x',6).attr('y',16).attr('fill','#e5e7eb').attr('font-size','12')
    .text(d=>`${d.parent.data.name} · ${d.data.name} (${d.value})`);
}

function makeChord(flow, owners){
  const statuses=STATUS_ORDER;
  const matrix = owners.map(o=>statuses.map(s=>(flow[o]?.[s])||0));
  const svg=d3.select('#chord'); svg.selectAll('*').remove();
  const cw=+svg.attr('width'), ch=+svg.attr('height'), r=Math.min(cw,ch)/2-30;
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

function makeSpark(seq){
  const weights = seq.map(s=>({x:0,y:0,w: s==='NONE'?1: (STATUS_ORDER.indexOf(s)===0?8:5)})).map(o=>o.w).sort((a,b)=>a-b);
  const ctx=document.getElementById('spark');
  if(window.sparkChart) window.sparkChart.destroy();
  window.sparkChart=new Chart(ctx,{type:'line', data:{labels:weights.map((_,i)=>i), datasets:[{data:weights, borderWidth:1.4, pointRadius:0, tension:.35}]},
    options:{plugins:{legend:{display:false}}, scales:{x:{display:false},y:{display:false}}});
}

function makeOutliers(rows){
  const el=document.getElementById('outliers'); el.innerHTML='';
  rows.sort((a,b)=>b.ratio-a.ratio).slice(0,12).forEach(o=>{
    const row=document.createElement('div'); row.className='row'; row.style.cssText='justify-content:space-between; margin:6px 0; border-bottom:1px solid #162032; padding-bottom:6px';
    row.innerHTML=`<div><b>${o.job}</b> <span class="muted">NA ${o.na}/${o.tot}</span></div><div style="font-weight:800">${(o.ratio*100).toFixed(1)}%</div>`;
    el.appendChild(row);
  });
}
