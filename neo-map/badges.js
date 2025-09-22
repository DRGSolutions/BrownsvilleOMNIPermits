// neo-map/badges.js
import { poleKey, statusColor } from './data.js';

// Collapse raw statuses into the 6 legend buckets
function bucket(status) {
  const s = String(status || '').trim();
  if (s === 'Approved') return 'Approved';
  if (s === 'Submitted - Pending') return 'Submitted - Pending';
  if (s === 'Created - NOT Submitted') return 'Created - NOT Submitted';
  if (s.startsWith('Not Approved - Cannot Attach')) return 'Not Approved - Cannot Attach';
  if (s.startsWith('Not Approved -')) return 'Not Approved - Other Issues';
  return 'NONE';
}

// “Dominant” per-pole status, same priorities you use elsewhere
function dominantStatus(permits) {
  if (!permits || !permits.length) return 'NONE';
  const list = permits.map(r => String(r.permit_status || '').trim());
  const order = [
    s => s.startsWith('Not Approved - Cannot Attach'),
    s => s.startsWith('Not Approved - PLA Issues'),
    s => s.startsWith('Not Approved - MRE Issues'),
    s => s.startsWith('Not Approved - Other Issues'),
    s => s === 'Submitted - Pending',
    s => s === 'Created - NOT Submitted',
    s => s === 'Approved'
  ];
  for (const pred of order) {
    const hit = list.find(pred);
    if (hit) return hit.startsWith('Not Approved - PLA') || hit.startsWith('Not Approved - MRE') || hit.startsWith('Not Approved - Other')
      ? 'Not Approved - Other Issues'
      : hit;
  }
  return list[0] || 'NONE';
}

// Build an SVG badge (shape matches utility; ring is segmented by status mix)
function badgeSVG(owner, mix, total) {
  const W = 64, C = 32; // canvas size + center
  const R = 22;         // ring radius
  const RING_W = 8;     // ring thickness
  const circ = 2 * Math.PI * R;

  // Order segments to match legend
  const order = ['Approved', 'Submitted - Pending', 'Created - NOT Submitted', 'Not Approved - Cannot Attach', 'Not Approved - Other Issues', 'NONE'];
  const parts = order
    .map(k => ({ key: k, count: mix[k] || 0, color: statusColor(k) }))
    .filter(p => p.count > 0);

  // Build the circular ring path once; we'll use stroke-dash to segment
  const circlePath = `M ${C},${C} m -${R},0 a ${R},${R} 0 1,0 ${2*R},0 a ${R},${R} 0 1,0 -${2*R},0`;

  // Shape clip + outline (so the ring conforms to the utility silhouette)
  const ownerUpper = String(owner||'').toUpperCase();
  let clipShape = '', outlineShape = '';
  if (ownerUpper === 'AEP') {
    const tri = `${C},10 ${C+20},${C+20} ${C-20},${C+20}`;
    clipShape    = `<polygon points="${tri}"/>`;
    outlineShape = `<polygon points="${tri}" fill="none" stroke="white" stroke-width="2"/>`;
  } else if (ownerUpper === 'MVEC') {
    clipShape    = `<rect x="10" y="10" width="44" height="44" rx="7" ry="7"/>`;
    outlineShape = `<rect x="10" y="10" width="44" height="44" rx="7" ry="7" fill="none" stroke="white" stroke-width="2"/>`;
  } else { // BPUB (circle) or default
    clipShape    = `<circle cx="${C}" cy="${C}" r="24"/>`;
    outlineShape = `<circle cx="${C}" cy="${C}" r="24" fill="none" stroke="white" stroke-width="2"/>`;
  }

  // Build the segmented ring inside a clipPath
  let offset = 0;
  const segs = parts.map(p => {
    const frac = p.count / total;
    const dash = Math.max(0.0001, frac * circ);
    const path = `<path d="${circlePath}" stroke="${p.color}" stroke-width="${RING_W}" fill="none"
                     stroke-dasharray="${dash} ${circ - dash}" stroke-dashoffset="${-offset}" stroke-linecap="butt"/>`;
    offset += dash;
    return path;
  }).join('');

  // Center text
  const countText = `<text x="${C}" y="${C+4}" text-anchor="middle" font-size="14" font-weight="700" fill="#e5e7eb">${total}</text>`;

  // Unique clip id per badge
  const clipId = `clip-${Math.random().toString(36).slice(2)}`;

  return `
  <svg viewBox="0 0 ${W} ${W}" width="${W}" height="${W}" aria-hidden="true">
    <defs><clipPath id="${clipId}">${clipShape}</clipPath></defs>
    <g clip-path="url(#${clipId})">
      ${segs}
    </g>
    ${outlineShape}
    ${countText}
  </svg>`;
}

export function buildAreaBadges(map, poles, byKey) {
  // Group poles by job_name
  const groups = new Map();
  for (const p of (poles || [])) {
    if (!p || typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
    const job = p.job_name || '(unknown job)';
    if (!groups.has(job)) groups.set(job, []);
    groups.get(job).push(p);
  }

  const badges = [];
  for (const [job, pts] of groups.entries()) {
    if (!pts.length) continue;

    // centroid (simple average is fine and fast here)
    let lat = 0, lon = 0;
    const ownerCount = {};
    const mix = { 'Approved':0,'Submitted - Pending':0,'Created - NOT Submitted':0,'Not Approved - Cannot Attach':0,'Not Approved - Other Issues':0,'NONE':0 };

    for (const p of pts) {
      lat += p.lat; lon += p.lon;
      const o = String(p.owner || '').toUpperCase();
      ownerCount[o] = (ownerCount[o] || 0) + 1;

      const rel = byKey?.get(poleKey(p)) || [];
      const d = dominantStatus(rel);
      mix[bucket(d)]++;
    }
    lat /= pts.length; lon /= pts.length;

    // majority owner decides the silhouette
    const owner = Object.entries(ownerCount).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'BPUB';
    const total = pts.length;

    const html = `<div class="area-badge">${badgeSVG(owner, mix, total)}</div>`;
    const icon = L.divIcon({
      className: 'area-badge-ic',
      html,
      iconSize: [64, 64],
      iconAnchor: [32, 32]
    });

    const m = L.marker([lat, lon], { icon, interactive:false, keyboard:false, bubblingMouseEvents:false });
    m.addTo(map);
    badges.push(m);
  }
  return badges;
}
