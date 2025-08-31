// assets/js/config.js
// Repository + data folder used by the frontend loader/watcher.

// GitHub repo containing your data
export const OWNER  = 'DRGSolutions';
export const REPO   = 'BrownsvilleOMNIPermits';
export const BRANCH = 'main';

// Where poles.json and permits.json live inside the repo
export const DATA_DIR = 'data';

// Status set (includes NONE)
export const PERMIT_STATUSES = [
  'Created - NOT Submitted',
  'Submitted - Pending',
  'Approved',
  'Not Approved - Cannot Attach',
  'Not Approved - PLA Issues',
  'Not Approved - MRE Issues',
  'Not Approved - Other Issues',
  'NONE',
];

// Poll interval for the watcher (milliseconds)
export const WATCH_INTERVAL_MS = 5000;
