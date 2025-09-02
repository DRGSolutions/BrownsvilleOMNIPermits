// Reuse your APP_CONFIG if present, else default to public GH location.
// Adjust if you host poles.json/permits.json locally in /data next to this folder.
export const CONFIG = (() => {
  const g = (window.APP_CONFIG || window.CONFIG || {});
  return {
    OWNER:          g.OWNER || 'DRGSolutions',
    REPO:           g.REPO  || 'BrownsvilleOMNIPermits',
    DEFAULT_BRANCH: g.DEFAULT_BRANCH || 'main',
    DATA_DIR:       (g.DATA_DIR || 'data').replace(/^\/+|\/+$/g,'')
  };
})();
