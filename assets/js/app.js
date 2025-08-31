// assets/js/app.js
import { loadData } from './api.js';
import { initUI, renderAfterLoad, showStatus } from './ui.js';

async function loadAndRender() {
  try {
    showStatus('Loading…');
    const { sha } = await loadData();           // fills state.poles / state.permits
    await renderAfterLoad(sha);                 // paints counts + list
    showStatus(`Loaded.`);
  } catch (err) {
    console.error('loadAndRender error:', err);
    showStatus(`Error: ${err.message}`, true);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  initUI({ onReload: loadAndRender });
  loadAndRender();
});
