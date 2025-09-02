import { distinctValues } from './data.js';

const FIELDS = [
  { id:'owner',        label:'Owner',        type:'enum' },
  { id:'job_name',     label:'Job Name',     type:'enum' },
  { id:'permit_status',label:'Permit Status',type:'enum' },   // evaluated against ANY permit for the pole (or NONE)
  { id:'has_permit',   label:'Has Permit',   type:'bool' },
  { id:'mr_level',     label:'MR Level',     type:'text' },
  { id:'tag',          label:'Tag',          type:'text' },
  { id:'SCID',         label:'SCID',         type:'text' },
  { id:'submitted_by', label:'Submitted By', type:'text' },
  { id:'submitted_at', label:'Submitted Date', type:'date' },  // MM/DD/YYYY matched on any permit
];

const OPS = {
  text: [
    { id:'eq',  label:'is' },
    { id:'neq', label:'is not' },
    { id:'has', label:'contains' },
    { id:'sw',  label:'starts with' },
  ],
  enum: [
    { id:'eq', label:'is' },
    { id:'neq',label:'is not' },
    { id:'in', label:'is any of (comma)' },
  ],
  bool: [
    { id:'is', label:'is' }
  ],
  date: [
    { id:'on',  label:'on' },
    { id:'after', label:'after' },
    { id:'before', label:'before' },
    { id:'between', label:'between (MM/DD/YYYY,MM/DD/YYYY)' },
  ]
};

export function initFilterUI({ poles, permits, statuses }, onApply){
  const rulesEl = document.getElementById('rules');
  const chipsEl = document.getElementById('activeChips');
  const btnAdd  = document.getElementById('btnAddRule');
  const btnClear= document.getElementById('btnClearRules');
  const btnApply= document.getElementById('btnApplyRules');
  const logicEl = document.getElementById('logicToggle');

  const enums = {
    owner: distinctValues(poles,'owner'),
    job_name: distinctValues(poles,'job_name'),
    permit_status: statuses,
  };

  function ruleRow(){
    const wrap = document.createElement('div');
    wrap.className='rule';

    const selField = document.createElement('select');
    selField.innerHTML = FIELDS.map(f=>`<option value="${f.id}">${f.label}</option>`).join('');

    const selOp = document.createElement('select');

    const val = document.createElement('input');
    val.placeholder='value';

    const del = document.createElement('button');
    del.className='btn btn-del';
    del.textContent='✕';

    function refreshOps(){
      const f = FIELDS.find(x=>x.id===selField.value);
      const group = OPS[f.type];
      selOp.innerHTML = group.map(o=>`<option value="${o.id}">${o.label}</option>`).join('');
      val.type = (f.type==='date' ? 'text' : 'text');
      if (f.type==='enum') {
        val.setAttribute('list', `dl-${f.id}`);
      } else {
        val.removeAttribute('list');
      }
      if (f.type==='bool') {
        val.value = 'true';
        val.disabled = true;
      } else {
        val.disabled = false;
      }
    }

    selField.addEventListener('change', refreshOps);
    del.addEventListener('click', ()=> wrap.remove());

    wrap.appendChild(selField);
    wrap.appendChild(selOp);
    wrap.appendChild(val);
    wrap.appendChild(del);

    // datalists for enum
    for(const k of Object.keys(enums)){
      let dl = document.getElementById(`dl-${k}`);
      if(!dl){
        dl = document.createElement('datalist');
        dl.id=`dl-${k}`;
        dl.innerHTML = enums[k].map(v=>`<option value="${v}">`).join('');
        document.body.appendChild(dl);
      }
    }

    refreshOps();
    return wrap;
  }

  btnAdd.addEventListener('click', ()=> rulesEl.appendChild(ruleRow()));
  btnClear.addEventListener('click', ()=> { rulesEl.innerHTML=''; chipsEl.innerHTML=''; onApply(null); });
  btnApply.addEventListener('click', ()=>{
    const logic = logicEl.value;
    const rules = Array.from(rulesEl.querySelectorAll('.rule')).map(row=>{
      const [field,opI,valI] = row.querySelectorAll('select,input');
      return { field:field.value, op:opI.value, value: valI.value.trim() };
    });
    chipsEl.innerHTML = rules.map(r=> `<span class="chip">${r.field} ${r.op} “${r.value||'—'}”</span>`).join('');
    onApply({ logic, rules });
  });

  // start with one row
  btnAdd.click();
}

