// assets/js/state.js
import { OWNER, REPO, DEFAULT_BRANCH, DATA_REPO_PATH } from './config.js';

let poles = [];
let permits = [];
let sha = null;

let watcher = null;
const refreshCallbacks = [];

/** Public getters/setters */
export function get(){ return { poles, permits, sha }; }
export function set(next){
  if ('poles'   in next) poles   = next.poles;
  if ('permits' in next) permits = next.permits;
  if ('sha'     in next) sha     = next.sha;
}

/** Subscribe to refresh events */
export function onRefresh(cb){
  if (typeof cb === 'function') refreshCallbacks.push(cb);
}

/** GitHub HEAD sha */
export async function getLatestSha(){
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/commits/${DEFAULT_BRANCH}?_=${Date.now()}`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`GitHub API ${r.status} (latest commit)`);
  const j = await r.json();
  return j.sha;
}

/** Load data from raw.githubusercontent using a specific sha (auto-discovers latest) */
export async function refreshFromGitHub(statusEl){
  const newSha = await getLatestSha();

  const base = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${newSha}/${DATA_REPO_PATH}`;
  const bust = `?ts=${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const [r1, r2] = await Promise.all([
    fetch(`${base}/poles.json${bust}`,   { cache: 'no-store' }),
    fetch(`${base}/permits.json${bust}`, { cache: 'no-store' })
  ]);
  if (!r1.ok || !r2.ok) throw new Error(`HTTP ${r1.status}/${r2.status} (poles/permits)`);

  const [j1, j2] = await Promise.all([r1.json(), r2.json()]);
  poles = j1;
  permits = j2;
  sha = newSha;

  if (statusEl) statusEl.innerHTML = `<span class="ok">Loaded from <code>${sha.slice(0,7)}</code>.</span>`;
  refreshCallbacks.forEach(cb => { try { cb({ sha, poles, permits }); } catch {} });
}

/** Start polling HEAD; refresh when it changes */
export function startWatcher(intervalMs = 2000, statusEl){
  if (watcher) return;
  watcher = setInterval(async () => {
    try {
      const latest = await getLatestSha();
      if (latest !== sha) {
        await refreshFromGitHub(statusEl);
      }
    } catch {
      // swallow polling errors
    }
  }, intervalMs);
}

export function stopWatcher(){
  if (watcher) { clearInterval(watcher); watcher = null; }
}
