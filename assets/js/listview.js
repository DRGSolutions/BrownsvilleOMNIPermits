// assets/js/listView.js
import { UTILITIES, PERMIT_STATUSES } from './config.js';
import { state, jobsForUtility, polesFor, getPermitsForPole } from './state.js';
import { setListRenderer } from './pending.js';
import { fmt } from './utils.js';
import { prefillPoleForm } from './forms/poleForm.js';
import { startNewPermitForPole, editPermitForPole, refreshPermitSelectForPole } from './forms/permitForm.js';

export function initListView() {
  const elUtility = document.getElementById('selUtility');
  const elJob     = document.getElementById('selJob');
  const elSearch  = document.getElementById('searchTagScid');
  const elList    = document.getElementById('list');
  const elStatus  = document.getElementById('status');
  const elKPoles  = document.getElementById('kPoles');
  const elKPerms  = document.getElementById('kPermits');

  const filters = { util:'', job:'', q:'' };

  function refreshJobsForUtility() {
    const jobs = jobsForUtility(filters.util);
    elJob.innerHTML = '';
    const opt0 = document.createElement('option'); opt0.value = ''; opt0.textContent = jobs.length ? 'All jobs' : '—';
    elJob.appendChild(opt0);
    for (const j of jobs) {
      const o = document.createElement('option'); o.value = j; o.textContent = j;
      elJob.appendChild(o);
    }
  }

  function renderList() {
    const poles = polesFor(filters.util, filters.job)
      .filter(p => {
        const q = filters.q.trim().toLowerCase();
        if (!q) return true;
        return String(p.tag).toLowerCase().includes(q) || String(p.SCID).toLowerCase().includes(q);
      });

    elList.innerHTML = '';
    for (const p of poles) {
      const permits = getPermitsForPole(p);
      const hasPermits = permits.length > 0;
      const pendingPoleKey = `pole:${p.job_name}/${p.tag}/${p.SCID}`;
      const hasPendingPole = state.pending.has(pendingPoleKey);

      const div = document.createElement('div'); div.className = 'card';
      div.innerHTML = `
        <div class="flex" style="justify-content:space-between;align-items:flex-start;">
          <div>
            <div class="title">
              ${p.job_name} — Tag <code>${p.tag}</code> — SCID <code>${p.SCID}</code>
              ${hasPendingPole ? '<span class="chip chip-warn" style="margin-left:8px;">pending</span>' : ''}
            </div>
            <div class="small muted">
              Owner: ${p.owner} · Pole Spec: ${p.pole_spec ?? '—'} · Proposed: ${p.proposed_spec ?? '—'} · MR: ${p.mr_level ?? '—'}
            </div>
            <div class="small muted">Coords: ${p.lat ?? '—'}, ${p.lon ?? '—'}</div>
          </div>
          <div class="flex">
            <button class="btn" data-edit-pole>Edit Pole</button>
            <button class="btn btn-accent" data-add-permit>Add Permit</button>
          </div>
        </div>

        <div style="height:10px"></div>
        <div class="small muted">Permits:</div>
        ${hasPermits ? `
          <ul style="margin:.4rem 0 .2rem 1rem;">
            ${permits.map(r => {
              const pendingPermitKey = `permit:${r.permit_id}`;
              const isPending = state.pending.has(pendingPermitKey);
              return `<li class="small" style="margin:6px 0;">
                <code>${r.permit_id}</code>
                <span class="chip">${r.permit_status}</span>
                ${isPending ? '<span class="chip chip-warn" style="margin-left:6px;">pending</span>' : ''}
                · by ${r.submitted_by} · on ${r.submitted_at}
                ${r.notes ? ` · <span class="muted">"${r.notes}"</span>` : ''}
                <button class="btn btn-ghost" data-edit-permit style="margin-left:8px;">Edit</button>
              </li>`;
            }).join('')}
          </ul>
        ` : `<div class="small muted"><em>Status: NONE</em></div>`}
      `;
      // Wire buttons
      div.querySelector('[data-edit-pole]').addEventListener('click', () => {
        prefillPoleForm(p);
      });
      div.querySelector('[data-add-permit]').addEventListener('click', () => {
        startNewPermitForPole(p);
      });
      for (const btn of div.querySelectorAll('[data-edit-permit]')) {
        const li = btn.closest('li');
        const id = li.querySelector('code').textContent.trim();
        btn.addEventListener('click', () => {
          editPermitForPole(p, id);
        });
      }
      elList.appendChild(div);
    }

    // KPIs
    elKPoles.textContent = fmt(state.poles.length);
    elKPerms.textContent = fmt(state.permits.length);
  }

  // Event wiring
  elUtility.addEventListener('change', () => {
    filters.util = elUtility.value || '';
    refreshJobsForUtility();
    renderList();
  });
  elJob.addEventListener('change', () => {
    filters.job = elJob.value || '';
    renderList();
  });
  elSearch.addEventListener('input', () => {
    filters.q = elSearch.value || '';
    renderList();
  });

  // Expose hooks
  setListRenderer(renderList);
  return {
    renderList,
    refreshJobsForUtility,
    getFilters: () => ({ ...filters }),
    setSelectedPoleSummary: (p) => {
      const el = document.getElementById('selPoleSummary');
      if (!p) el.textContent = 'No pole selected.';
      else el.textContent = `Selected Pole — ${p.job_name} · Tag ${p.tag} · SCID ${p.SCID}`;
    },
    refreshPermitSelectForPole
  };
}
