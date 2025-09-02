// /map3000/js/data.js — hardened loader (forces /data on GitHub Pages, then falls back)
import { poleKey } from './config.js';

// Derive the repo root for GitHub Pages, e.g. "/BrownsvilleOMNIPermits"
function repoRoot() {
  // pathname like: "/BrownsvilleOMNIPermits/map3000/index.html"
  const parts = (location.pathname || '/').split('/').filter(Boolean);
  return parts.length ? `/${parts[0]}` : '';
}

// Build a robust candidate list for a given filename
function candidates(filename) {
  const root = repoRoot(); // "/BrownsvilleOMNIPermits"
  const bust = `?v=${Date.now()}`;

  // Absolute GH Pages first (most reliable for your setup)
  const abs = [
    `${root}/data/${filename}`,
    `${root}/data/${filename}${bust}`,
    // case variants just in case the file was committed with different case
    `${root}/data/${filename.toUpperCase()}`,
    `${root}/data/${filename.toUpperCase()}${bust}`,
    `${root}/Data/${filename}`,
    `${root}/DATA/${filename}`,
  ];

  // Relatives from /map3000/
  const rel = [
    `data/${filename}`,
    `./data/${filename}`,
    `../data/${filename}`,
    `../../data/${filename}`,
    filename,
    `./${filename}`,
    `../${filename}`,
  ];

  // De-dupe while keeping order
  const seen = new Set();
  return [...abs, ...rel].filter(p => (seen.has(p) ? false : (seen.add(p), true)));
}

// Try each URL in order until one loads JSON successfully.
async function tryFetchList(paths) {
  const errors = [];
  for (const url of paths) {
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      if (r.ok) {
        // Confirm it’s JSON (GitHub Pages returns HTML for 404s)
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        if (!ct.includes('application/json') && !url.endsWith('.json')) {
          errors.push(`${url} (non-JSON content-type: ${ct || 'n/a'})`);
          continue;
        }
        const data = await r.json();
        console.info('[data] loaded:', url);
        return data;
      } else {
        errors.push(`${url} (HTTP ${r.status})`);
      }
    } catch (e) {
      errors.push(`${url} (${e?.message || 'fetch error'})`);
    }
  }
  throw new Error('Unable to load any JSON from:\n- ' + errors.join('\n- '));
}

export async function load(state) {
  state.toast('Loading poles & permits…');

  const polePaths    = candidates('poles.json');
  const permitsPaths = candidates('permits.json');

  // Load both in parallel
  const [polesRaw, permitsRaw] = await Promise.all([
    tryFetchList(polePaths),
    tryFetchList(permitsPaths),
  ]);

  // Sanitize
  const poles = Array.isArray(polesRaw) ? polesRaw : [];
  const permits = Array.isArray(permitsRaw) ? permitsRaw : [];

  state.poles = poles.filter(p => typeof p.lat === 'number' && typeof p.lon === 'number');
  state.permits = permits;

  // Index permits by pole key
  const idx = new Map();
  for (const r of state.permits) {
    const key = poleKey(r);
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push(r);
  }
  state.byKey = idx;

  state.toast(`Loaded ${state.poles.length} poles, ${state.permits.length} permits`);
}
