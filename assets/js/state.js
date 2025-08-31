// assets/js/state.js
import { OWNER, REPO, DEFAULT_BRANCH, DATA_REPO_DIR } from './config.js';

let _state = {
  poles: [],
  permits: [],
  sha: null
};

export function get(){ return _state; }
export function set(p){ _state = { ..._state, ...p }; }

/**
 * Fetch latest commit SHA for the default branch,
 * then fetch poles/permits from that exact commit (cache-safe).
 */
export async function refreshFromGitHub(statusEl){
  try{
    if (statusEl) statusEl.textContent = 'Loading…';

    // Latest commit on branch
    const sha = await latestSha();
    const base = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${sha}/${DATA_REPO_DIR}`;
    const bust = `?ts=${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const [pRes, rRes] = await Promise.all([
      fetch(`${base}/poles.json${bust}`,   { cache:'no-store' }),
      fetch(`${base}/permits.json${bust}`, { cache:'no-store' })
    ]);

    if (!pRes.ok || !rRes.ok) {
      // Show explicit error
      const msg = `HTTP ${pRes.status}/${rRes.status} fetching data files`;
      if (statusEl) statusEl.innerHTML = `<span class="err">${msg}</span>`;
      throw new Error(msg);
    }

    const [poles, permits] = await Promise.all([pRes.json(), rRes.json()]);
    set({ poles, permits, sha });

    if (statusEl) statusEl.innerHTML = `<span class="ok">Loaded from commit <code>${sha.slice(0,7)}</code>.</span>`;
  }catch(e){
    console.error('refreshFromGitHub failed:', e);
    if (statusEl) statusEl.innerHTML = `<span class="err">${e.message}</span>`;
  }
}

async function latestSha(){
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/commits/${DEFAULT_BRANCH}?_=${Date.now()}`;
  const r = await fetch(url, { cache:'no-store' });
  if (!r.ok) {
    // Try to show GitHub rate limit body if present
    let msg = `GitHub API ${r.status}`;
    try { const j = await r.json(); if (j && j.message) msg += `: ${j.message}`; } catch {}
    throw new Error(msg);
  }
  const j = await r.json();
  if (!j || !j.sha) throw new Error('Could not read latest commit SHA');
  return j.sha;
}
