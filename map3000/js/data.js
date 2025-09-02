import { files, poleKey } from './config.js';

async function tryFetch(paths){
  for(const p of paths){
    try{ const r = await fetch(p); if(r.ok) return await r.json(); }catch(e){}
  }
  throw new Error('Unable to load: '+paths.join(', '));
}

export async function load(state){
  state.toast('Loading poles & permits…');
  const [poles, permits] = await Promise.all([
    tryFetch(files.poles),
    tryFetch(files.permits)
  ]);
  state.poles = (poles||[]).filter(p=>typeof p.lat==='number' && typeof p.lon==='number');
  state.permits = permits||[];

  // index permits by pole key
  const idx = new Map();
  for(const r of state.permits){
    const key=poleKey(r);
    if(!idx.has(key)) idx.set(key,[]);
    idx.get(key).push(r);
  }
  state.byKey = idx;
  state.toast(`Loaded ${state.poles.length} poles, ${state.permits.length} permits`);
}
