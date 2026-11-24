
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { StudentProvider, useStudent } from './context/StudentContext';
import StudentLayout from './components/StudentLayout';
import { ErrorState, LoadingState } from './components/ui';

import DashboardPage from './pages/DashboardPage';
import RoundPage from './pages/RoundPage';
import OutcomePage from './pages/OutcomePage';
import AuthPage from './pages/AuthPage';
import RecordsPage from './pages/RecordsPage';
import ProfilePage from './pages/ProfilePage';
import WalletPage from './pages/WalletPage';
import HistoryPage from './pages/HistoryPage';

import AdminLayout from './components/admin/AdminLayout';
import AdminDashboard from './pages/admin/AdminDashboard';
import QuestionManagement from './pages/admin/QuestionManagement';
import ParticipantManagement from './pages/admin/ParticipantManagement';
import VolunteerManagement from './pages/admin/VolunteerManagement';
import Reports from './pages/admin/Reports';
import LevelManagement from './pages/admin/LevelManagement';
import RoundsManagement from './pages/admin/RoundsManagement';
import TransactionsManagement from './pages/admin/TransactionsManagement';
import AdminLogin from './pages/admin/AdminLogin';

import VolunteerLayout from './components/volunteer/VolunteerLayout';
import VolunteerDashboard from './pages/volunteer/VolunteerDashboard';
import VolunteerLogin from './pages/volunteer/VolunteerLogin';
import EvaluationWorkspace from './pages/volunteer/EvaluationWorkspace';

// The student session gate, as a layout route: it shows the loading state
// or the student error page until the student session is known, then renders
// the student subtree. Only student routes sit behind this gate, so /admin/*
// and /volunteer/* render independently: a student session problem (or a
// down backend) never blocks the admin or organizer side.
function StudentSessionGate() {
  const { state, loading, loadError, refresh } = useStudent();

  if (loading) return <LoadingState />;

  if (!state && loadError) {
    return (
      <main className="page">
        <ErrorState
          message={
            loadError.message ||
            'We could not load your session.'
          }
        />
        <button
          className="button button-dark"
          onClick={() => refresh().catch(() => {})}
        >
          Retry
        </button>
      </main>
    );
  }

  if (!state) return <LoadingState />;

  return <Outlet />;
}

function StudentLoginRoute() {
  const { state } = useStudent();
  return state.auth?.signedIn === true ? (
    <Navigate to="/dashboard" replace />
  ) : (
    <AuthPage mode="login" />
  );
}

function StudentRegisterRoute() {
  const { state } = useStudent();
  if (state.auth?.signedIn === true) {
    return <Navigate to="/dashboard" replace />;
  }
  if (state.pendingIdentity) {
    return <AuthPage mode="register" />;
  }
  return <Navigate to="/login" replace />;
}

function StudentHomeRoute() {
  const { state } = useStudent();
  return (
    <Navigate
      to={state.auth?.signedIn === true ? '/dashboard' : '/login'}
      replace
    />
  );
}

function StudentProtectedLayout() {
  const { state } = useStudent();
  return state.auth?.signedIn === true ? (
    <StudentLayout />
  ) : (
    <Navigate to="/login" replace />
  );
}

function AppRoutes() {
  return (
    <Routes>
      {/* Student routes, gated on the student session only */}
      <Route element={<StudentSessionGate />}>
        <Route path="/login" element={<StudentLoginRoute />} />

        <Route path="/register" element={<StudentRegisterRoute />} />

        <Route path="/" element={<StudentHomeRoute />} />

        <Route element={<StudentProtectedLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/records" element={<RecordsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/round" element={<RoundPage />} />
          <Route path="/result/:result" element={<OutcomePage />} />
          <Route
            path="*"
            element={<Navigate to="/dashboard" replace />}
          />
        </Route>
      </Route>

      {/* Admin routes */}
      <Route path="/admin/login" element={<AdminLogin />} />

      <Route path="/admin" element={<AdminLayout />}>
        <Route
          index
          element={<Navigate to="dashboard" replace />}
        />
        <Route path="dashboard" element={<AdminDashboard />} />
        <Route path="questions" element={<QuestionManagement />} />
        <Route path="levels" element={<LevelManagement />} />
        <Route path="participants" element={<ParticipantManagement />} />
        <Route path="volunteers" element={<VolunteerManagement />} />
        <Route path="reports" element={<Reports />} />
        <Route path="rounds" element={<RoundsManagement />} />
        <Route path="transactions" element={<TransactionsManagement />} />
      </Route>

      {/* Volunteer routes */}
      <Route
        path="/volunteer/login"
        element={<VolunteerLogin />}
      />

      <Route path="/volunteer" element={<VolunteerLayout />}>
        <Route
          index
          element={<Navigate to="dashboard" replace />}
        />
        <Route
          path="dashboard"
          element={<VolunteerDashboard />}
        />
        <Route
          path="evaluations"
          element={<EvaluationWorkspace />}
        />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <StudentProvider>
      <AppRoutes />
    </StudentProvider>
  );
}
