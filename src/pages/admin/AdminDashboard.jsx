import { useCallback } from "react";
import { Users, UserX, Trophy, Wallet, Activity } from "lucide-react";
import { SectionHeading, MetricCard } from "../../components/ui";
import { useFetchState } from "../../hooks/useFetchState";
import { getAdminDashboardStats } from "../../services/adminDataService";

const emptyStats = [
  { label: "Registered Students", value: "—", caption: "Completed student registration" },
  { label: "Active Participants", value: "—", caption: "Registered, in progress, or cleared" },
  { label: "Eliminated", value: "—", caption: "Competition records" },
  { label: "Completed", value: "—", caption: "Finished all levels" },
];

export default function AdminDashboard() {
  const fetchDashboard = useCallback(() => getAdminDashboardStats(), []);
  const { data: dashboard, loading, error, reload: loadDashboard } = useFetchState(fetchDashboard, {
    initialData: null,
    errorMessage: "Could not load competition statistics.",
  });

  const participants = dashboard?.participants;
  const stats = dashboard
    ? [
        { ...emptyStats[0], value: participants?.registrationComplete ?? 0 },
        { ...emptyStats[1], value: (participants?.registered ?? 0) + (participants?.inProgress ?? 0) + (participants?.cleared ?? 0) },
        { ...emptyStats[2], value: participants?.eliminated ?? 0 },
        { ...emptyStats[3], value: participants?.completed ?? 0 },
      ]
    : emptyStats;

  return (
    <div className="admin-dashboard">
      <SectionHeading
        kicker="COMPETITION MANAGEMENT"
        title="Admin overview."
        detail="Monitor participants and manage the Code Buddy competition."
      />

      <div className="admin-welcome">
        <div>
          <span className="admin-eyebrow">VVCE CODE SPRINT</span>
          <h2>Competition control center.</h2>
          <p>Manage questions, levels, organizers and participants.</p>
        </div>
        <Activity size={38} />
      </div>

      <SectionHeading
        kicker="LIVE STATISTICS"
        title="Competition at a glance."
        detail="Live competition statistics."
      />

      {error && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={loadDashboard}>Retry</button>
        </div>
      )}
      {loading && <p role="status">Loading competition statistics…</p>}

      <div className="admin-stats-grid">
        {stats.map((item, index) => (
          <MetricCard
            key={item.label}
            label={item.label}
            value={item.value}
            caption={item.caption}
            accent={index === 0}
          />
        ))}
      </div>

      <SectionHeading
        kicker="QUICK ACCESS"
        title="Management shortcuts."
        detail="Navigate to the main competition management areas."
      />

      <div className="admin-quick-grid">
        {[
          { title: "Question Bank", detail: "Add and manage coding questions.", icon: Trophy },
          { title: "Participants", detail: "View registered students.", icon: Users },
          { title: "Organizers", detail: "Manage organizer accounts.", icon: UserX },
          { title: "Wallet Records", detail: "Review competition transactions.", icon: Wallet },
        ].map(({ title, detail, icon: Icon }) => (
          <article className="admin-quick-card" key={title}>
            <Icon size={22} />
            <h3>{title}</h3>
            <p>{detail}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
