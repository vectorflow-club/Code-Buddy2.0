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
    "The organizer side is not set up. Please check the site settings and try again.",
  loginNetworkMessage:
    "Could not reach the organizer side. Check your connection and try again.",
  validateNetworkMessage: "Could not reach the organizer side.",
  loginStrategy: "status",
  statusLoginErrors: {
    400: { message: "Please enter your username and password.", code: "MISSING_CREDENTIALS" },
    401: { message: "Invalid username or password.", code: "INVALID_CREDENTIALS" },
    403: {
      message:
        "This organizer account is switched off. Contact the event team.",
      code: "VOLUNTEER_DEACTIVATED",
    },
  },
  serverLoginMessage:
    "The login could not be completed. Please try again.",
  validateProfileOnLogin: false,
  sessionExpiredMessage:
    "Your organizer sign-in ran out. Please sign in again.",
  sessionRetryMessage: "Your organizer session could not be checked. Please try again.",
  sessionInvalidMessage:
    "Your organizer session reply was not understood. Please sign in again.",
});

export const getVolunteerSession = volunteerAuth.getSession;
export const storeVolunteerSession = volunteerAuth.storeSession;
export const clearVolunteerSession = volunteerAuth.clearSession;
export const loginVolunteer = volunteerAuth.login;
export const validateVolunteerSession = volunteerAuth.validateSession;
