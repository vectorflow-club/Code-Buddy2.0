import { useCallback } from "react";
import { Users, UserX, Trophy, Wallet, Activity } from "lucide-react";
import { SectionHeading, MetricCard } from "../../components/ui";
import { useFetchState } from "../../hooks/useFetchState";
import { getAdminDashboardStats } from "../../services/adminDataService";

const emptyStats = [
  { label: "Students signed up", value: "—", caption: "Finished signing up" },
  { label: "Still playing", value: "—", caption: "Signed up, playing, or cleared a level" },
  { label: "Eliminated", value: "—", caption: "Out of the game" },
  { label: "Completed", value: "—", caption: "Finished all levels" },
];

export default function AdminDashboard() {
  const fetchDashboard = useCallback(() => getAdminDashboardStats(), []);
  const { data: dashboard, loading, error, reload: loadDashboard } = useFetchState(fetchDashboard, {
    initialData: null,
    errorMessage: "Could not load the numbers.",
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
        kicker="MANAGE THE COMPETITION"
        title="Admin overview."
        detail="Watch the students and run the Code Buddy competition."
      />

      <div className="admin-welcome">
        <div>
          <span className="admin-eyebrow">VVCE CODE SPRINT</span>
          <h2>Control room.</h2>
          <p>Questions, levels, organizers and students.</p>
        </div>
        <Activity size={38} />
      </div>

      <SectionHeading
        kicker="LIVE NUMBERS"
        title="Competition at a glance."
        detail="Live numbers."
      />

      {error && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" onClick={loadDashboard}>Retry</button>
        </div>
      )}
      {loading && <p role="status">Loading the numbers…</p>}

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
        title="Shortcuts."
        detail="Go to the main pages."
      />

      <div className="admin-quick-grid">
        {[
          { title: "Question Bank", detail: "Add coding questions.", icon: Trophy },
          { title: "Students", detail: "See students who signed up.", icon: Users },
          { title: "Organizers", detail: "Organizer accounts.", icon: UserX },
          { title: "Money records", detail: "See money moves.", icon: Wallet },
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
