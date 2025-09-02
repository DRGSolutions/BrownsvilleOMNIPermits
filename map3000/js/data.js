// /map3000/js/data.js — robust cross-repo loader
import { files, ABSOLUTE_OVERRIDES, poleKey } from './config.js';

function repoRootFromPages() {
  // e.g. "/BrownsvilleOMNIPermits/map3000/index.html" -> "/BrownsvilleOMNIPermits"
  const parts = (location.pathname || '/').split('/').filter(Boolean);
  return parts.length ? `/${parts[0]}` : '';
}
function ghUserFromHost() {
  // "drgsolutions.github.io" -> "drgsolutions"
  const h = (location.host || '').toLowerCase();
  const m = h.match(/^([^\.]+)\.github\.io$/);
  return m ? m[1] : '';
}

// Build candidate URLs for a filename, trying (in order):
// 1) Absolute overrides
// 2) Same-repo GitHub Pages /<repo>/data/<file>
// 3) Sibling "data" repo Pages: https://<user>.github.io/data/<file> and a couple of variants
// 4) Raw GitHub content: owner guessed from host; repo guesses; branches main/master/gh-pages
function candidates(filename) {
  const urls = [];
  const bust = `?v=${Date.now()}`;
  const root = repoRootFromPages();             // "/BrownsvilleOMNIPermits"
  const user = ghUserFromHost();                // "drgsolutions"
  const owner = user || 'DRGSolutions';         // best guess
  const thisRepo = root.replace(/^\//,'') || 'BrownsvilleOMNIPermits';

  // 1) Explicit overrides (use first)
  const ov = ABSOLUTE_OVERRIDES && ABSOLUTE_OVERRIDES[filename.replace('.json','')];
  if (ov) urls.push(ov, ov + bust);

  // 2) Same-repo GitHub Pages path
  urls.push(`${root}/data/${filename}`, `${root}/data/${filename}${bust}`);

  // 3) Sibling "data" repo on Pages (most likely if you said “data repository”)
  if (user) {
    urls.push(
      `https://${user}.github.io/data/${filename}`,
      `https://${user}.github.io/data/${filename}${bust}`,
      `https://${user}.github.io/BrownsvilleData/${filename}`,
      `https://${user}.github.io/BrownsvilleData/${filename}${bust}`,
      `https://${user}.github.io/${thisRepo}-data/${filename}`,
      `https://${user}.github.io/${thisRepo}-data/${filename}${bust}`
    );
  }

  // 4) Raw GitHub guesses
  const repos = [
    thisRepo,                   // BrownsvilleOMNIPermits
    'data',                     // data
    'BrownsvilleData',          // BrownsvilleData
    `${thisRepo}-data`          // BrownsvilleOMNIPermits-data
  ];
  const branches = ['main','master','gh-pages'];
  repos.forEach(r => branches.forEach(br => {
    urls.push(
      `https://raw.githubusercontent.com/${owner}/${r}/${br}/data/${filename}`,   // /data/<file> in repo
      `https://raw.githubusercontent.com/${owner}/${r}/${br}/${filename}`        // root-level <file>
    );
  }));

  // finally, local relatives (for local dev)
  urls.push(
    'data/'+filename, './data/'+filename, '../data/'+filename, '../../data/'+filename,
    filename, './'+filename, '../'+filename
  );

  // de-dupe while preserving order
  const seen = new Set();
  return urls.filter(u => (seen.has(u) ? false : (seen.add(u), true)));
}

async function tryFetchList(paths) {
  const errors = [];
  for (const url of paths) {
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      if (!r.ok) { errors.push(`${url} (HTTP ${r.status})`); continue; }
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      if (!ct.includes('application/json') && !url.endsWith('.json')) {
        errors.push(`${url} (non-JSON content-type: ${ct || 'n/a'})`); continue;
      }
      const data = await r.json();
      console.info('[data] loaded:', url);
      return data;
    } catch (e) {
      errors.push(`${url} (${e?.message || 'fetch error'})`);
    }
  }
  throw new Error('Unable to load any JSON from:\n- ' + errors.join('\n- '));
}

export async function load(state) {
  state.toast('Loading poles & permits…');

  const polesPaths    = candidates('poles.json');
  const permitsPaths  = candidates('permits.json');

  const [polesRaw, permitsRaw] = await Promise.all([
    tryFetchList(polesPaths),
    tryFetchList(permitsPaths),
  ]);

  state.poles   = Array.isArray(polesRaw)    ? polesRaw.filter(p => typeof p.lat==='number' && typeof p.lon==='number') : [];
  state.permits = Array.isArray(permitsRaw)  ? permitsRaw : [];

  const idx = new Map();
  for (const r of state.permits) {
    const key = poleKey(r);
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push(r);
  }
  state.byKey = idx;

  state.toast(`Loaded ${state.poles.length} poles, ${state.permits.length} permits`);
}
