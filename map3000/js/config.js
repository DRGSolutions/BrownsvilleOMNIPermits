export const STATUS_ORDER = [
  'Not Approved - Cannot Attach',
  'Not Approved - PLA Issues',
  'Not Approved - MRE Issues',
  'Not Approved - Other Issues',
  'Submitted - Pending',
  'Created - NOT Submitted',
  'Approved',
  'NONE'
];

export const statusColor = s => {
  s = String(s||'').trim();
  const gs = getComputedStyle(document.documentElement);
  if (s==='Submitted - Pending') return gs.getPropertyValue('--chip-pending')||'#fb923c';
  if (s==='Approved') return gs.getPropertyValue('--chip-approved')||'#34d399';
  if (s==='Created - NOT Submitted') return gs.getPropertyValue('--chip-created')||'#facc15';
  if (s==='Not Approved - Cannot Attach') return gs.getPropertyValue('--chip-na-cannot')||'#a78bfa';
  if (s.startsWith('Not Approved -')) return gs.getPropertyValue('--chip-na-other')||'#ef4444';
  if (s==='NONE') return gs.getPropertyValue('--chip-none')||'#94a3b8';
  return gs.getPropertyValue('--chip-none')||'#94a3b8';
};

export const iconSizePx = 22;               // smaller shapes
export const heatOpts  = { radius:28, blur:24, minOpacity:.20, maxZoom:18 };

export const files = {
  poles:   ['poles.json','./poles.json','../poles.json','data/poles.json','./data/poles.json'],
  permits: ['permits.json','./permits.json','../permits.json','data/permits.json','./data/permits.json']
};

export const severityWeight = status => {
  const order = STATUS_ORDER;
  const idx = order.indexOf(status);
  return idx < 0 ? 1 : 1 + (order.length - 1 - idx); // worst → heaviest
};

export const poleKey = p => `${p.job_name}::${p.tag}::${p.SCID}`;
