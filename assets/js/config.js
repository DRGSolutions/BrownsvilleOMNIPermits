// assets/js/config.js
// Central configuration used by data.js/api.js/ui.js

window.APP_CONFIG = {
  // GitHub repo that hosts the data under /data
  OWNER: 'DRGSolutions',
  REPO: 'BrownsvilleOMNIPermits',
  DEFAULT_BRANCH: 'main',
  DATA_REPO_PATH: 'data',

  // Vercel function that opens PRs
  API_URL: 'https://permits-api.vercel.app/api/propose-change',
  SHARED_KEY: 'BrownsvilleOMNIPermits',

  // Optional: CORS allow-list for the server (mirrors your Vercel env)
  // ALLOWED_ORIGIN is set on the server; listed here for reference only
};
