// assets/js/data.js
import { OWNER, REPO, BRANCH, DATA_DIR, WATCH_INTERVAL_MS } from './config.js';

const state = {
  poles: [],
  permits: [],
  sha: null,            // null when we’re in fallback mode
  lastLoadedAt: null,
};

const RAW = (ref) => `https://raw.githubusercontent.com/${OWNER}/${REPO}/${ref}/${DATA_DIR}`;

async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url.split('?')[0]}`);
  return r.json();
}

async function getLatestShaSafe() {
  try {
    const url = `https://api.github.com/repos/${OWNER}/${REPO}/commits/${BRANCH}?_=${Date.now()}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`GitHub API ${r.status}`);
    const j = await r.json();
    return j.sha;
  } catch (_) {
    return null; // fallback mode
  }
}

export async function loadData() {
  const sha = await getLatestShaSafe();       // may be null (fallback)
  const ref = sha || BRANCH;
  const bust = `?ts=${Date.now()}`;

  const base = RAW(ref);
  const [poles, permits] = await Promise.all([
    fetchJSON(`${base}/poles.json${bust}`),
    fetchJSON(`${base}/permits.json${bust}`)
  ]);

  state.poles = poles;
  state.permits = permits;
  state.sha = sha;                            // null in fallback mode
  state.lastLoadedAt = new Date();
  return state;
}

export function getState() { return state; }

export function startWatcher(onChange) {
  let lastSha = state.sha; // null means fallback

  async function tick() {
    try {
      const sha = await getLatestShaSafe();
      if (sha) {
        // SHA-aware mode
        if (lastSha && sha === lastSha) return;
        lastSha = sha;
        await loadData();
        onChange?.(state);
        return;
      }
      // Fallback mode: force reload and detect changes in length (cheap heuristic)
      const sigBefore = `${state.poles.length}/${state.permits.length}`;
      await loadData();
      const sigAfter = `${state.poles.length}/${state.permits.length}`;
      if (sigBefore !== sigAfter) onChange?.(state);
    } catch (e) {
      // Keep the watcher alive; surface errors in console
      console.warn('watcher:', e.message || e);
    }
  }

  const id = setInterval(tick, WATCH_INTERVAL_MS);
  return () => clearInterval(id);
}