export function buildPredicate(filter){
  if (!filter || !filter.rules || filter.rules.length===0) return ()=>true;
  const { logic, rules } = filter;
  const L = logic === 'OR' ? (acc,v)=>acc||v : (acc,v)=>acc&&v;

  return function(poleCtx){
    return rules.map(rule => testRule(rule, poleCtx))
                .reduce((acc,v,i)=> i===0 ? v : L(acc,v), false);
  };
}

function anyPermit(pctx, fn){
  const arr = pctx.permits || [];
  if (arr.length===0) return false;
  for(const r of arr){ if(fn(r)) return true; }
  return false;
}

function parseDate(s){
  const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s||'').trim());
  return m ? new Date(+m[3], +m[1]-1, +m[2]) : null;
}

function testRule(rule, pctx){
  const { field, op, value } = rule;
  const v = String(value||'').trim();

  // pole-level fields
  const pole = pctx.pole;
  if (['owner','job_name','mr_level','tag','SCID'].includes(field)) {
    const cur = String(pole[field] ?? '').trim();
    if (op==='eq')  return cur===v;
    if (op==='neq') return cur!==v;
    if (op==='has') return cur.toLowerCase().includes(v.toLowerCase());
    if (op==='sw')  return cur.toLowerCase().startsWith(v.toLowerCase());
    if (op==='in')  return v.split(',').map(x=>x.trim()).includes(cur);
    return true;
  }

  if (field==='has_permit') {
    const yes = (v.toLowerCase()!=='false' && v.toLowerCase()!=='no' && v!=='0');
    return yes ? (pctx.permits.length>0) : (pctx.permits.length===0);
  }

  if (field==='permit_status') {
    if (v==='NONE') return pctx.permits.length===0;
    if (op==='eq')  return anyPermit(pctx, r => r.permit_status===v);
    if (op==='neq') return !anyPermit(pctx, r => r.permit_status===v);
    if (op==='in')  {
      const set = new Set(v.split(',').map(x=>x.trim()));
      return anyPermit(pctx, r => set.has(r.permit_status));
    }
    return true;
  }

  if (field==='submitted_by') {
    if (pctx.permits.length===0) return false;
    if (op==='eq')  return anyPermit(pctx, r => String(r.submitted_by||'')===v);
    if (op==='neq') return !anyPermit(pctx, r => String(r.submitted_by||'')===v);
    if (op==='has') return anyPermit(pctx, r => String(r.submitted_by||'').toLowerCase().includes(v.toLowerCase()));
    if (op==='sw')  return anyPermit(pctx, r => String(r.submitted_by||'').toLowerCase().startsWith(v.toLowerCase()));
    if (op==='in')  {
      const set=new Set(v.split(',').map(x=>x.trim()));
      return anyPermit(pctx, r => set.has(String(r.submitted_by||'')));
    }
    return true;
  }

  if (field==='submitted_at') {
    if (pctx.permits.length===0) return false;
    if (op==='on')     return anyPermit(pctx, r => String(r.submitted_at||'')===v);
    if (op==='after')  { const d=parseDate(v); if(!d) return false; return anyPermit(pctx, r => parseDate(r.submitted_at) > d); }
    if (op==='before') { const d=parseDate(v); if(!d) return false; return anyPermit(pctx, r => parseDate(r.submitted_at) < d); }
    if (op==='between'){
      const [a,b]=v.split(',').map(s=>parseDate(s)); if(!a||!b) return false;
      return anyPermit(pctx, r => { const d=parseDate(r.submitted_at); return d && d>=a && d<=b; });
    }
    return true;
  }

  return true;
}
