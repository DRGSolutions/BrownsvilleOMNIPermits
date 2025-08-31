// assets/js/api.js
import { OWNER, REPO, DEFAULT_BRANCH, DATA_DIR, API_URL, SHARED_KEY } from './config.js';
import { state, setData } from './state.js';

export async function getLatestSha() {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/commits/${DEFAULT_BRANCH}?_=${Date.now()}`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`GitHub API ${r.status} (latest commit)`);
  const j = await r.json();
  return j.sha;
}

export async function loadData() {
  const sha = await getLatestSha();
  const base = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${sha}/${DATA_DIR}`;
  const bust = `?ts=${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const [r1, r2] = await Promise.all([
    fetch(`${base}/poles.json${bust}`,   { cache: 'no-store' }),
    fetch(`${base}/permits.json${bust}`, { cache: 'no-store' })
  ]);
  if (!r1.ok || !r2.ok) throw new Error(`HTTP ${r1.status}/${r2.status} (poles/permits)`);

  const [poles, permits] = await Promise.all([r1.json(), r2.json()]);
  setData({ poles, permits, sha });
  return { sha, poles, permits };
}

export async function callApi(change, actorName = 'Website User', reason = '') {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Permits-Key': SHARED_KEY },
    body: JSON.stringify({ actorName, reason, change })
  });
  let data;
  try { data = await res.json(); } catch { data = { ok:false, error:'Invalid server response' }; }
  if (!res.ok || !data.ok) {
    const details = data && data.details ? `\n${JSON.stringify(data.details, null, 2)}` : '';
    throw new Error((data && data.error) ? (data.error + details) : `HTTP ${res.status}`);
  }
  return data; // { ok:true, pr_url, branch }
}
