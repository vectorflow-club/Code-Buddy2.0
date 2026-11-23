import { createApiClient, ApiError, API_ERROR_CODES } from "./apiClient";

// Login requests carry no session token, and the shared apiClient instance is
// student-scoped (its token provider returns the student JWT), so staff auth
// uses its own unauthenticated client for login. Session validation builds a
// per-call client whose provider returns the token being validated.
const publicApiClient = createApiClient();

function safeBackendMessage(payload, fallback) {
  if (payload?.success !== false) return fallback;
  const message = payload?.message;
  if (typeof message !== "string" || !message.trim()) return fallback;

  const normalized = message.trim();
  if (/\bat\s+\S+\s*\(/i.test(normalized) || /\n\s*at\s+/i.test(normalized)) {
    return fallback;
  }
  return normalized.slice(0, 500);
}

function authError(message, code, status) {
  return Object.assign(new Error(message), { code, status });
}

function isStaffProfile(value, role) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.id === "string" && value.id.trim() &&
    typeof value.name === "string" &&
    typeof value.username === "string" &&
    value.role === role &&
    typeof value.isActive === "boolean",
  );
}

function is2xx(status) {
  return typeof status === "number" && status >= 200 && status < 300;
}

/**
 * One role-parameterized staff auth service for the admin and volunteer
 * username/password logins. The two roles differ in ways this factory keeps
 * as configuration, not forced sameness:
 *
 * - Session storage key, profile field, role string, endpoints, messages.
 * - Login failure handling: admin branches on the backend error code
 *   (knownLoginErrors) and prefers the sanitized backend message, while
 *   volunteer branches on the HTTP status with fixed messages.
 * - Admin validates the returned profile shape after login; volunteer does
 *   not (validateProfileOnLogin).
 *
 * Student auth (studentAuthenticationService) is deliberately NOT part of
 * this factory: it is a Google-OAuth flow with its own token/mode storage,
 * registration step, and session restore, which shares nothing with the
 * staff username/password flow beyond the transport.
 */
export function createStaffAuthService(config) {
  const {
    sessionKey,
    profileKey,
    role,
    loginPath,
    mePath,
    notConfiguredMessage,
    loginNetworkMessage,
    validateNetworkMessage,
    loginStrategy,
    knownLoginErrors,
    loginFailedMessage,
    loginInvalidMessage,
    statusLoginErrors,
    serverLoginMessage,
    validateProfileOnLogin,
    sessionExpiredMessage,
    sessionRetryMessage,
    sessionInvalidMessage,
  } = config;

  function getSession() {
    try {
      const session = JSON.parse(sessionStorage.getItem(sessionKey) || "null");
      return session?.token && session?.[profileKey] ? session : null;
    } catch {
      sessionStorage.removeItem(sessionKey);
      return null;
    }
  }

  function storeSession(session) {
    sessionStorage.setItem(sessionKey, JSON.stringify(session));
  }

  function clearSession() {
    sessionStorage.removeItem(sessionKey);
  }

  // Admin-style login failure: branch on the backend error code, preferring
  // the sanitized backend message over the friendly fallback.
  function handleCodeLoginFailure(body, status, ok, validJson) {
    const backendCode = typeof body?.code === "string" ? body.code : "";
    if (knownLoginErrors[backendCode]) {
      throw authError(
        safeBackendMessage(body, knownLoginErrors[backendCode]),
        backendCode,
        status,
      );
    }
    const fallback = !validJson || !ok ? loginFailedMessage : loginInvalidMessage;
    throw authError(
      safeBackendMessage(body, fallback),
      backendCode || (ok ? "INVALID_RESPONSE" : "LOGIN_FAILED"),
      status,
    );
  }

  // Volunteer-style login failure: branch on the HTTP status with fixed
  // messages; the backend message is never surfaced.
  function handleStatusLoginFailure(body, status) {
    const entry = statusLoginErrors[status];
    if (entry) {
      throw Object.assign(new Error(entry.message), { code: entry.code });
    }
    throw Object.assign(new Error(serverLoginMessage), {
      code: "SERVER_ERROR",
      status,
    });
  }

  function handleLoginFailure(body, status, ok, validJson) {
    if (loginStrategy === "status") {
      handleStatusLoginFailure(body, status);
    } else {
      handleCodeLoginFailure(body, status, ok, validJson);
    }
  }

  async function login(username, password) {
    let payload;
    try {
      payload = await publicApiClient.post(loginPath, { username, password });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === API_ERROR_CODES.NETWORK) {
          throw Object.assign(new Error(loginNetworkMessage), { code: "NETWORK_ERROR" });
        }
        if (error.code === API_ERROR_CODES.CONFIGURATION) {
          throw Object.assign(new Error(notConfiguredMessage), { code: "API_NOT_CONFIGURED" });
        }
        const body = error.responseBody;
        const status = error.status;
        handleLoginFailure(body, status, is2xx(status), body !== null && !error.invalidJson);
      }
      throw error;
    }
    if (payload?.success !== true || !payload?.token || !payload?.[profileKey]) {
      // apiClient only resolves 2xx bodies, and these login endpoints answer 200.
      // A null payload means an empty body, which the old fetch code read as invalid JSON.
      handleLoginFailure(payload, 200, true, payload !== null);
    }
    if (
      validateProfileOnLogin &&
      (!isStaffProfile(payload[profileKey], role) ||
        typeof payload.token !== "string" ||
        !payload.token.trim())
    ) {
      throw authError(loginInvalidMessage, "INVALID_RESPONSE", 200);
    }

    const session = { token: payload.token, [profileKey]: payload[profileKey] };
    storeSession(session);
    return session;
  }

  async function validateSession(token) {
    const tokenClient = createApiClient({ getAccessToken: () => token });
    let payload;
    try {
      payload = await tokenClient.get(mePath);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === API_ERROR_CODES.NETWORK) {
          throw Object.assign(new Error(validateNetworkMessage), { code: "NETWORK_ERROR" });
        }
        if (error.code === API_ERROR_CODES.CONFIGURATION) {
          throw Object.assign(new Error(notConfiguredMessage), { code: "API_NOT_CONFIGURED" });
        }
        const body = error.responseBody;
        const status = error.status;
        if (!is2xx(status)) {
          const backendCode = typeof body?.code === "string" ? body.code : "";
          const message = safeBackendMessage(
            body,
            status === 401 || status === 403 ? sessionExpiredMessage : sessionRetryMessage,
          );
          if (status >= 500) {
            throw authError(message, backendCode || "SERVER_ERROR", status);
          }
          throw authError(message, "SESSION_EXPIRED", status);
        }
        // 2xx but unparsable: the old fetch code read this as invalid JSON.
        throw authError(safeBackendMessage(body, sessionInvalidMessage), "SESSION_EXPIRED", status);
      }
      throw error;
    }

    if (
      payload === null ||
      payload?.success !== true ||
      !isStaffProfile(payload?.[profileKey], role)
    ) {
      throw authError(
        safeBackendMessage(payload, sessionInvalidMessage),
        "SESSION_EXPIRED",
        200,
      );
    }

    return payload[profileKey];
  }

  return { getSession, storeSession, clearSession, login, validateSession };
}
