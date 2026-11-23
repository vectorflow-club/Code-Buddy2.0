import { createStaffAuthService } from "./staffAuthService";

// Volunteer credentials are the staff auth factory configured for the
// VOLUNTEER role. Session storage key, endpoints, and messages are unchanged
// from the previous standalone service; login branches on the HTTP status
// with fixed messages and never surfaces the backend message.
const volunteerAuth = createStaffAuthService({
  sessionKey: "code-buddy-volunteer-session",
  profileKey: "volunteer",
  role: "VOLUNTEER",
  loginPath: "/api/volunteer/login",
  mePath: "/api/volunteer/me",
  notConfiguredMessage:
    "Volunteer API is not configured. Set VITE_API_BASE_URL and restart the frontend.",
  loginNetworkMessage:
    "Could not reach the volunteer server. Check that it is running and try again.",
  validateNetworkMessage: "Could not reach the volunteer server.",
  loginStrategy: "status",
  statusLoginErrors: {
    400: { message: "Please enter your username and password.", code: "MISSING_CREDENTIALS" },
    401: { message: "Invalid username or password.", code: "INVALID_CREDENTIALS" },
    403: {
      message:
        "This volunteer account is deactivated. Contact the competition administrator.",
      code: "VOLUNTEER_DEACTIVATED",
    },
  },
  serverLoginMessage:
    "The volunteer server could not complete the login. Please try again.",
  validateProfileOnLogin: false,
  sessionExpiredMessage:
    "Your volunteer session is no longer valid. Please sign in again.",
  sessionRetryMessage: "The volunteer session could not be validated. Please retry.",
  sessionInvalidMessage:
    "The volunteer session response was invalid. Please sign in again.",
});

export const getVolunteerSession = volunteerAuth.getSession;
export const storeVolunteerSession = volunteerAuth.storeSession;
export const clearVolunteerSession = volunteerAuth.clearSession;
export const loginVolunteer = volunteerAuth.login;
export const validateVolunteerSession = volunteerAuth.validateSession;
