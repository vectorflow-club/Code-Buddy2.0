import { createApiClient, ApiError, API_ERROR_CODES } from "./apiClient";
import { getVolunteerSession } from "./volunteerAuthService";

class VolunteerApiError extends Error {
  constructor({ message, kind, status, code }) {
    super(message);
    this.name = "VolunteerApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

// The shared apiClient instance is student-scoped (its token provider returns
// the student JWT), so volunteer requests use a dedicated instance whose
// provider reads the volunteer session token.
const volunteerApiClient = createApiClient({
  getAccessToken: () => getVolunteerSession()?.token ?? null,
});

// Shared ApiError -> VolunteerApiError mapping, used by the round requests
// and the dashboard request alike.
function mapVolunteerApiError(error) {
  if (error instanceof ApiError) {
    if (error.code === API_ERROR_CODES.CONFIGURATION) {
      throw new Error("The organizer side is not set up. Please check the site settings and try again.");
    }
    if (error.code === API_ERROR_CODES.NETWORK) {
      throw new VolunteerApiError({
        message: "Could not reach the site. Check your connection and try again.",
        kind: "network",
      });
    }
    const responseBody = error.responseBody;
    const status = error.status;
    const ok = typeof status === "number" && status >= 200 && status < 300;
    const isObjectPayload = responseBody && typeof responseBody === "object";
    const hasBackendError = isObjectPayload && responseBody.success === false;
    const message =
      typeof responseBody?.message === "string" && responseBody.message
        ? responseBody.message
        : status === 401 || status === 403
          ? "Your organizer session ended. Please sign in again."
          : !ok
            ? `The round action did not work (error ${status}).`
            : "The reply was not understood. Please try again.";
    const kind = !isObjectPayload
      ? ok ? "invalid_response" : "http"
      : !ok
        ? "http"
        : hasBackendError ? "api" : "invalid_response";
    throw new VolunteerApiError({ message, kind, status, code: responseBody?.code });
  }
  throw error;
}

async function volunteerRequest(usn, action = "", body) {
  const session = getVolunteerSession();
  if (!session?.token) throw new Error("Your organizer sign-in is missing. Please sign in again.");
  const suffix = action ? `/${action}` : "";
  const path = `/api/volunteer/students/${encodeURIComponent(usn)}/round${suffix}`;

  let payload;
  try {
    payload = await volunteerApiClient.request(path, {
      method: action ? "POST" : "GET",
      ...(body !== undefined ? { body } : {}),
    });
  } catch (error) {
    mapVolunteerApiError(error);
  }

  if (!payload || typeof payload !== "object" || payload.success !== true) {
    // apiClient only resolves 2xx bodies, and these round endpoints answer 200.
    const hasBackendError = payload && typeof payload === "object" && payload.success === false;
    throw new VolunteerApiError({
      message:
        typeof payload?.message === "string" && payload.message
          ? payload.message
          : "The reply was not understood. Please try again.",
      kind:
        payload && typeof payload === "object" && hasBackendError ? "api" : "invalid_response",
      status: 200,
      code: payload?.code,
    });
  }
  return payload;
}

export function getVolunteerStudentRound(usn) {
  return volunteerRequest(usn);
}

export async function getVolunteerDashboard({ page = 1, limit = 20 } = {}) {
  const session = getVolunteerSession();
  if (!session?.token) throw new Error("Your organizer sign-in is missing. Please sign in again.");

  let payload;
  try {
    payload = await volunteerApiClient.request(
      `/api/volunteer/dashboard?page=${page}&limit=${limit}`
    );
  } catch (error) {
    mapVolunteerApiError(error);
  }

  if (!payload || typeof payload !== "object" || payload.success !== true) {
    throw new VolunteerApiError({
      message:
        typeof payload?.message === "string" && payload.message
          ? payload.message
          : "The reply was not understood. Please try again.",
      kind: "invalid_response",
      status: 200,
      code: payload?.code,
    });
  }
  return payload;
}

export function startVolunteerStudentRound(usn) {
  return volunteerRequest(usn, "start");
}

export function extendVolunteerStudentRound(usn, { extensionSeconds, reason }) {
  const body = { extensionSeconds };
  if (reason !== undefined) body.reason = reason;
  return volunteerRequest(usn, "extend", body);
}

export function resetVolunteerStudentRound(usn) {
  return volunteerRequest(usn, "reset");
}

export function pauseVolunteerStudentRound(usn) {
  return volunteerRequest(usn, "pause");
}

export function resumeVolunteerStudentRound(usn) {
  return volunteerRequest(usn, "resume");
}

export function evaluateVolunteerStudentRound(usn, { result, remarks, programmingLanguage }) {
  const body = { result };
  if (remarks !== undefined) body.remarks = remarks;
  if (programmingLanguage !== undefined) body.programmingLanguage = programmingLanguage;
  return volunteerRequest(usn, "evaluate", body);
}

export function settleVolunteerStudentRound(usn) {
  return volunteerRequest(usn, "settle", {});
}

export function progressVolunteerStudentRound(usn) {
  return volunteerRequest(usn, "progress", {});
}
