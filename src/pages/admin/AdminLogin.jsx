import { Eye, EyeOff, LockKeyhole, UserRound } from "lucide-react";
import { Brand } from "../../components/ui";
import { useStaffLogin } from "../../hooks/useStaffLogin";
import { loginAdmin } from "../../services/adminAuthService";
import "./admin-login.css";

export default function AdminLogin() {
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
  } = useStaffLogin({ login: loginAdmin, target: "/admin/dashboard" });

  return (
    <div className="admin-login-page">
      <div className="admin-login-brand">
        <Brand />
      </div>

      <div className="admin-login-card">
        <div className="admin-login-icon">
          <LockKeyhole size={25} />
        </div>

        <span className="admin-login-eyebrow">ADMIN PORTAL</span>
        <h1>Welcome back</h1>
        <p className="admin-login-subtitle">
          Sign in to manage the Code Buddy competition.
        </p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="admin-username">Username</label>

          <div className="admin-login-input">
            <UserRound size={17} />
            <input
              id="admin-username"
              type="text"
              autoComplete="username"
              placeholder="Enter your admin username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError("");
              }}
            />
          </div>

          <label htmlFor="admin-password">Password</label>

          <div className="admin-login-input">
            <LockKeyhole size={17} />
            <input
              id="admin-password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
            />
            <button
              type="button"
              className="admin-password-toggle"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>

          {error && <p className="admin-login-error">{error}</p>}

          <button type="submit" className="admin-login-submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="admin-login-footer">
          Admins only
        </p>
      </div>
    </div>
  );
}
