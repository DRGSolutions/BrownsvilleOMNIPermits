import { statusColor, dominantStatusFor } from './data.js';

export function markerSVG(owner, fill, size=28){
  const stroke='#fff', sw=2, half=size/2;
  if (owner==='AEP'){ // triangle
    return `<svg viewBox="0 0 ${size} ${size}">
      <polygon points="${half},${sw} ${size-sw},${size-sw} ${sw},${size-sw}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>
    </svg>`;
  }
  if (owner==='MVEC'){ // diamond
    const r=size*0.34, cx=half, cy=half;
    return `<svg viewBox="0 0 ${size} ${size}">
      <polygon points="${cx},${cy-r} ${cx+r},${cy} ${cx},${cy+r} ${cx-r},${cy}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>
    </svg>`;
  }
  // BPUB circle
  return `<svg viewBox="0 0 ${size} ${size}">
    <circle cx="${half}" cy="${half}" r="${half-4}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>
  </svg>`;
}

export function shapeIcon(owner, color){
  return L.divIcon({ className:'shape-icon', html:markerSVG(owner,color), iconSize:[28,28], iconAnchor:[14,14], popupAnchor:[0,-12] });
}

export function buildMarkers(map, cluster, poles, byKey, popupHTML){
  cluster.clearLayers();
  let bounds=null;
  for(const p of poles){
    const rel = byKey.get(`${p.job_name}::${p.tag}::${p.SCID}`) || [];
    const status = dominantStatusFor(rel);
    const icon = shapeIcon(p.owner, statusColor(status));
    const m = L.marker([p.lat, p.lon], { icon, renderer:L.canvas() });
    m.bindPopup(popupHTML(p, rel), { maxWidth:420, minWidth:320, autoPanPaddingTopLeft:[360,110] });
    cluster.addLayer(m);
    bounds = bounds ? bounds.extend(m.getLatLng()) : L.latLngBounds(m.getLatLng(), m.getLatLng());
  }
  if (bounds) map.fitBounds(bounds.pad(0.15));
  return bounds;
}
