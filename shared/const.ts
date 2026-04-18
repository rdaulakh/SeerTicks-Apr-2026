export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;

// Session duration constants for Remember Me feature
export const SESSION_DURATION_SHORT = 1000 * 60 * 60 * 24; // 24 hours (default)
export const SESSION_DURATION_LONG = 1000 * 60 * 60 * 24 * 30; // 30 days (remember me)
export const AXIOS_TIMEOUT_MS = 60_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';
