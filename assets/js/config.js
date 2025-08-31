// assets/js/config.js
export const OWNER           = 'DRGSolutions';
export const REPO            = 'BrownsvilleOMNIPermits';
export const DEFAULT_BRANCH  = 'main';
export const DATA_REPO_DIR   = 'data'; // where poles.json & permits.json live

// Your Vercel function
export const API_URL   = 'https://permits-api.vercel.app/api/propose-change';
export const SHARED_KEY = 'BrownsvilleOMNIPermits';

// Status sets
export const STATUS_NONE = 'NONE';
export const PERMIT_STATUSES_UI = [
  'Created - NOT Submitted',
  'Submitted - Pending',
  'Approved',
  'Not Approved - Cannot Attach',
  'Not Approved - PLA Issues',
  'Not Approved - MRE Issues',
  'Not Approved - Other Issues'
];

// Same list used for API (no NONE)
export const STATUS_FOR_API = [...PERMIT_STATUSES_UI];
