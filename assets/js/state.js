// assets/js/state.js
export const state = {
  poles: [],
  permits: [],
  currentSha: null,
  pending: new Map(), // key -> {kind,id,keys,expected,prUrl,state,started,appliedSha}
};

export function jobsForUtility(util) {
  const set = new Set(
    state.poles.filter(p => !util || p.owner === util).map(p => p.job_name)
  );
  return Array.from(set).sort();
}

export function polesFor(util, job) {
  return state.poles.filter(p =>
    (!util || p.owner === util) && (!job || p.job_name === job)
  );
}

export function getPermitsForPole(pole) {
  const j = String(pole.job_name), t = String(pole.tag), s = String(pole.SCID);
  return state.permits.filter(r =>
    String(r.job_name) === j && String(r.tag) === t && String(r.SCID) === s
  );
}

export function getPermitById(id) {
  return state.permits.find(r => String(r.permit_id) === String(id));
}
