// assets/js/app.js
import { initUI } from './ui.js';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initUI().catch(console.error));
} else {
  initUI().catch(console.error);
}
