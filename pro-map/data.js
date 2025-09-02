import { CONFIG } from './config.js';

function parseMDY(mdy){
  const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(mdy||'').trim());
  return m ? new Date(+m[3], +m[1]-1, +m[2]) : new Date(0);
}

// Exactly mirror your status palette
export function statusColor(s){
  const x = String(s||'');
  if (x === 'Approved') return getComputedStyle(document.documentElement).getPropertyValue('--chip-approved').trim() || '#34d399';
  if (x === 'Submitted - Pending') return getComputedStyle(document.documentElement).getPropertyValue('--chip-pending').trim() || '#fb923c';
  if (x === 'Created - NOT Submitted') return getComputedStyle(document.documentElement).getPropertyValue('--chip-created').trim() || '#facc15';
  if (x === 'Not Approved - Cannot Attach') return getComputedStyle(document.documentElement).getPropertyValue('--chip-na-cannot').trim() || '#a78bfa';
  if (x.startsWith('Not Approved -')) return getComputedStyle(document.documentElement).getPropertyValue('--chip-na-other').trim() || '#ef4444';
  return getComputedStyle(document.documentElement).getPropertyValue('--chip-none').trim() || '#94a3b8'; // NONE
}

// From permits for a pole: pick latest by submitted_at
export function latestStatusFor(list){
  if (!list || !list.length) return 'NONE';
  return list
    .map(r => ({ r, d: parseMDY(r.submitted_at) }))
    .sort((a,b)=> b.d - a.d)[0].r.permit_status || 'NONE';
}

export function idxPermitsByPole(permits){
  const map = new Map();
  for(const r of (permits||[])){
    const k = `${r.job_name}::${r.tag}::${r.SCID}`;
    if(!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

async function tryFetch(url){
  const res = await fetch(url, { cache: 'no-store' });
  if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function loadFromGitHub(path){
  const base = `https://raw.githubusercontent.com/${CONFIG.OWNER}/${CONFIG.REPO}/${CONFIG.DEFAULT_BRANCH}/${CONFIG.DATA_DIR}`;
  return tryFetch(`${base}/${path}`);
}

async function loadFallback(path){
  // same-origin fallback (e.g., when hosted alongside /data/*.json)
  try { return await tryFetch(`../${CONFIG.DATA_DIR}/${path}`); } catch {}
  try { return await tryFetch(`./${path}`); } catch {}
  // temp/ fallback — some repos may stage poles.json in /data/temp
  try { return await tryFetch(`../${CONFIG.DATA_DIR}/temp/${path}`); } catch {}
  try { return await tryFetch(`../data/temp/${path}`); } catch {}
  throw new Error(`Unable to load ${path}`);
}

export async function loadData(){
  let poles, permits;
  try {
    [poles, permits] = await Promise.all([
      loadFromGitHub('poles.json'),
      loadFromGitHub('permits.json')
    ]);
  } catch {
    [poles, permits] = await Promise.all([
      loadFallback('poles.json'),
      loadFallback('permits.json')
    ]);
  }
  return { poles, permits };
}

export function distinctValues(arr, key){
  return Array.from(new Set((arr||[]).map(o => o?.[key]).filter(Boolean))).sort((a,b)=> String(a).localeCompare(String(b), undefined, { numeric:true }));
}

export function hashColor(name){
  // stable soft color from string
  let h=0; for (let i=0;i<name.length;i++) h=(h*31 + name.charCodeAt(i))|0;
  const hue = Math.abs(h)%360;
  return `hsl(${hue}deg 65% 55%)`;
}
