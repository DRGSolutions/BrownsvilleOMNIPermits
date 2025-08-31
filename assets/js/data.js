// assets/js/data.js
// Loads poles/permits from the repo and builds handy indexes.
// Exposes a small DATA API the UI can use.

(() => {
  const CFG = (window.APP_CONFIG || {});
  const STATE = {
    poles: [],
    permits: [],
    commitSha: null,
    lastLoaded: null,

    // indexes
    jobs: new Map(),         // job_name -> { poles:[], permits:[] }
    permitsById: new Map(),  // permit_id -> permit
  };

  function groupAndIndex() {
    STATE.jobs.clear();
    STATE.permitsById.clear();

    for (const p of STATE.poles) {
      const j = String(p.job_name || '').trim();
      if (!STATE.jobs.has(j)) STATE.jobs.set(j, { poles: [], permits: [] });
      STATE.jobs.get(j).poles.push(p);
    }

    for (const r of STATE.permits) {
      const j = String(r.job_name || '').trim();
      if (!STATE.jobs.has(j)) STATE.jobs.set(j, { poles: [], permits: [] });
      STATE.jobs.get(j).permits.push(r);
      STATE.permitsById.set(String(r.permit_id), r);
    }
  }

  async function getLatestSha() {
    const url = `https://api.github.com/repos/${CFG.OWNER}/${CFG.REPO}/commits/${CFG.DEFAULT_BRANCH}?_=${Date.now()}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`GitHub API ${r.status}`);
    const j = await r.json();
    return j.sha;
  }

  async function loadData() {
    const sha = await getLatestSha();
    STATE.commitSha = sha;

    const base = `https://raw.githubusercontent.com/${CFG.OWNER}/${CFG.REPO}/${sha}/${CFG.DATA_REPO_PATH}`;
    const bust = `?ts=${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const [r1, r2] = await Promise.all([
      fetch(`${base}/poles.json${bust}`,   { cache: 'no-store' }),
      fetch(`${base}/permits.json${bust}`, { cache: 'no-store' })
    ]);
    if (!r1.ok || !r2.ok) throw new Error(`HTTP ${r1.status}/${r2.status}`);

    STATE.poles   = await r1.json();
    STATE.permits = await r2.json();
    STATE.lastLoaded = new Date();

    groupAndIndex();
    if (window.UI && window.UI.onDataLoaded) window.UI.onDataLoaded(STATE);
  }

  // Helper lookups ----------
  function getJobNamesFilteredByOwner(owner) {
    // If owner provided, include only jobs that have at least one pole with that owner
    const out = new Set();
    for (const [job, obj] of STATE.jobs.entries()) {
      if (!owner) { out.add(job); continue; }
      if ((obj.poles || []).some(p => String(p.owner) === String(owner))) out.add(job);
    }
    return [...out].sort();
  }

  function polesFiltered({ owner = '', job_name = '', q = '' }) {
    const Q = (q || '').toLowerCase().trim();
    return STATE.poles.filter(p => {
      if (owner && String(p.owner) !== String(owner)) return false;
      if (job_name && String(p.job_name) !== String(job_name)) return false;
      if (!Q) return true;
      const hay = [p.tag, p.SCID].map(x => String(x || '').toLowerCase()).join(' ');
      return hay.includes(Q);
    });
  }

  function permitsForPole(pole) {
    return STATE.permits.filter(r =>
      String(r.job_name) === String(pole.job_name) &&
      String(r.tag)      === String(pole.tag) &&
      String(r.SCID)     === String(pole.SCID)
    );
  }

  function jobsEligibleForMassCreate() {
    // Eligible if every pole in job has NO permit or only status 'NONE'
    const eligible = [];
    for (const [job, obj] of STATE.jobs.entries()) {
      if (!obj.poles.length) continue;
      let ok = true;
      for (const pole of obj.poles) {
        const prs = permitsForPole(pole);
        if (prs.some(r => String(r.permit_status) && String(r.permit_status) !== 'NONE')) {
          ok = false; break;
        }
      }
      if (ok) eligible.push(job);
    }
    eligible.sort();
    return eligible;
  }

  // Public API
  window.DATA = {
    get state() { return STATE; },
    async reload() { await loadData(); },
    async init() { await loadData(); },

    getJobNamesFilteredByOwner,
    polesFiltered,
    permitsForPole,
    jobsEligibleForMassCreate,
    findPermitById: id => STATE.permitsById.get(String(id)),
  };
})();
