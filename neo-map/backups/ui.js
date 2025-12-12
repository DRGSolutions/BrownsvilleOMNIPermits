// neo-map/ui.js
// Popup content themed to your dark UI.
// Each permit line's TEXT color = its permit status color.

import { statusColor } from './data.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));

/** Build popup HTML for a pole and its related permits */
export function popupHTML(p, permits){
  const owner = esc(p.owner ?? '—');
  const tag   = esc(p.tag ?? '—');
  const scid  = esc(p.SCID ?? '—');
  const spec  = esc(p.pole_spec ?? p.spec ?? '—');
  const mr    = esc(p.mr_level ?? p.mr ?? '—');

  const latOk = typeof p.lat === 'number', lonOk = typeof p.lon === 'number';
  const lat   = latOk ? p.lat.toFixed(6) : '—';
  const lon   = lonOk ? p.lon.toFixed(6) : '—';
  const gps   = (latOk && lonOk)
    ? `<a href="https://maps.google.com/?q=${p.lat},${p.lon}" target="_blank" rel="noopener">(${lat}, ${lon})</a>`
    : '—';

  const permitRows = (permits || []).map(r => {
    const id  = esc(r.permit_id ?? r.permitId ?? r.id ?? '');
    const st  = String(r.permit_status ?? r.status ?? 'UNKNOWN').trim();
    const col = statusColor(st);
    const who = esc(r.created_by ?? r.by ?? r.createdBy ?? '');
    const dt  = esc(r.created_date ?? r.date ?? r.submitted_date ?? '');
    const parts = [id, st, who ? `by ${who}` : '', dt].filter(Boolean).join(' • ');
    return `<div class="permit-pill" style="color:${col}">${parts}</div>`;
  });

  return `
  <div class="pp">
    <div class="pp-title">${esc(p.job_name ?? '')}</div>
    <div class="pp-sub muted">Owner: ${owner} · Tag: ${tag} · SCID: ${scid}</div>
    <div class="pp-line">Spec: <span class="muted">${spec}</span> &nbsp;→&nbsp; MR: <span class="muted">${mr}</span></div>
    <div class="pp-line">GPS: ${gps}</div>
    <div class="pp-sep"></div>
    <div class="pp-section-title muted">Permits</div>
    ${permitRows.length ? permitRows.join('') : '<div class="muted">None</div>'}
  </div>`;
}

/** Simple toast (uses #toast in index.html) */
export function toast(text, ms = 1500){
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.style.display = 'block';
  clearTimeout(el.__t);
  el.__t = setTimeout(() => { el.style.display = 'none'; }, ms);
}
