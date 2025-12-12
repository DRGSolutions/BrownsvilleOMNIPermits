const FIELD_DEF = [
  { key:'owner',      label:'Owner', type:'enum', options:['BPUB','AEP','MVEC','Charter','AT&T'] },
  { key:'job_name',   label:'Job Name', type:'text' },
  { key:'tag',        label:'Tag', type:'text' },
  { key:'SCID',       label:'SCID', type:'text' },
  { key:'mr_level',   label:'MR Level', type:'text' },
  { key:'permit_any', label:'Permit Status (any)', type:'enum', options:[
    'NONE','Created - NOT Submitted','Submitted - Pending','Approved',
    'Not Approved - Cannot Attach','Not Approved - PLA Issues','Not Approved - MRE Issues','Not Approved - Other Issues'
  ] }
];
const OPS = [
  {key:'eq',label:'='},{key:'neq',label:'≠'},{key:'contains',label:'contains'},{key:'starts',label:'starts with'},{key:'ends',label:'ends with'}
];

export function ruleRow(){
  const row=document.createElement('div'); row.className='rule';
  row.innerHTML=`
    <select class="f-field">${FIELD_DEF.map(f=>`<option value="${f.key}">${f.label}</option>`).join('')}</select>
    <select class="f-op">${OPS.map(o=>`<option value="${o.key}">${o.label}</option>`).join('')}</select>
    <span class="f-value-wrap"><input class="f-value" placeholder="value"/></span>
    <button class="btn remove" title="Remove">✕</button>`;
  const fieldSel=row.querySelector('.f-field'), wrap=row.querySelector('.f-value-wrap');
  function refresh(){ const def=FIELD_DEF.find(f=>f.key===fieldSel.value);
    wrap.innerHTML = def?.type==='enum' ? `<select class="f-value">${def.options.map(x=>`<option>${x}</option>`).join('')}</select>` : `<input class="f-value" placeholder="value"/>`; }
  fieldSel.addEventListener('change',refresh); row.querySelector('.remove').addEventListener('click',()=>row.remove()); refresh(); return row;
}

export function readRules(){
  const logic=(document.getElementById('logic').value||'AND').toUpperCase();
  const rules=[]; for(const el of document.querySelectorAll('#rules .rule')){
    rules.push({ field: el.querySelector('.f-field').value, op: el.querySelector('.f-op').value, value: (el.querySelector('.f-value')?.value||'') });
  }
  const qOwner=document.getElementById('qOwner').value;
  const qStatus=document.getElementById('qStatus').value;
  const qSearch=(document.getElementById('qSearch').value||'').trim().toLowerCase();
  return { logic, rules, q:{ owner:qOwner, status:qStatus, search:qSearch } };
}

export function matchRule(p, r, related){
  const getVal = ()=>{
    if (r.field==='permit_any'){
      const statuses=related.map(x=>x.permit_status||'');
      if(r.value==='NONE') return statuses.length===0 ? 'NONE' : '';
      return statuses.find(s=>{
        const a=s.toLowerCase(), b=(r.value||'').toLowerCase();
        if(r.op==='eq')return a===b;
        if(r.op==='neq')return a!==b;
        if(r.op==='contains')return a.includes(b);
        if(r.op==='starts')return a.startsWith(b);
        if(r.op==='ends')return a.endsWith(b);
        return false;
      }) ? 'hit' : '';
    }
    return (p[r.field] ?? '').toString();
  };
  const val=getVal(), target=val.toLowerCase(), cmp=(r.value||'').toLowerCase();

  if (r.field==='permit_any'){
    if(r.value==='NONE'){ if(r.op==='eq')return val==='NONE'; if(r.op==='neq')return val!=='NONE'; return false; }
    return (r.op==='neq') ? (val!=='hit') : (val==='hit');
  }

  if(r.op==='eq')return target===cmp;
  if(r.op==='neq')return target!==cmp;
  if(r.op==='contains')return target.includes(cmp);
  if(r.op==='starts')return target.startsWith(cmp);
  if(r.op==='ends')return target.endsWith(cmp);
  return true;
}
