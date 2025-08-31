// assets/js/config.js
export const OWNER = 'DRGSolutions';
export const REPO  = 'BrownsvilleOMNIPermits';
export const DEFAULT_BRANCH = 'main';
export const DATA_DIR = 'data';

export const API_URL    = 'https://permits-api.vercel.app/api/propose-change';
export const SHARED_KEY = 'BrownsvilleOMNIPermits';

export const UTILITIES = ['BPUB', 'AEP', 'MVEC'];
export const PERMIT_STATUSES = [
  'Created - NOT Submitted',
  'Submitted - Pending',
  'Approved',
  'Not Approved - Cannot Attach',
  'Not Approved - PLA Issues',
  'Not Approved - MRE Issues',
  'Not Approved - Other Issues',
  'NONE' // used for reporting when a pole has no permits
];
