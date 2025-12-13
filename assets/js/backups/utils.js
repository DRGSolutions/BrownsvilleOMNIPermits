// assets/js/utils.js
export const fmt = n => new Intl.NumberFormat().format(n);

export function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(cell => {
    const v = cell == null ? '' : String(cell);
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  }).join(',')).join('\n');

  const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// tolerant partial matcher used by the pending monitor
export function matchesPatch(obj, expected) {
  const EPS = 1e-9;
  for (const [k, vExp] of Object.entries(expected || {})) {
    const vObj = obj[k];
    if (vObj === vExp) continue;
    if (vObj != null && vExp != null && String(vObj) === String(vExp)) continue;
    const nObj = Number(vObj), nExp = Number(vExp);
    if (!Number.isNaN(nObj) && !Number.isNaN(nExp) && Math.abs(nObj - nExp) < EPS) continue;
    return false;
  }
  return true;
}
