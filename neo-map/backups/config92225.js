// Adjust if you host JSONs elsewhere.
export const CONFIG = (() => {
  const g = (window.APP_CONFIG || window.CONFIG || {});
  return {
    DATA_PATHS: [
      'data/', './data/', '../data/', './', '../'
    ]
  };
})();
