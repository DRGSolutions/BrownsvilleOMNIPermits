// assets/js/app.js
import { initUI } from './ui.js';

// Boot the UI once the DOM is ready.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initUI().catch(console.error));
} else {
  initUI().catch(console.error);
}
