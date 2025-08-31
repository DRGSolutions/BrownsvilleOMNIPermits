// assets/js/config.js
export const API_URL = 'https://permits-api.vercel.app/api/propose-change'; // <-- your Vercel API
export const SHARED_KEY = 'BrownsvilleOMNIPermits';                          // <-- must match FORM_SHARED_KEY

export const OWNER = 'DRGSolutions';
export const REPO  = 'BrownsvilleOMNIPermits';
export const DEFAULT_BRANCH = 'main';
export const DATA_DIR = 'data';               // repo path where JSON lives

export const UTILITIES = ['BPUB', 'AEP', 'MVEC'];

export const PERMIT_STATUSES = [
  'NONE',
  'Created - NOT Submitted',
  'Submitted - Pending',
  'Approved',
  'Not Approved - Cannot Attach',
  'Not Approved - PLA Issues',
  'Not Approved - MRE Issues',
  'Not Approved - Other Issues'
];
