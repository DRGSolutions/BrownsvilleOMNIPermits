import { statusColor, hashColor } from './data.js';

let map, markersLayer, boundaryPane, boundaryLayer, jobLabelLayer;

function ensureMap(){
  if (map) return;
  map = L.map('map', { preferCanvas:true, zoomControl:false, attributionControl:false });
  L.control.zoom({ position:'bottomright' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom:20, maxNativeZoom:19, keepBuffer:6, crossOrigin:true
  }).addTo(map);
  L.control.attribution({ position:'bottomleft', prefix:false }).addTo(map);
  boundaryPane = map.createPane('boundaries');
  boundaryPane.style.mixBlendMode = 'screen';

  markersLayer = L.layerGroup().addTo(map);
  boundaryLayer = L.geoJSON(null, { pane:'boundaries' }).addTo(map);
  jobLabelLayer = L.layerGroup().addTo(map);
}

function ownerShapeSVG(owner, fill){
  const w=20,h=20;
  const stroke = '#2a3242';
  if (owner==='BPUB') {
    return `<svg width="${w}" height="${h}" viewBox="0 0 20 20">
      <circle class="ring" cx="10" cy="10" r="8" stroke="${stroke}" fill="none"></circle>
      <circle class="shape" cx="10" cy="10" r="6" stroke="${stroke}" fill="${fill}"></circle>
    </svg>`;
  }
  if (owner==='AEP') {
    return `<svg width="${w}" height="${h}" viewBox="0 0 20 20">
      <polygon class="shape" points="10,3 17,17 3,17" stroke="${stroke}" fill="${fill}"></polygon>
    </svg>`;
  }
  // MVEC = diamond
  return `<svg width="${w}" height="${h}" viewBox="0 0 20 20">
    <rect class="shape" x="6" y="6" width="8" height="8" transform="rotate(45 10 10)" stroke="${stroke}" fill="${fill}"></rect>
  </svg>`;
}

function makeIcon(owner, color, selected=false){
  const html = `<div class="pin${selected?' selected':''}">${ownerShapeSVG(owner,color)}</div>`;
  return L.divIcon({ className:'', html, iconSize:[20,20], iconAnchor:[10,10] });
}

function chipClassFor(status){
  const s=String(status||'');
  if (s==='Approved') return 'approved';
  if (s==='Submitted - Pending') return 'pending';
  if (s==='Created - NOT Submitted') return 'created';
  if (s==='Not Approved - Cannot Attach') return 'na_cannot';
  if (s.startsWith('Not Approved -')) return 'na_other';
  return 'none';
}

export function initMap(){ ensureMap(); }

export function renderLegendStatuses(statusCounts){
  const el = document.getElementById('legendStatuses');
  const entries = [
    ['Approved','--chip-approved'],
    ['Submitted - Pending','--chip-pending'],
    ['Created - NOT Submitted','--chip-created'],
    ['Not Approved - Cannot Attach','--chip-na-cannot'],
    ['Not Approved - PLA Issues','--chip-na-other'],
    ['Not Approved - MRE Issues','--chip-na-other'],
    ['Not Approved - Other Issues','--chip-na-other'],
    ['NONE','--chip-none']
  ];

  el.innerHTML = entries.map(([label,varName]) => {
    const color = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    const n = statusCounts[label] || 0;
    return `<span class="lg-item">
      <span class="lg-shape" data-shape="circle" style="background:${color}"></span>
      <span>${label} <span class="muted small">(${n})</span></span>
    </span>`;
  }).join('');
}

export function fitTo(points){
  if (!points.length) return;
  const bounds = L.latLngBounds(points);
  map.fitBounds(bounds, { padding:[40,40] });
}

export function drawMarkers(poleCtxList){
  markersLayer.clearLayers();
  const pts=[];
  for(const ctx of poleCtxList){
    const p = ctx.pole;
    const status = ctx.latestStatus;
    const color = statusColor(status);
    const icon  = makeIcon(p.owner, color);
    const m = L.marker([+p.lat, +p.lon], { icon, keyboard:false });
    m.on('click', ()=> window.dispatchEvent(new CustomEvent('ui:pole-click',{ detail: ctx })));
    m.addTo(markersLayer);
    pts.push([+p.lat, +p.lon]);
  }
  if (pts.length) fitTo(pts);
}

export function drawJobBoundaries(groups, show=true){
  boundaryLayer.clearLayers();
  jobLabelLayer.clearLayers();
  if (!show) return;

  const features=[];
  for (const [jobName, pts] of groups){
    if (pts.length===1){
      // tiny buffer circle-ish via turf: point->buffer
      const poly = turf.buffer(turf.point([pts[0][1], pts[0][0]]), 0.03, { units:'kilometers' });
      features.push({ jobName, feature: poly });
      continue;
    }

    const fc = turf.featureCollection( pts.map(([lat,lon]) => turf.point([lon,lat])) );
    let hull = turf.concave(fc, { maxEdge: 0.6, units:'kilometers' });
    if (!hull) hull = turf.convex(fc);
    if (!hull) continue;
    // smooth edges a touch
    const buffered = turf.buffer(hull, 0.04, { units:'kilometers' });
    const simplified = turf.simplify(buffered, { tolerance: 0.0006, highQuality:true });
    features.push({ jobName, feature: simplified });
  }

  for(const { jobName, feature } of features){
    const fill = hashColor(jobName);
    const poly = L.geoJSON(feature, {
      pane:'boundaries',
      style: {
        color: fill,
        weight: 2,
        opacity: 0.85,
        dashArray: '4,3',
        fillColor: fill,
        fillOpacity: 0.12
      }
    }).addTo(boundaryLayer);

    const center = turf.centerOfMass(feature).geometry.coordinates;
    const label = L.marker([center[1], center[0]], {
      icon: L.divIcon({ className:'', html:`<div class="job-label">${jobName}</div>` })
    }).addTo(jobLabelLayer);
    poly.bindTooltip(jobName, { sticky:true, opacity:0.7 });
  }
}
