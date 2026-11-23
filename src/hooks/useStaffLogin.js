import { useState } from "react";
import { useNavigate } from "react-router-dom";

// Shared sign-in logic for the admin and volunteer login pages. The pages
// keep their own markup, styles, and field behaviour (they genuinely
// differ — required attributes, error clearing, copy); only the submit
// flow is identical.
export function useStaffLogin({ login, target }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!username.trim() || !password) {
      setError("Please enter your username and password.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await login(username.trim(), password);
      navigate(target, { replace: true });
    } catch (loginError) {
      setError(loginError.message || "Unable to sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return {
    username,
    setUsername,
    password,
    setPassword,
    showPassword,
    setShowPassword,
    error,
    setError,
    loading,
    handleSubmit,
  };
}
