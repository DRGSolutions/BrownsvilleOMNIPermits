// assets/js/pending.js
import { state } from './state.js';
import { getLatestSha, loadData } from './api.js';
import { matchesPatch } from './utils.js';

let els = { panel:null, list:null, status:null };
let watcher = null;
let listRenderer = () => {};

export function initPending({ panelId, listId, statusId }) {
  els.panel = document.getElementById(panelId);
  els.list  = document.getElementById(listId);
  els.status= document.getElementById(statusId);
  render();
}

export function setListRenderer(fn) {
  listRenderer = typeof fn === 'function' ? fn : () => {};
}

function keyForPole(keys) {
  return `${keys.job_name}/${keys.tag}/${keys.SCID}`;
}

export function trackPendingChange(kind, id, keys, expected, prUrl) {
  const key = `${kind}:${id || (keys ? keyForPole(keys) : '')}`;
  state.pending.set(key, { kind, id, keys, expected, prUrl, state:'pending', started: Date.now(), appliedSha:null });
  render();
  ensureWatcher();
}

function ensureWatcher() {
  if (watcher) return;
  watcher = setInterval(checkPending, 2000);
}

async function checkPending() {
  if (state.pending.size === 0) {
    clearInterval(watcher); watcher = null; return;
  }
  let sha;
  try {
    sha = await getLatestSha();
  } catch (e) {
    // network hiccup
    return;
  }
  if (sha !== state.currentSha) {
    await loadData();
    document.getElementById('kSha').textContent = sha.slice(0,7);
    document.getElementById('kLoaded').textContent = new Date().toLocaleString();
    document.getElementById('kPoles').textContent = state.poles.length;
    document.getElementById('kPermits').textContent = state.permits.length;
  }

  let anyApplied = false;
  for (const [k, it] of [...state.pending.entries()]) {
    if (it.kind === 'pole') {
      const p = state.poles.find(x =>
        String(x.job_name) === String(it.keys.job_name) &&
        String(x.tag)      === String(it.keys.tag) &&
        String(x.SCID)     === String(it.keys.SCID)
      );
      if (p && matchesPatch(p, it.expected)) {
        it.state = 'applied'; it.appliedSha = state.currentSha;
        state.pending.delete(k);
        anyApplied = true;
      }
    } else if (it.kind === 'permit') {
      const r = state.permits.find(x => String(x.permit_id) === String(it.id));
      if (r && matchesPatch(r, it.expected)) {
        it.state = 'applied'; it.appliedSha = state.currentSha;
        state.pending.delete(k);
        anyApplied = true;
      }
    }
  }
  render();
  if (anyApplied) listRenderer();
}

function render() {
  if (!els.panel || !els.list) return;
  if (state.pending.size === 0) {
    els.panel.style.display = 'none';
    els.list.innerHTML = 'No pending changes.';
    return;
  }
  els.panel.style.display = 'block';
  els.list.innerHTML = [...state.pending.values()].map(it => {
    const secs = Math.floor((Date.now() - it.started)/1000);
    const pr = it.prUrl ? ` · <a class="link" href="${it.prUrl}" target="_blank" rel="noopener">View PR</a>` : '';
    const label = it.kind === 'pole'
      ? `Pole ${it.keys.job_name}/${it.keys.tag}/${it.keys.SCID}`
      : `Permit ${it.id}`;
    return `<div class="small">
      ${label} — <span class="chip ${it.state==='applied'?'chip-ok':'chip-warn'}">${it.state}</span>
      ${pr} · ${secs}s ${it.appliedSha ? `· in <code>${it.appliedSha.slice(0,7)}</code>` : '' }
    </div>`;
  }).join('');
}
