// /map3000/js/data.js — repo-root-first loader (GitHub Pages + local)
import { poleKey } from './config.js';

function repoRootFromPages(){
  const parts = (location.pathname || '/').split('/').filter(Boolean);
  return parts.length ? `/${parts[0]}` : '';
}

function candidates(filename){
  const root = repoRootFromPages();   // "/BrownsvilleOMNIPermits"
  const bust = `?v=${Date.now()}`;

  const abs = [ `${root}/data/${filename}`, `${root}/data/${filename}${bust}` ];
  const rel = [
    `data/${filename}`, `./data/${filename}`, `../data/${filename}`, `../../data/${filename}`,
    filename, `./${filename}`, `../${filename}`
  ];
  const seen = new Set();
  return [...abs, ...rel].filter(u => (seen.has(u) ? false : (seen.add(u), true)));
}

async function tryFetchList(urls){
  const notes=[];
  for (const url of urls){
    try{
      const r = await fetch(url, { cache:'no-cache' });
      if (!r.ok){ notes.push(`${url} (HTTP ${r.status})`); continue; }
      const ct=(r.headers.get('content-type')||'').toLowerCase();
      if (!ct.includes('application/json') && !url.endsWith('.json')){ notes.push(`${url} (non-JSON: ${ct||'n/a'})`); continue; }
      const data = await r.json();
      console.info('[data] loaded:', url);
      return data;
    }catch(e){ notes.push(`${url} (${e?.message||'fetch error'})`); }
  }
  throw new Error('Unable to load any JSON from:\n- ' + notes.join('\n- '));
}

export async function load(state){
  state.toast('Loading poles & permits…');
  const [polesRaw, permitsRaw] = await Promise.all([
    tryFetchList(candidates('poles.json')),
    tryFetchList(candidates('permits.json')),
  ]);
  state.poles   = Array.isArray(polesRaw)   ? polesRaw.filter(p => typeof p.lat==='number' && typeof p.lon==='number') : [];
  state.permits = Array.isArray(permitsRaw) ? permitsRaw : [];

  const idx = new Map();
  for (const r of state.permits){
    const key = poleKey(r);
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push(r);
  }
  state.byKey = idx;

  state.toast(`Loaded ${state.poles.length} poles, ${state.permits.length} permits`);
}
