// assets/js/app.js
(function () {
  const $ = (s) => document.querySelector(s);

  // --- small helpers ---
  function setStatus(msgHtml) { const el = document.querySelector('#status'); if (el) el.innerHTML = msgHtml || ''; }
  function kpi(sel, v){ const el = document.querySelector(sel); if (el) el.textContent = v; }
  const fmt = (n)=> new Intl.NumberFormat().format(n);
  const nowLocal = ()=> new Date().toLocaleString();
  const cfg = (k, d='') => (window.CONFIG && window.CONFIG[k]) || d;

  // --- GitHub data fetch ---
  async function getLatestSha(owner, repo, branch){
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${branch}?_=${Date.now()}`, { cache:'no-store' });
    if (!r.ok) throw new Error(`GitHub API ${r.status} (latest commit)`);
    const j = await r.json();
    return j.sha;
  }

  async function tryLoadRaw(owner, repo, ref, dir){
    const bust = `?ts=${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const base = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${dir}`;
    const urls = {
      poles:   `${base}/poles.json${bust}`,
      permits: `${base}/permits.json${bust}`
    };

    const [r1, r2] = await Promise.all([
      fetch(urls.poles,   { cache:'no-store' }),
      fetch(urls.permits, { cache:'no-store' })
    ]);

    if (r1.ok && r2.ok) {
      const [poles, permits] = await Promise.all([r1.json(), r2.json()]);
      return { ok:true, poles, permits, urls };
    }
    return { ok:false, status:`${r1.status}/${r2.status}`, urls };
  }

  async function loadData(){
    const OWNER   = cfg('OWNER');
    const REPO    = cfg('REPO');
    const BRANCH  = cfg('DEFAULT_BRANCH','main');
    const DATA_DIR= cfg('DATA_DIR','data');

    if (!OWNER || !REPO) {
      setStatus('<span class="err">Missing CONFIG.OWNER/REPO</span>');
      console.error('CONFIG missing:', window.CONFIG);
      return;
    }

    setStatus('Loading…');

    const dirsToTry = [DATA_DIR, 'docs/data'].filter((v,i,a)=> v && a.indexOf(v)===i);
    const tried = [];

    // 1) pinned to latest commit
    try {
      const sha = await getLatestSha(OWNER, REPO, BRANCH);
      for (const dir of dirsToTry) {
        const res = await tryLoadRaw(OWNER, REPO, sha, dir);
        tried.push({ ref: sha.slice(0,7), dir, urls: res.urls, ok: res.ok, status: res.status });
        if (res.ok) {
          applyData(res.poles, res.permits, sha);
          setStatus(`<span class="ok">Loaded from commit <code>${sha.slice(0,7)}</code>.</span>`);
          return;
        }
      }
    } catch (e) {
      console.warn('Could not pin to commit:', e?.message || e);
    }

    // 2) branch fallback
    for (const dir of dirsToTry) {
      const res = await tryLoadRaw(OWNER, REPO, BRANCH, dir);
      tried.push({ ref: BRANCH, dir, urls: res.urls, ok: res.ok, status: res.status });
      if (res.ok) {
        applyData(res.poles, res.permits, null);
        setStatus('<span class="ok">Loaded (branch fallback).</span>');
        return;
      }
    }

    // 3) everything failed; show exactly what we tried
    const lines = tried.map(t =>
      `${t.ok?'OK':'fail'} @ ${t.ref}/${t.dir} (status ${t.status})`
    ).join('<br>');
    setStatus(`<span class="err">Error: raw 404/404</span><div class="small muted">${lines}</div>`);
    console.error('Tried URLs:', tried);
  }

  function applyData(poles, permits, sha){
    const prev = window.STATE || {};
    window.STATE = {
      ...prev,
      poles: poles || [],
      permits: permits || [],
      sha: sha || null,
      lastLoaded: new Date().toISOString()
    };
    kpi('#kPoles', fmt((window.STATE.poles||[]).length));
    kpi('#kPermits', fmt((window.STATE.permits||[]).length));
    kpi('#kLoaded', nowLocal());
    if (window.STATE.sha) kpi('#kSha', window.STATE.sha.slice(0,7));
    window.dispatchEvent(new CustomEvent('data:loaded'));
  }

  // --- API (read CONFIG lazily so cache can’t bite us) ---
  async function callApi(payload){
    const API_URL    = cfg('API_URL');
    const SHARED_KEY = cfg('SHARED_KEY');

    if (!API_URL) {
      const msg = 'Missing CONFIG.API_URL';
      console.error(msg, window.CONFIG);
      throw new Error(msg);
    }
    const res = await fetch(API_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'X-Permits-Key': SHARED_KEY || '' },
      body: JSON.stringify(payload)
    });
    let data; try { data = await res.json(); } catch { data = { ok:false, error:'Invalid server response' }; }
    if (!res.ok || !data.ok) {
      const details = data && data.details ? `\n${JSON.stringify(data.details,null,2)}` : '';
      throw new Error((data && data.error) ? (data.error + details) : `HTTP ${res.status}`);
    }
    return data;
  }

  // --- Save/Delete handlers (unchanged) ---
  function msg(html){ const el = document.querySelector('#msgPermit'); if (el) el.innerHTML = html || ''; }

  async function onSavePermit(ev){
    if (ev) ev.preventDefault();
    const f = (typeof window.UI_collectPermitForm==='function') ? window.UI_collectPermitForm() : null;
    if (!f){ msg('<span class="err">Internal error: form collector missing.</span>'); return; }

    if (!f.job_name || !f.tag || !f.SCID){ msg('<span class="err">Missing pole keys (job_name, tag, SCID).</span>'); return; }
    if (!f.permit_id){ msg('<span class="err">Permit ID is required.</span>'); return; }
    if (!f.permit_status){ msg('<span class="err">Permit Status is required.</span>'); return; }
    if (!f.submitted_by){ msg('<span class="err">Submitted By is required.</span>'); return; }
    if (!f.submitted_at){ msg('<span class="err">Submitted At (date) is required.</span>'); return; }

    const exists = (window.STATE?.permits||[]).some(r => String(r.permit_id) === String(f.permit_id));
    const change = exists
      ? { type:'update_permit', permit_id:f.permit_id, patch:{
          job_name:f.job_name, tag:f.tag, SCID:f.SCID,
          permit_status:f.permit_status, submitted_by:f.submitted_by,
          submitted_at:f.submitted_at, notes:f.notes||''
        } }
      : { type:'upsert_permit', permit:{
          permit_id:f.permit_id, job_name:f.job_name, tag:f.tag, SCID:f.SCID,
          permit_status:f.permit_status, submitted_by:f.submitted_by,
          submitted_at:f.submitted_at, notes:f.notes||''
        } };

    try{
      msg('Submitting…');
      const data = await callApi({ actorName:'Website User', reason:`Permit ${f.permit_id}`, change });
      msg(`<span class="ok">Change submitted.</span> <a class="link" href="${data.pr_url}" target="_blank" rel="noopener">View PR</a>`);
      window.dispatchEvent(new CustomEvent('watch:start'));
    }catch(err){
      console.error(err);
      msg(`<span class="err">${err.message}</span>`);
    }
  }

  async function onDeletePermit(ev){
    if (ev) ev.preventDefault();
    const id = (document.querySelector('#permit_id')?.value || '').trim();
    if (!id){ msg('<span class="err">Permit ID is required to delete.</span>'); return; }
    try{
      msg('Submitting delete…');
      const data = await callApi({ actorName:'Website User', reason:`Delete ${id}`, change:{ type:'delete_permit', permit_id:id } });
      msg(`<span class="ok">Delete submitted.</span> <a class="link" href="${data.pr_url}" target="_blank" rel="noopener">View PR</a>`);
      window.dispatchEvent(new CustomEvent('watch:start'));
    }catch(err){
      console.error(err);
      msg(`<span class="err">${err.message}</span>`);
    }
  }

  function wireButtons(){
    const save = document.querySelector('#btnSavePermit');
    if (save){ save.type='button'; save.onclick = onSavePermit; }
    const del  = document.querySelector('#btnDeletePermit');
    if (del){ del.type='button'; del.onclick = onDeletePermit; }
  }

  document.addEventListener('DOMContentLoaded', () => { wireButtons(); loadData(); });
  window.addEventListener('data:loaded', wireButtons);
})();
