// /map3000/js/config.js

// The order of statuses matters (worst first, "NONE" last).
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

// Map a permit status to its CSS color variable.
export const statusColor = s => {
  s = String(s || '').trim();
  const gs = getComputedStyle(document.documentElement);
  if (s === 'Submitted - Pending') return gs.getPropertyValue('--chip-pending') || '#fb923c';
  if (s === 'Approved') return gs.getPropertyValue('--chip-approved') || '#34d399';
  if (s === 'Created - NOT Submitted') return gs.getPropertyValue('--chip-created') || '#facc15';
  if (s === 'Not Approved - Cannot Attach') return gs.getPropertyValue('--chip-na-cannot') || '#a78bfa';
  if (s.startsWith('Not Approved -')) return gs.getPropertyValue('--chip-na-other') || '#ef4444';
  if (s === 'NONE') return gs.getPropertyValue('--chip-none') || '#94a3b8';
  return '#94a3b8';
};

// Icon size in pixels (for markers).
export const iconSizePx = 22;

// Heatmap options.
export const heatOpts = {
  radius: 28,
  blur: 24,
  minOpacity: 0.20,
  maxZoom: 18
};

// Where to look for your JSON data.
// Includes relative paths AND absolute paths for GitHub Pages.
export const files = {
  poles: [
    'poles.json',
    './poles.json',
    '../poles.json',
    'data/poles.json',
    './data/poles.json',
    '../data/poles.json',
    '../../data/poles.json',
    '/BrownsvilleOMNIPermits/data/poles.json'
  ],
  permits: [
    'permits.json',
    './permits.json',
    '../permits.json',
    'data/permits.json',
    './data/permits.json',
    '../data/permits.json',
    '../../data/permits.json',
    '/BrownsvilleOMNIPermits/data/permits.json'
  ]
};

// Used for weighting heatmap intensity (worse statuses weigh heavier).
export const severityWeight = status => {
  const idx = STATUS_ORDER.indexOf(status);
  return idx < 0 ? 1 : 1 + (STATUS_ORDER.length - 1 - idx);
};

// Generate a unique key per pole (stable across sessions).
export const poleKey = p => `${p.job_name}::${p.tag}::${p.SCID}`;
