import { CONFIG } from './config.js';

function parseMDY(mdy){
  const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(mdy||'').trim());
  return m ? new Date(+m[3], +m[1]-1, +m[2]) : new Date(0);
}
export function latestStatusFor(list){
  if (!list || !list.length) return 'NONE';
  return list.map(r=>({r, d:parseMDY(r.submitted_at)})).sort((a,b)=>b.d-a.d)[0].r.permit_status || 'NONE';
}
export function statusColorHex(s){
  if (s==='Approved') return '#34d399';
  if (s==='Submitted - Pending') return '#fb923c';
  if (s==='Created - NOT Submitted') return '#facc15';
  if (s==='Not Approved - Cannot Attach') return '#a78bfa';
  if (typeof s==='string' && s.startsWith('Not Approved -')) return '#ef4444';
  return '#94a3b8'; // NONE
}
export function hexToRGBA(hex, a=255){
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if(!m) return [148,163,184,a];
  return [parseInt(m[1],16),parseInt(m[2],16),parseInt(m[3],16),a];
}

async function tryFetch(url){
  const res = await fetch(url,{cache:'no-store'});
  if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
async function loadFromGitHub(path){
  const base = `https://raw.githubusercontent.com/${CONFIG.OWNER}/${CONFIG.REPO}/${CONFIG.DEFAULT_BRANCH}/${CONFIG.DATA_DIR}`;
  return tryFetch(`${base}/${path}`);
}
async function loadFallback(path){
  try { return await tryFetch(`../${CONFIG.DATA_DIR}/${path}`); } catch {}
  try { return await tryFetch(`./${path}`); } catch {}
  try { return await tryFetch(`../${CONFIG.DATA_DIR}/temp/${path}`); } catch {}
  try { return await tryFetch(`../data/temp/${path}`); } catch {}
  throw new Error(`Unable to load ${path}`);
}
export async function loadData(){
  let poles, permits;
  try{
    [poles, permits] = await Promise.all([loadFromGitHub('poles.json'), loadFromGitHub('permits.json')]);
  }catch{
    [poles, permits] = await Promise.all([loadFallback('poles.json'), loadFallback('permits.json')]);
  }
  return {poles, permits};
}
export function indexPermits(permits){
  const map = new Map();
  for(const r of (permits||[])){
    const k = `${r.job_name}::${r.tag}::${r.SCID}`;
    if(!map.has(k)) map.set(k,[]);
    map.get(k).push(r);
  }
  return map;
}
export function buildContexts(poles, permits){
  const idx = indexPermits(permits);
  return (poles||[]).map(p=>{
    const k = `${p.job_name}::${p.tag}::${p.SCID}`;
    const rel = idx.get(k) || [];
    return { pole:p, permits:rel, latestStatus: latestStatusFor(rel) };
  });
}
export function toIconData(ctxs){
  // deck.gl IconLayer expects [{position:[lon,lat], owner, status, job, tag, SCID, ctx}, ...]
  return ctxs.map(c=>({
    position:[+c.pole.lon, +c.pole.lat],
    owner:c.pole.owner, status:c.latestStatus, job:c.pole.job_name, tag:c.pole.tag, SCID:c.pole.SCID,
    ctx:c
  }));
}
export function distinctValues(arr, key){
  return Array.from(new Set((arr||[]).map(o=>o?.[key]).filter(Boolean))).sort((a,b)=> String(a).localeCompare(String(b), undefined, { numeric:true }));
}
export function hashColor(name){
  let h=0; for (let i=0;i<name.length;i++) h=(h*31 + name.charCodeAt(i))|0;
  const hue = Math.abs(h)%360;
  return `hsl(${hue}deg 65% 55%)`;
}
