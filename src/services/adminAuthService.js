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
    "The admin side is not set up. Please check the site settings and try again.",
  loginNetworkMessage:
    "Could not reach the admin side. Check your connection and try again.",
  validateNetworkMessage: "Could not reach the admin side.",
  loginStrategy: "code",
  knownLoginErrors: {
    MISSING_CREDENTIALS: "Please enter your username and password.",
    INVALID_CREDENTIALS: "Invalid username or password.",
    ACCOUNT_DEACTIVATED:
      "This admin account is deactivated. Contact the event team.",
  },
  loginFailedMessage: "The login could not be completed. Please try again.",
  loginInvalidMessage: "The login reply was not understood. Please try again.",
  validateProfileOnLogin: true,
  sessionExpiredMessage:
    "Your admin session is invalid or has expired. Please sign in again.",
  sessionRetryMessage: "The admin session could not be checked. Please try again.",
  sessionInvalidMessage:
    "The admin session reply was not understood. Please sign in again.",
});

export const getAdminSession = adminAuth.getSession;
export const storeAdminSession = adminAuth.storeSession;
export const clearAdminSession = adminAuth.clearSession;
export const loginAdmin = adminAuth.login;
export const validateAdminSession = adminAuth.validateSession;
