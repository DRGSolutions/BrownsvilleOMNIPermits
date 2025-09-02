// /map3000/js/heat.js — simple severity-weighted heatmap
import { poleKey, severityWeight } from './config.js';

function dominantStatus(rel){
  if (!rel || !rel.length) return 'NONE';
  const ss = rel.map(r => String(r.permit_status||'').trim());
  const na = ss.find(x=>x.startsWith('Not Approved -')); if (na) return na;
  if (ss.includes('Submitted - Pending')) return 'Submitted - Pending';
  if (ss.includes('Created - NOT Submitted')) return 'Created - NOT Submitted';
  if (ss.includes('Approved')) return 'Approved';
  return 'NONE';
}

export function enter(){
  const s = state;
  if (s.heat) { s.map.removeLayer(s.heat); s.heat = null; }
  const pts = s.poles.map(p=>{
    const rel = s.byKey.get(poleKey(p)) || [];
    const st  = dominantStatus(rel);
    return [p.lat, p.lon, severityWeight(st)];
  });
  s.heat = L.heatLayer(pts, { radius:28, blur:24, minOpacity:.20, maxZoom:18 }).addTo(s.map);
  s.areas.forEach(a => a.layer && a.layer.setStyle({ fillOpacity: 0.16, opacity: 0.9 }));
}

export function exit(){
  const s = state;
  if (s.heat){ s.map.removeLayer(s.heat); s.heat = null; }
}
