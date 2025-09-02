export function toast(msg, ms=1800){
  const t=document.getElementById('toast'); t.textContent=msg; t.style.display='block';
  setTimeout(()=> t.style.display='none', ms);
}

export function popupHTML(p, rel){
  const coord = (typeof p.lat==='number' && typeof p.lon==='number') ? `(${p.lat.toFixed(6)}, ${p.lon.toFixed(6)})` : '—';
  const safe = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const permits = (rel||[]).length ? rel.map(r=>`
      <div style="border:1px solid #283244;background:#0f1219;border-radius:10px;padding:8px 10px;margin:6px 0">
        <div class="small"><code>${safe(r.permit_id)}</code> · ${safe(r.permit_status)}${r.submitted_by?` · by ${safe(r.submitted_by)}`:''}${r.submitted_at?` · ${safe(r.submitted_at)}`:''}</div>
        ${r.notes? `<div class="small muted" style="margin-top:6px;white-space:pre-wrap"><b>Notes:</b> ${safe(r.notes)}</div>`:''}
      </div>`).join('')
    : `<div class="small badge none">NONE</div> <span class="muted small">No permits yet.</span>`;
  return `
    <div class="popup">
      <div class="popup-title">${safe(p.job_name)}</div>
      <div class="popup-sub"><b>Owner:</b> ${safe(p.owner)} · <b>Tag:</b> ${safe(p.tag)} · <b>SCID:</b> ${safe(p.SCID)}</div>
      <div class="small muted" style="margin-bottom:6px"><b>Spec:</b> ${safe(p.pole_spec)} → ${safe(p.proposed_spec)} · <b>MR:</b> ${safe(p.mr_level)} · <b>GPS:</b> ${coord}</div>
      <div class="small muted" style="margin-bottom:4px">Permits</div>
      ${permits}
    </div>`;
}
