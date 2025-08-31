// assets/js/config.js
// Central place for environment & constants used by the front-end.

window.APP_CONFIG = {
  // Your deployed Vercel function (unchanged)
  API_URL:    'https://permits-api.vercel.app/api/propose-change',
  SHARED_KEY: 'BrownsvilleOMNIPermits',

  // Repo source of truth
  OWNER:  'DRGSolutions',
  REPO:   'BrownsvilleOMNIPermits',
  BRANCH: 'main',
  DATA_DIR: 'data',

  // Watcher
  POLL_MS: 5000,     // check for new commits every 5s
  // Status -> chip class mapping (text color + bg)
  STATUS_COLORS: {
    'Created - NOT Submitted': 'yellow',
    'Submitted - Pending': 'orange',
    'Approved': 'green',
    'Not Approved - Cannot Attach': 'purple'
  },
  // Anything starting with this (and not matched above) => red
  NOT_APPROVED_PREFIX: 'Not Approved - '
};
