import { createApiClient, ApiError, API_ERROR_CODES } from "./apiClient";
import { getAdminSession } from "./adminAuthService";

// The shared apiClient instance is student-scoped (its token provider returns
// the student JWT), so admin requests use a dedicated instance whose provider
// reads the admin session token.
const adminApiClient = createApiClient({
  getAccessToken: () => getAdminSession()?.token ?? null,
});

/**
 * Build an admin request helper on top of the shared apiClient transport.
 * The four admin data services share this shape and differ only in their
 * error type and messages, which stay as configuration:
 *
 * - makeError(message, { status, code, kind }): the service's error
 *   constructor. Plain-Error services ignore the metadata.
 * - sessionMessage / configMessage / networkMessage / unauthorizedMessage:
 *   the service's exact strings.
 * - failureMessage(status): the service's generic-failure template.
 */
export function createAdminRequest({
  makeError,
  sessionMessage,
  configMessage,
  networkMessage,
  unauthorizedMessage,
  failureMessage,
}) {
  return async function adminRequest(path, options = {}) {
    const session = getAdminSession();
    if (!session?.token) {
      throw makeError(sessionMessage, { kind: "session" });
    }

    let payload;
    try {
      payload = await adminApiClient.request(path, options);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === API_ERROR_CODES.CONFIGURATION) {
          throw new Error(configMessage);
        }
        if (error.code === API_ERROR_CODES.NETWORK) {
          throw makeError(networkMessage, { kind: "network" });
        }
        const body = error.responseBody;
        const status = error.status;
        if (status === 401 || status === 403) {
          throw makeError(body?.message || unauthorizedMessage, {
            status,
            code: body?.code || null,
            kind: "authorization",
          });
        }
        throw makeError(body?.message || failureMessage(status), {
          status,
          code: body?.code || null,
        });
      }
      throw error;
    }

    if (payload?.success !== true) {
      // apiClient only resolves 2xx bodies, and these admin endpoints answer 200.
      throw makeError(payload?.message || failureMessage(200), {
        status: 200,
        code: payload?.code || null,
      });
    }
    return payload;
  };
}
