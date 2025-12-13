// assets/js/permit_admin_panel.js
(function () {
  'use strict';

  // Mount where the inline panel used to be
  let mount = document.getElementById('permit-admin-mount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'permit-admin-mount';
    document.body.appendChild(mount);
  }

  // Exact same UI (IDs unchanged) + new Delete button
  mount.innerHTML = `
    <div class="panel">
      <div class="hdr" id="jobName">Job: —</div>
      <div class="small muted" id="selInfo" style="margin-bottom:8px">Selected poles: 0</div>

      <div class="row">
        <div class="col-12">
          <label>Mode</label>
          <select id="mode">
            <option value="assign">Assign new permits (only poles with no permits)</option>
            <option value="modify">Modify existing permits (status only)</option>
          </select>
        </div>

        <div class="col-12 assign-only">
          <label>Base Permit ID (we append “_SCID”)</label>
          <input id="baseId" placeholder="e.g., BTX02-F36_BRN02-F05_SEG2"/>
        </div>

        <div class="col-6">
          <label>Permit Status</label>
          <select id="status">
            <option>Created - NOT Submitted</option>
            <option>Submitted - Pending</option>
            <option>Approved</option>
            <option>Not Approved - Cannot Attach</option>
            <option>Not Approved - PLA Issues</option>
            <option>Not Approved - MRE Issues</option>
            <option>Not Approved - Other Issues</option>
          </select>
        </div>

        <div class="col-6 assign-only">
          <label>Submitted By</label>
          <input id="by" placeholder="Name"/>
        </div>
        <div class="col-6 assign-only">
          <label>Submitted At</label>
          <input id="date" type="date"/>
        </div>

        <div class="col-6"><label>&nbsp;</label><button id="btnClear" type="button">Clear Selection</button></div>
        <div class="col-6"><label>&nbsp;</label><button id="btnApply" class="btn btn-accent" type="button">Apply to Selected Poles</button></div>

        <!-- NEW: Delete permits (selected) -->
        <div class="col-12">
          <label>&nbsp;</label>
          <button id="btnDelete" class="btn" type="button" style="border-color:#b91c1c;background:#220b0b">
            Delete Permits (selected)
          </button>
        </div>

        <div class="col-12"><div id="msg" class="small muted" style="margin-top:2px"></div></div>
        <div class="col-12"><div class="hint">Use the polygon/rectangle tools (top-right) to draw areas. Selected labels turn <b style="color:#2563eb">blue</b>.</div></div>
      </div>
    </div>
  `;

  // Delete piggy-backs the exact same pipeline used by Apply
  const btnDelete = document.getElementById('btnDelete');
  const btnApply  = document.getElementById('btnApply');

  if (btnDelete && btnApply && !btnDelete.__wired) {
    btnDelete.__wired = true;
    btnDelete.addEventListener('click', () => {
      // Set a one-shot flag that your existing Apply pipeline can read
      // (wherever it's implemented). Nothing else changes.
      window.__DELETE_MODE__ = true;

      // If your Apply logic checks #mode, gently hint "modify" for deletes
      const modeSel = document.getElementById('mode');
      const prev = modeSel ? modeSel.value : null;
      if (modeSel) modeSel.value = 'modify';

      // Trigger the exact same handler you already have for Apply
      btnApply.click();

      // Restore UI
      if (modeSel) modeSel.value = prev;
    });
  }

  // Optional: signal ready (if anything listens)
  window.dispatchEvent(new CustomEvent('panel:ready'));
})();
