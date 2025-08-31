// assets/js/state.js
export const state = {
  poles: [],
  permits: [],
  currentSha: null,
  pending: new Map() // key -> { kind, id, keys, expected, prUrl, state, started, appliedSha }
};

export function setData({ poles, permits, sha }) {
  if (Array.isArray(poles))   state.poles = poles;
  if (Array.isArray(permits)) state.permits = permits;
  if (sha) state.currentSha = sha;
}

export function poleKey(p) {
  return `${String(p.job_name||'').trim()}::${String(p.tag||'').trim()}::${String(p.SCID||'').trim()}`;
}

export function getPermitsForPole(keys) {
  return state.permits.filter(r =>
    String(r.job_name) === String(keys.job_name) &&
    String(r.tag)      === String(keys.tag) &&
    String(r.SCID)     === String(keys.SCID)
  );
}

export function jobsForUtility(util) {
  const s = new Set(
    state.poles.filter(p => !util || p.owner === util).map(p => p.job_name)
  );
  return Array.from(s).sort();
}

export function polesFor(util, job) {
  return state.poles.filter(p =>
    (!util || p.owner === util) &&
    (!job  || p.job_name === job)
  );
}
