import { CONFIG } from './config.js';

/*
CONFIG supports BOTH local paths and GitHub-by-SHA.

If you set (e.g. in index.html before modules load):
  <script>
    window.APP_CONFIG = {
      OWNER: 'DRGSolutions',
      REPO: 'BrownsvilleOMNIPermits',
      DEFAULT_BRANCH: 'main',
      DATA_DIR: 'data'
    };
  </script>

…then we’ll fetch:
  1) SHA via GitHub API:
     https://api.github.com/repos/OWNER/REPO/contents/DATA_DIR/poles.json?ref=DEFAULT_BRANCH
  2) Raw by immutable SHA:
     https://raw.githubusercontent.com/OWNER/REPO/SHA/DATA_DIR/poles.json

Fallbacks (if GH API fails or not configured):
  - Try CONFIG.DATA_PATHS locally (same-origin)
*/

const GH = (() => {
  const g = (window.APP_CONFIG || window.CONFIG || {});
  const has = !!(g.OWNER && g.REPO && g.DEFAULT_BRANCH && g.DATA_DIR);
  return has ? {
    OWNER: g.OWNER,
    REPO: g.REPO,
    BRANCH: g.DEFAULT_BRANCH,
    DIR: (g.DATA_DIR || 'data').replace(/^\/+|\/+$/g,'')
  } : null;
})();

async function fetchJSON(url, headers = {}) {
  const res = await fetch(url, { cache: 'no-store', headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} @ ${url}`);
  return res.json();
}

async function getFileSHA(file) {
  // GitHub Contents API returns blob SHA for a path at a ref (branch)
  // Example:
  //  https://api.github.com/repos/OWNER/REPO/contents/data/poles.json?ref=main
  const url = `https://api.github.com/repos/${GH.OWNER}/${GH.REPO}/contents/${GH.DIR}/${file}?ref=${encodeURIComponent(GH.BRANCH)}`;
  const j = await fetchJSON(url, { 'Accept': 'application/vnd.github+json' });
  if (!j || !j.sha) throw new Error(`No SHA for ${file}`);
  return j.sha;
}

async function loadBySHA(file, sha) {
  const raw = `https://raw.githubusercontent.com/${GH.OWNER}/${GH.REPO}/${sha}/${GH.DIR}/${file}`;
  return fetchJSON(raw);
}

async function tryLocal(paths, file) {
  for (const base of paths) {
    const url = base.endsWith('/') ? base + file : `${base}/${file}`;
    try { return await fetchJSON(url); } catch (e) { /* continue */ }
  }
  throw new Error(`Could not load ${file} from ${paths.join(', ')}`);
}

// Public: load both JSONs (prefers GitHub SHA when configured)
export async function loadPolesAndPermits() {
  let poles, permits, shas = { poles:null, permits:null };

  if (GH) {
    try {
      const [shaPoles, shaPermits] = await Promise.all([ getFileSHA('poles.json'), getFileSHA('permits.json') ]);
      shas = { poles: shaPoles, permits: shaPermits };
      [poles, permits] = await Promise.all([ loadBySHA('poles.json', shaPoles), loadBySHA('permits.json', shaPermits) ]);
      return finalize({ poles, permits, shas, source: 'github-sha' });
    } catch (e) {
      console.warn('[neo-map] GH SHA load failed, falling back to local paths:', e?.message);
    }
  }

  // Fallback to local/same-origin paths (fast dev)
  const polesLocal   = await tryLocal(CONFIG.DATA_PATHS, 'poles.json');
  const permitsLocal = await tryLocal(CONFIG.DATA_PATHS, 'permits.json');
  return finalize({ poles: polesLocal, permits: permitsLocal, shas, source: 'local' });
}

function finalize({ poles, permits, shas, source }) {
  const polesClean = (poles || []).filter(p => typeof p.lat === 'number' && typeof p.lon === 'number');
  const byKey = buildPermitIndex(permits || []);
  return { poles: polesClean, permits: permits || [], byKey, shas, source };
}

function buildPermitIndex(permits) {
  const m = new Map();
  for (const r of (permits || [])) {
    const k = `${r.job_name}::${r.tag}::${r.SCID}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  for (const arr of m.values()) arr.sort((a,b)=> String(a.permit_id).localeCompare(String(b.permit_id)));
  return m;
}

/* -----------------------
   SHA Watcher (hot load)
   -----------------------
   Polls GitHub for the file SHAs at interval; when either changes,
   re-loads both files via SHA and invokes onChange with the fresh data.
*/
export function watchForGithubUpdates(onChange, intervalMs = 60000) {
  if (!GH) return () => {}; // no-op if not configured

  let alive = true;
  let last = { poles: null, permits: null };

  async function tick() {
    if (!alive) return;
    try {
      const [shaPoles, shaPermits] = await Promise.all([ getFileSHA('poles.json'), getFileSHA('permits.json') ]);
      const changed = (last.poles && last.poles !== shaPoles) || (last.permits && last.permits !== shaPermits) || (!last.poles && !last.permits);
      last = { poles: shaPoles, permits: shaPermits };
      if (changed) {
        const [poles, permits] = await Promise.all([ loadBySHA('poles.json', shaPoles), loadBySHA('permits.json', shaPermits) ]);
        onChange(finalize({ poles, permits, shas: last, source: 'github-sha' }));
      }
    } catch (e) {
      // silent; next tick will retry
      console.warn('[neo-map] SHA watcher tick failed:', e?.message);
    } finally {
      if (alive) setTimeout(tick, intervalMs);
    }
  }

  // kick off
  tick();

  // return stop function
  return () => { alive = false; };
}

/* status helpers used elsewhere */
export const poleKey = p => `${p.job_name}::${p.tag}::${p.SCID}`;

export function statusColor(status){
  const s = String(status||'').trim();
  const css = k => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
  if (s==='Approved') return css('--chip-approved') || '#34d399';
  if (s==='Submitted - Pending') return css('--chip-pending') || '#fb923c';
  if (s==='Created - NOT Submitted') return css('--chip-created') || '#facc15';
  if (s==='Not Approved - Cannot Attach') return css('--chip-na-cannot') || '#a78bfa';
  if (s.startsWith('Not Approved -')) return css('--chip-na-other') || '#ef4444';
  return css('--chip-none') || '#94a3b8';
}

export function dominantStatusFor(permits){
  if(!permits || !permits.length) return 'NONE';
  const ss = permits.map(r => String(r.permit_status||'').trim());
  const pri = [
    'Not Approved - Cannot Attach','Not Approved - PLA Issues','Not Approved - MRE Issues','Not Approved - Other Issues',
    'Submitted - Pending','Created - NOT Submitted','Approved'
  ];
  for (const p of pri){
    if (p.includes('Not Approved -')){
      if (ss.some(s=>s.startsWith('Not Approved -'))) return ss.find(s=>s.startsWith('Not Approved -'));
    } else if (ss.includes(p)) return p;
  }
  return ss[0] || 'NONE';
}

export function hashColor(s){
  let h=0; for(let i=0;i<s.length;i++) h=(h*31 + s.charCodeAt(i))>>>0;
  return `hsl(${h%360} 70% 50%)`;
}
