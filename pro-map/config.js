// Tries to reuse your global APP_CONFIG if present (same keys as assets/js/config.js)
// Otherwise defaults to your public repo.
export const CONFIG = (() => {
  const g = (window.APP_CONFIG || window.CONFIG || {});
  return {
    OWNER:          g.OWNER || 'DRGSolutions',
    REPO:           g.REPO  || 'BrownsvilleOMNIPermits',
    DEFAULT_BRANCH: g.DEFAULT_BRANCH || 'main',
    DATA_DIR:       (g.DATA_DIR || 'data').replace(/^\/+|\/+$/g,'')
  };
})();
