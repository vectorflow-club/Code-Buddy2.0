import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  ClipboardList,
  LogOut,
} from "lucide-react";
import { Brand } from "../ui";
import { useStaffSession } from "../../hooks/useStaffSession";
import {
  clearVolunteerSession,
  getVolunteerSession,
  storeVolunteerSession,
  validateVolunteerSession,
} from "../../services/volunteerAuthService";
import "./volunteer-layout.css";

// Module-level so the session hook's validate callback stays stable.
const VOLUNTEER_EXPIRED_CODES = ["SESSION_EXPIRED"];

export default function VolunteerLayout() {
  const { session, checking, validationError, validateSession, handleLogout } = useStaffSession({
    getSession: getVolunteerSession,
    storeSession: storeVolunteerSession,
    clearSession: clearVolunteerSession,
    validateToken: validateVolunteerSession,
    loginPath: "/volunteer/login",
    profileKey: "volunteer",
    expiredCodes: VOLUNTEER_EXPIRED_CODES,
    validateErrorMessage: "We could not check the organizer sign-in.",
  });

  if (checking) return <div role="status" style={{ padding: 24 }}>Checking organizer session…</div>;
  if (!session && validationError) {
    return (
      <div role="alert" style={{ padding: 24 }}>
        <p>{validationError}</p>
        <button type="button" onClick={validateSession}>Retry</button>{" "}
        <button type="button" onClick={handleLogout}>Return to sign in</button>
      </div>
    );
  }
  if (!session) return null;

  const volunteerName = session.volunteer.name || "Organizer";

  return (
    <div className="vol-layout">
      <aside className="vol-sidebar">
        <div className="vol-brand">
          <Brand />
        </div>

        <p className="vol-nav-label">WORKSPACE</p>

        <nav className="vol-nav">
          <NavLink
            to="/volunteer/dashboard"
            className={({ isActive }) =>
              isActive ? "vol-nav-link vol-active" : "vol-nav-link"
            }
          >
            <LayoutDashboard size={18} />
            <span>Dashboard</span>
          </NavLink>

          <NavLink
            to="/volunteer/evaluations"
            className="vol-nav-link"
          >
            <ClipboardList size={18} />
            <span>Results</span>
          </NavLink>
        </nav>

        <div className="vol-sidebar-bottom">
          <div className="vol-user">
            <div className="vol-avatar">{volunteerName.charAt(0).toUpperCase()}</div>
            <div>
              <strong>{volunteerName}</strong>
              <span>Organizer</span>
            </div>
          </div>

          <button
            className="vol-logout"
            type="button"
            onClick={handleLogout}
          >
            <LogOut size={17} />
            Log out
          </button>
        </div>
      </aside>

      <main className="vol-main">
        <Outlet />
      </main>
    </div>
  );
}
