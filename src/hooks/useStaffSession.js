import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

// Shared session validation for the admin and volunteer layouts: read the
// stored session, validate it against the backend, refresh the stored
// profile, and send expired sessions back to sign-in. The two roles differ
// only in configuration — notably, admin also treats INVALID_SESSION as
// expired, volunteer does not. The layouts keep their own shells and their
// own checking/error copy.
export function useStaffSession({
  getSession,
  storeSession,
  clearSession,
  validateToken,
  loginPath,
  profileKey,
  expiredCodes,
  validateErrorMessage,
}) {
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [validationError, setValidationError] = useState("");

  const validateSession = useCallback(async () => {
    const storedSession = getSession();
    if (!storedSession) {
      navigate(loginPath, { replace: true });
      return;
    }

    setChecking(true);
    setValidationError("");
    try {
      const profile = await validateToken(storedSession.token);
      const refreshedSession = { ...storedSession, [profileKey]: profile };
      storeSession(refreshedSession);
      setSession(refreshedSession);
    } catch (error) {
      if (expiredCodes.includes(error.code)) {
        clearSession();
        navigate(loginPath, { replace: true });
      } else {
        setValidationError(error.message || validateErrorMessage);
      }
    } finally {
      setChecking(false);
    }
  }, [navigate, getSession, storeSession, clearSession, validateToken, loginPath, profileKey, expiredCodes, validateErrorMessage]);

  useEffect(() => {
    validateSession();
  }, [validateSession]);

  const handleLogout = () => {
    clearSession();
    navigate(loginPath, { replace: true });
  };

  return { session, checking, validationError, validateSession, handleLogout };
}
