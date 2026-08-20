// -- Re-export from KERN-generated history search bridge ----------------------
// Keep explicit exports in sync so static guard checks can resolve this facade.
export {
  HISTORY_SEARCH_DISABLE_ENV,
  HISTORY_SEARCH_TIMEOUT_MS,
  searchHistorySemantic,
} from './generated/sessions/history-search-bridge.js';
export type {
  HistorySearchHit,
  HistorySearchItem,
} from './generated/sessions/history-search-bridge.js';
