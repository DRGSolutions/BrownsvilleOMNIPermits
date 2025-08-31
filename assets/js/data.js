// assets/js/data.js
// Centralized data loader + change watcher.

import { OWNER, REPO, BRANCH, DATA_DIR } from './config.js';

const RAW_BASE = (ref) =>
  `https://raw.githubusercontent.com/${OWNER}/${REPO}/${ref}/${DATA_DIR}`;

let state = {
  poles: [],
  permits: [],
  lastLoadedAt: null,
  lastRef: BRANCH,
  meta: {
    etag: { poles: null, permits: null },
    lastModified: { poles: null, permits: null },
  },
};

let watcherTimer = null;

/** Utility to build a cache-busting URL for a data file */
function fileUrl(ref, filename, bust = true) {
  const ts = bust ? `?ts=${Date.now()}-${Math.random().toString(36).slice(2)}` : '';
  return `${RAW_BASE(ref)}/${filename}${ts}`;
}

/** HEAD the raw file to read ETag/Last-Modified without downloading body */
async function headTag(ref, filename) {
  const r = await fetch(fileUrl(ref, filename, true), {
    method: 'HEAD',
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`HEAD ${filename} ${r.status}`);
  return {
    etag: r.headers.get('etag'),
    lastModified: r.headers.get('last-modified'),
  };
}

/** GET and parse JSON; also record ETag/Last-Modified from this fetch */
async function fetchJSON(ref, filename) {
  const r = await fetch(fileUrl(ref, filename, true), {
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`${filename} ${r.status}`);
  const etag = r.headers.get('etag');
  const lastModified = r.headers.get('last-modified');
  const json = await r.json();
  return { json, etag, lastModified };
}

/** Load both files (poles & permits) pinned to a ref (default: BRANCH) */
export async function loadData(ref = BRANCH) {
  const [p1, p2] = await Promise.all([
    fetchJSON(ref, 'poles.json'),
    fetchJSON(ref, 'permits.json'),
  ]);

  state.poles = Array.isArray(p1.json) ? p1.json : [];
  state.permits = Array.isArray(p2.json) ? p2.json : [];
  state.lastLoadedAt = new Date();
  state.lastRef = ref;
  state.meta.etag.poles = p1.etag;
  state.meta.etag.permits = p2.etag;
  state.meta.lastModified.poles = p1.lastModified;
  state.meta.lastModified.permits = p2.lastModified;

  return getState();
}

/** Provide an immutable snapshot of current state */
export function getState() {
  return JSON.parse(JSON.stringify(state));
}

/** Start polling raw files; on change => reload & invoke onChange() */
export function startWatcher(onChange, { intervalMs = 5000 } = {}) {
  stopWatcher();
  watcherTimer = setInterval(async () => {
    try {
      const [t1, t2] = await Promise.all([
        headTag(BRANCH, 'poles.json'),
        headTag(BRANCH, 'permits.json'),
      ]);

      const changed =
        t1.etag !== state.meta.etag.poles ||
        t2.etag !== state.meta.etag.permits ||
        t1.lastModified !== state.meta.lastModified.poles ||
        t2.lastModified !== state.meta.lastModified.permits;

      if (changed) {
        await loadData(BRANCH);
        if (typeof onChange === 'function') onChange(getState());
      }
    } catch (e) {
      // Network hiccup; keep watching silently.
      // console.warn('watcher:', e);
    }
  }, intervalMs);
}

/** Stop polling */
export function stopWatcher() {
  if (watcherTimer) {
    clearInterval(watcherTimer);
    watcherTimer = null;
  }
}
