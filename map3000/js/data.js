// /map3000/js/data.js
import { files, poleKey } from './config.js';

/** Try each URL in order until one loads; returns parsed JSON. */
async function tryFetch(paths) {
  for (const p of paths) {
    try {
      const r = await fetch(p, { cache: 'no-cache' });
      if (r.ok) {
        console.info('[data] loaded:', p);
        return await r.json();
      }
    } catch (e) {
      // ignore and continue
    }
  }
  throw new Error('Unable to load: ' + paths.join(', '));
}

/** Build a path list with smart fallbacks for GitHub Pages (/repoRoot/data/...). */
function withFallbacks(list, filename) {
  const extra = [
    `../data/${filename}`,
    `../../data/${filename}`,
    // absolute path for GitHub Pages (repo root). Adjust if your repo name changes.
    `/BrownsvilleOMNIPermits/data/${filename}`,
  ];
  // De-duplicate while preserving order
  const seen = new Set();
  const all = [...(list || []), ...extra].filter(p => {
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });
  return all;
}

export async function load(state) {
  state.toast('Loading poles & permits…');

  // Build robust search lists for both files
  const polePaths    = withFallbacks(files?.poles || [], 'poles.json');
  const permitsPaths = withFallbacks(files?.permits || [], 'permits.json');

  // Load both in parallel
  const [poles, permits] = await Promise.all([
    tryFetch(polePaths),
    tryFetch(permitsPaths),
  ]);

  // Basic sanitization
  state.poles = (poles || []).filter(p => typeof p.lat === 'number' && typeof p.lon === 'number');
  state.permits = permits || [];

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
