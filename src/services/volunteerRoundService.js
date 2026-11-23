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

async function volunteerRequest(usn, action = "", body) {
  const session = getVolunteerSession();
  if (!session?.token) throw new Error("Your volunteer session is missing. Please sign in again.");
  const suffix = action ? `/${action}` : "";
  const path = `/api/volunteer/students/${encodeURIComponent(usn)}/round${suffix}`;

  let payload;
  try {
    payload = await volunteerApiClient.request(path, {
      method: action ? "POST" : "GET",
      ...(body !== undefined ? { body } : {}),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === API_ERROR_CODES.CONFIGURATION) {
        throw new Error("Volunteer API is not configured. Set VITE_API_BASE_URL and restart the frontend.");
      }
      if (error.code === API_ERROR_CODES.NETWORK) {
        throw new VolunteerApiError({
          message: "Could not reach the server. Check that it is running and try again.",
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
            ? "Your volunteer session is no longer authorized."
            : !ok
              ? `The round request failed (HTTP ${status}).`
              : "The server returned an invalid response.";
      const kind = !isObjectPayload
        ? ok ? "invalid_response" : "http"
        : !ok
          ? "http"
          : hasBackendError ? "api" : "invalid_response";
      throw new VolunteerApiError({ message, kind, status, code: responseBody?.code });
    }
    throw error;
  }

  if (!payload || typeof payload !== "object" || payload.success !== true) {
    // apiClient only resolves 2xx bodies, and these round endpoints answer 200.
    const hasBackendError = payload && typeof payload === "object" && payload.success === false;
    throw new VolunteerApiError({
      message:
        typeof payload?.message === "string" && payload.message
          ? payload.message
          : "The server returned an invalid response.",
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

export function startVolunteerStudentRound(usn) {
  return volunteerRequest(usn, "start");
}

export function extendVolunteerStudentRound(usn, { extensionSeconds, reason }) {
  const body = { extensionSeconds };
  if (reason !== undefined) body.reason = reason;
  return volunteerRequest(usn, "extend", body);
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
