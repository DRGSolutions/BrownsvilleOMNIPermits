// assets/js/api.js
import { API_URL, SHARED_KEY } from './config.js';

export async function callApi(payload){
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'X-Permits-Key': SHARED_KEY },
    body: JSON.stringify(payload)
  });
  let data;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok || !data || data.ok === false) {
    const details = data && data.details ? `\n${JSON.stringify(data.details, null, 2)}` : '';
    const msg = (data && data.error) ? (data.error + details) : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}
