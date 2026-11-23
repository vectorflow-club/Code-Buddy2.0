import { createStaffAuthService } from "./staffAuthService";

// Admin credentials are the staff auth factory configured for the ADMIN
// role. Session storage key, endpoints, and messages are unchanged from the
// previous standalone service; login branches on the backend error code.
const adminAuth = createStaffAuthService({
  sessionKey: "code-buddy-admin-session",
  profileKey: "admin",
  role: "ADMIN",
  loginPath: "/api/admin/login",
  mePath: "/api/admin/me",
  notConfiguredMessage:
    "Admin API is not configured. Set VITE_API_BASE_URL and restart the frontend.",
  loginNetworkMessage:
    "Could not reach the admin server. Check that it is running and try again.",
  validateNetworkMessage: "Could not reach the admin server.",
  loginStrategy: "code",
  knownLoginErrors: {
    MISSING_CREDENTIALS: "Please enter your username and password.",
    INVALID_CREDENTIALS: "Invalid username or password.",
    ACCOUNT_DEACTIVATED:
      "This admin account is deactivated. Contact the competition administrator.",
  },
  loginFailedMessage: "The admin server could not complete the login. Please try again.",
  loginInvalidMessage: "The admin server returned an invalid login response.",
  validateProfileOnLogin: true,
  sessionExpiredMessage:
    "Your admin session is invalid or has expired. Please sign in again.",
  sessionRetryMessage: "The admin session could not be validated. Please retry.",
  sessionInvalidMessage:
    "The admin session response was invalid. Please sign in again.",
});

export const getAdminSession = adminAuth.getSession;
export const storeAdminSession = adminAuth.storeSession;
export const clearAdminSession = adminAuth.clearSession;
export const loginAdmin = adminAuth.login;
export const validateAdminSession = adminAuth.validateSession;
