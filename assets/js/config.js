// assets/js/config.js
window.APP_CONFIG = {
  // Vercel serverless endpoint
  API_URL: 'https://permits-api.vercel.app/api/propose-change',
  // Must match your Vercel FORM_SHARED_KEY
  SHARED_KEY: 'BrownsvilleOMNIPermits',

  // GitHub source of truth
  OWNER: 'DRGSolutions',
  REPO: 'BrownsvilleOMNIPermits',
  DEFAULT_BRANCH: 'main',

  // Where the JSON lives in the repo
  DATA_DIR: 'data'
};
