import { CONFIG } from './config.js';

export const poleKey = p => `${p.job_name}::${p.tag}::${p.SCID}`;

function buildPermitIndex(permits){
  const m=new Map();
  for(const r of (permits||[])){
    const k = `${r.job_name}::${r.tag}::${r.SCID}`;
    if(!m.has(k)) m.set(k,[]);
    m.get(k).push(r);
  }
  for(const arr of m.values()){
    arr.sort((a,b)=> String(a.permit_id).localeCompare(String(b.permit_id)));
  }
  return m;
}

async function tryJSON(paths, file){
  for(const base of paths){
    const url = base.endsWith('/') ? base+file : `${base}/${file}`;
    try{ const r=await fetch(url,{cache:'no-store'}); if(r.ok) return await r.json(); }catch{}
  }
  throw new Error(`Could not load ${file} from ${paths.join(', ')}`);
}

export async function loadPolesAndPermits(){
  const poles = await tryJSON(CONFIG.DATA_PATHS, 'poles.json');
  const permits = await tryJSON(CONFIG.DATA_PATHS, 'permits.json');
  const polesClean = (poles||[]).filter(p=> typeof p.lat==='number' && typeof p.lon==='number');
  const byKey = buildPermitIndex(permits||[]);
  return { poles:polesClean, permits:permits||[], byKey };
}

/* status helpers (match your palette) */
export function statusColor(status){
  const s=String(status||'').trim();
  const css = k => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
  if (s==='Approved') return css('--chip-approved') || '#34d399';
  if (s==='Submitted - Pending') return css('--chip-pending') || '#fb923c';
  if (s==='Created - NOT Submitted') return css('--chip-created') || '#facc15';
  if (s==='Not Approved - Cannot Attach') return css('--chip-na-cannot') || '#a78bfa';
  if (s.startsWith('Not Approved -')) return css('--chip-na-other') || '#ef4444';
  return css('--chip-none') || '#94a3b8';
}

export function dominantStatusFor(permits){
  if(!permits || !permits.length) return 'NONE';
  const ss=permits.map(r=>String(r.permit_status||'').trim());
  const pri=[
    'Not Approved - Cannot Attach','Not Approved - PLA Issues','Not Approved - MRE Issues','Not Approved - Other Issues',
    'Submitted - Pending','Created - NOT Submitted','Approved'
  ];
  for(const p of pri){
    if (p.includes('Not Approved -')){
      if (ss.some(s=>s.startsWith('Not Approved -'))) return ss.find(s=>s.startsWith('Not Approved -'));
    }else if(ss.includes(p)) return p;
  }
  return ss[0] || 'NONE';
}

export function hashColor(s){
  let h=0; for(let i=0;i<s.length;i++) h=(h*31 + s.charCodeAt(i))>>>0;
  return `hsl(${h%360} 70% 50%)`;
}
