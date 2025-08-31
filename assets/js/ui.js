// assets/js/ui.js
// View + interactions. Uses data.js for loading and watching.

import { loadData, startWatcher, getState } from './data.js';
import { PERMIT_STATUSES } from './config.js';

// ---------- DOM helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function text(el, v) { if (el) el.textContent = v; }
function html(el, v) { if (el) el.innerHTML = v; }

// ---------- Status chip colors ----------
function statusStyles(status) {
  // defaults
  let fg = '#a3a3a3', bg = '#262626';

  switch (status) {
    case 'Created - NOT Submitted':
      fg = '#fde047';           // bright yellow
      bg = '#3a3000';           // dark yellow background
      break;
    case 'Submitted - Pending':
      fg = '#fb923c';           // orange-400
      bg = '#331c00';
      break;
    case 'Approved':
      fg = '#22c55e';           // green-500
      bg = '#0f2a19';
      break;
    case 'Not Approved - Cannot Attach':
      fg = '#a855f7';           // purple-500
      bg = '#1f1030';
      break;
    case 'Not Approved - PLA Issues':
    case 'Not Approved - MRE Issues':
    case 'Not Approved - Other Issues':
      fg = '#ef4444';           // red-500
      bg = '#2a0f12';
      break;
    case 'NONE':
      fg = '#9ca3af';
      bg = '#1f2937';
      break;
  }
  return { fg, bg, bd: `${fg}33` };
}

function chip(status) {
  const c = statusStyles(status);
  return `<span class="status" style="
    color:${c.fg};
    background:${c.bg};
    border:1px solid ${c.bd};
    padding:2px 8px;
    border-radius:999px;
    font-size:12px;
    display:inline-block;
  ">${status}</span>`;
}

// ---------- Rendering ----------
function renderCounts(st) {
  text($('#kPoles'), st.poles.length.toString());
  text($('#kPermits'), st.permits.length.toString());
  text($('#kLoaded'), st.lastLoadedAt ? st.lastLoadedAt.toLocaleString() : '—');
  html($('#status'), `<span class="ok">Loaded.</span>`);
}

function renderList(st) {
  const list = $('#list');
  if (!list) return;

  const keyOf = (p) => `${p.job_name}::${p.tag}::${p.SCID}`;

  // Group permits by composite key so each pole shows its permits
  const permitsByPole = {};
  for (const r of st.permits) {
    const k = `${r.job_name}::${r.tag}::${r.SCID}`;
    (permitsByPole[k] ||= []).push(r);
  }

  const items = st.poles.map((p) => {
    const k = keyOf(p);
    const prs = (permitsByPole[k] || []).sort((a,b) => a.permit_id.localeCompare(b.permit_id));
    return `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <div class="title">
              ${p.job_name} / ${p.tag} / ${p.SCID}
              <span class="muted small">— ${p.owner}</span>
            </div>
            <div class="small muted">
              Spec: ${p.pole_spec || '—'} → ${p.proposed_spec || '—'}
              · Coords: ${p.lat ?? '—'}, ${p.lon ?? '—'}
              · MR: ${p.mr_level || '—'}
            </div>
          </div>
        </div>
        <div class="spacer"></div>
        <div class="small muted">Permits:</div>
        ${
          prs.length
            ? `<ul style="margin:.4rem 0 .2rem 1rem;">
                ${prs.map(r => `
                  <li class="small">
                    <code>${r.permit_id}</code>
                    ${chip(r.permit_status || 'NONE')}
                    ${r.submitted_by ? ` · by ${r.submitted_by}` : ''}
                    ${r.submitted_at ? ` · ${r.submitted_at}` : ''}
                    ${r.notes ? ` · <span class="muted">${r.notes}</span>` : ''}
                  </li>
                `).join('')}
              </ul>`
            : `<div class="small muted"><em>No permits</em></div>`
        }
      </div>
    `;
  });

  list.innerHTML = items.join('');
}

// ---------- Boot ----------
async function initialLoad() {
  html($('#status'), 'Loading…');
  try {
    await loadData();               // read current files
    const st = getState();
    renderCounts(st);
    renderList(st);
  } catch (e) {
    html($('#status'), `<span class="err">${e.message}</span>`);
  }
}

export async function initUI() {
  await initialLoad();

  // Start auto-refresh watcher; whenever files change, re-render.
  startWatcher((st) => {
    renderCounts(st);
    renderList(st);
    const s = $('#status');
    if (s) s.innerHTML = `<span class="ok">Updated from repo.</span>`;
    setTimeout(() => { if (s) s.textContent = ''; }, 1500);
  });
}

// ---- OPTIONAL: auto-boot if app.js forgets to call us ----
if (!window.__APP_UI_BOOT__) {
  window.__APP_UI_BOOT__ = true;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initUI().catch(console.error));
  } else {
    initUI().catch(console.error);
  }
}
