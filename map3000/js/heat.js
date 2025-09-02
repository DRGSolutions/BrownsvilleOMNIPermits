import { poleKey, severityWeight, heatOpts } from './config.js';
import { setMarkerVisibility } from './markers.js';

export function update(){
  const s = state;
  if(s.heat){ s.map.removeLayer(s.heat); s.heat=null; }
  const pts = s.poles.map(p=>{
    const rel=s.byKey.get(poleKey(p))||[];
    const dom = dominantStatusFor(rel);
    return [p.lat,p.lon, severityWeight(dom)];
  });
  s.heat = L.heatLayer(pts, heatOpts).addTo(s.map);
}

function dominantStatusFor(rel){
  if(!rel||!rel.length) return 'NONE';
  const s = rel.map(r=>String(r.permit_status||'').trim());
  if(s.find(x=>x.startsWith('Not Approved -'))) return s.find(x=>x.startsWith('Not Approved -'));
  if(s.includes('Submitted - Pending')) return 'Submitted - Pending';
  if(s.includes('Created - NOT Submitted')) return 'Created - NOT Submitted';
  if(s.includes('Approved')) return 'Approved';
  return 'NONE';
}

export function enter(){
  setMarkerVisibility(false);        // intentionally hide markers
  update();                           // but show strong heat layer
  // soften areas so density pops but boundaries stay visible
  state.areas.forEach(a=>a.fill.setStyle({fillOpacity:.12, opacity:.8}));
}
export function exit(){
  if(state.heat){ state.map.removeLayer(state.heat); state.heat=null; }
  setMarkerVisibility(true);
  state.areas.forEach(a=>a.fill.setStyle({fillOpacity:.25, opacity:1}));
}
