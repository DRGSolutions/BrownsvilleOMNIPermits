// assets/js/api.js
// Thin client for the Vercel function.

(() => {
  const { API_URL, SHARED_KEY } = window.APP_CONFIG || {};
  if (!API_URL) console.warn('APP_CONFIG.API_URL is missing');

  async function callApi(payload) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Permits-Key': SHARED_KEY || '' },
      body: JSON.stringify(payload)
    });
    let data;
    try { data = await res.json(); } catch { data = { ok: false, error: 'Invalid server response' }; }
    if (!res.ok || !data.ok) {
      const details = data && data.details ? `\n${JSON.stringify(data.details, null, 2)}` : '';
      throw new Error((data && data.error) ? (data.error + details) : `HTTP ${res.status}`);
    }
    return data;
  }

  // Utility: default permit_id pattern
  function buildPermitId(job_name, tag, SCID) {
    const safe = (s) => String(s || '').replace(/[^A-Za-z0-9._:-]+/g, '-');
    return `PERM-${safe(job_name)}-${safe(tag)}-${safe(SCID)}`;
  }

  // API wrappers
  async function upsertPermit(permit, reason) {
    return callApi({
      actorName: 'Website User',
      reason: reason || `Upsert permit ${permit.permit_id}`,
      change: { type: 'upsert_permit', permit }
    });
  }

  async function updatePermit(permit_id, patch, reason) {
    return callApi({
      actorName: 'Website User',
      reason: reason || `Update permit ${permit_id}`,
      change: { type: 'update_permit', permit_id, patch }
    });
  }

  async function deletePermit(permit_id, reason) {
    return callApi({
      actorName: 'Website User',
      reason: reason || `Delete permit ${permit_id}`,
      change: { type: 'delete_permit', permit_id }
    });
  }

  // Mass create for a job: creates one permit per pole that currently has no permits.
  // NOTE: This will open ONE PR per permit (backend is single-change). If you want
  // one PR for the whole bulk op, we can add a /api/bulk endpoint later.
  async function massCreatePermitsForJob({ job_name, submitted_by, dateMDY, notes }) {
    const { STATE } = window.DATA || {};
    const poles = (STATE && STATE.poles) ? STATE.poles : [];
    const permits = (STATE && STATE.permits) ? STATE.permits : [];

    // Find poles in the job
    const polesInJob = poles.filter(p => String(p.job_name) === String(job_name));
    // Identify poles that already have at least one permit
    const hasPermit = new Set(
      permits.filter(r => String(r.job_name) === String(job_name))
             .map(r => `${r.job_name}::${r.tag}::${r.SCID}`)
    );

    const targets = polesInJob.filter(p => !hasPermit.has(`${p.job_name}::${p.tag}::${p.SCID}`));

    const results = [];
    for (const p of targets) {
      const permit_id = buildPermitId(p.job_name, p.tag, p.SCID);
      const permit = {
        permit_id,
        job_name: p.job_name,
        tag: p.tag,
        SCID: p.SCID,
        permit_status: 'Submitted - Pending', // per requirement
        submitted_by,
        submitted_at: dateMDY, // MM/DD/YYYY
        notes: notes || ''
      };
      try {
        const r = await upsertPermit(permit, `Mass create for job ${job_name}`);
        results.push({ ok: true, permit_id, pr_url: r.pr_url });
      } catch (e) {
        results.push({ ok: false, permit_id, error: e.message });
      }
    }
    return results;
  }

  window.API = {
    callApi,
    buildPermitId,
    upsertPermit,
    updatePermit,
    deletePermit,
    massCreatePermitsForJob
  };
})();
