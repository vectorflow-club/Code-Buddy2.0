import {
  UserRound,
  LockKeyhole,
  Eye,
  EyeOff,
} from "lucide-react";
import { Brand } from "../../components/ui";
import { useStaffLogin } from "../../hooks/useStaffLogin";
import { loginVolunteer } from "../../services/volunteerAuthService";
import "./volunteer-login.css";

export default function VolunteerLogin() {
  const {
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
  } = useStaffLogin({ login: loginVolunteer, target: "/volunteer/dashboard" });

  return (
    <div className="vol-login-page">
      <div className="vol-login-brand">
        <Brand />
      </div>

      <div className="vol-login-card">
        <div className="vol-login-icon">
          <UserRound size={25} />
        </div>

        <p className="vol-login-eyebrow">ORGANIZER PORTAL</p>

        <h1>Welcome back</h1>

        <p className="vol-login-description">
          Sign in with your organizer username to manage
          your assigned participants and evaluations.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="vol-login-field">
            <label htmlFor="vol-username">Username</label>

            <div className="vol-login-input">
              <UserRound size={18} />

              <input
                id="vol-username"
                type="text"
                placeholder="Enter your organizer username"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError("");
                }}
                autoComplete="username"
                required
              />
            </div>
          </div>

          <div className="vol-login-field">
            <label htmlFor="vol-password">Password</label>

            <div className="vol-login-input">
              <LockKeyhole size={18} />

              <input
                id="vol-password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />

              <button
                type="button"
                className="vol-password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={
                  showPassword ? "Hide password" : "Show password"
                }
              >
                {showPassword ? (
                  <EyeOff size={17} />
                ) : (
                  <Eye size={17} />
                )}
              </button>
            </div>
          </div>

          {error && (
            <p className="vol-login-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="vol-login-button" disabled={loading}>
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <p className="vol-login-footer">
          Login credentials are provided by the competition administrator.
        </p>
      </div>

      <p className="vol-login-bottom">
        CODE BUDDY 2.0 · ORGANIZER ACCESS
      </p>
    </div>
  );
}
