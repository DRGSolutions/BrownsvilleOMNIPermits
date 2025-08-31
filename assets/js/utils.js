// assets/js/utils.js
export const fmt = n => new Intl.NumberFormat().format(n);

export function todayMDY() {
  const d = new Date();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

export function toMDY(value) {
  if (!value) return value;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  return value;
}

export function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }).join(',')).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// tolerant equality for patch verification (numbers/strings/floats)
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
