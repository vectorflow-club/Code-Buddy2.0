import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  Users,
  UserCheck,
  Trophy,
  Wallet,
  TrendingUp,
} from "lucide-react";
import { getAdminDashboardStats, getAdminParticipants } from "../../services/adminDataService";
import { displayStatus, formatCurrency, roundStatusLabel, transactionTypeLabel } from "../../utils/formatters";
import "./reports.css";

const roundStatuses = ["ready", "inProgress", "timeExpired", "submitted", "evaluated", "abandoned"];
const transactionTypes = [
  "STAKE_DEBIT",
  "REWARD_CREDIT",
  "REFUND",
  "SAFE_ZONE_PAYOUT",
  "ADMIN_ADJUSTMENT",
  "ROUND_SETTLEMENT",
];

export default function Reports() {
  const [participants, setParticipants] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState("");
  const [participantsError, setParticipantsError] = useState("");

  const loadReports = useCallback(async () => {
    setLoading(true);
    setDashboardError("");
    setParticipantsError("");

    const dashboardRequest = getAdminDashboardStats()
      .then((stats) => setDashboard(stats))
      .catch((loadError) => setDashboardError(loadError.message || "Could not load the numbers."));

    const participantsRequest = getAdminParticipants()
      .then((participantData) => setParticipants(participantData.map((participant) => ({
        id: participant.id,
        name: participant.name,
        usn: participant.usn || "—",
        level: participant.currentLevel,
        prize: participant.walletBalance,
        status: displayStatus(participant.competitionStatus),
      }))))
      .catch((loadError) => setParticipantsError(loadError.message || "Could not load the student list."));

    await Promise.all([dashboardRequest, participantsRequest]);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const levelRows = useMemo(() => Array.from({ length: 6 }, (_, index) => {
    const number = index + 1;
    const value = dashboard?.levels?.[`L${number}`] || {};
    return {
      level: number,
      reached: value.reachedCount ?? null,
      cleared: value.clearedCount ?? null,
    };
  }), [dashboard]);

  const totalBalance = dashboard?.wallet?.totalWalletBalance ?? null;
  const participantStats = dashboard?.participants;
  const activeParticipantCount = participantStats && [
    participantStats.registered,
    participantStats.inProgress,
    participantStats.cleared,
  ].every(Number.isFinite)
    ? participantStats.registered + participantStats.inProgress + participantStats.cleared
    : null;
  const stats = [
    { label: "Total students", value: participantStats?.total ?? null, icon: Users },
    { label: "Still playing", value: activeParticipantCount, icon: UserCheck },
    { label: "Eliminated", value: participantStats?.eliminated ?? null, icon: TrendingUp },
    { label: "Completed", value: participantStats?.completed ?? null, icon: Trophy },
  ];
  const requestErrors = [dashboardError, participantsError].filter(Boolean);

  const exportCSV = () => {
    const headers = ["Name", "USN", "Current Level", "Money now", "Status"];
    const rows = participants.map((participant) => [
      participant.name,
      participant.usn,
      participant.level,
      participant.prize,
      participant.status,
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "code-buddy-participant-report.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="reports-page">
      <div className="reports-header">
        <div>
          <span className="reports-eyebrow">ADMIN / NUMBERS</span>
          <h1>Competition Reports</h1>
          <p>See how students are doing and the results.</p>
        </div>
        <button className="reports-export-btn" onClick={exportCSV} disabled={loading || !!participantsError}>
          <Download size={17} />
          Export CSV
        </button>
      </div>

      {requestErrors.length > 0 && (
        <div className="reports-demo-note" role="alert">
          {dashboardError && dashboard && "The numbers did not refresh. What you see may be old. "}
          {participantsError && participants.length > 0 && "The student rows may be old. "}
          {requestErrors.join(" ")} <button type="button" onClick={loadReports}>Retry</button>
        </div>
      )}
      {loading && <div className="reports-demo-note" role="status">{dashboard || participants.length > 0 ? "Getting new numbers. The old ones stay until then." : "Loading reports…"}</div>}
      {!loading && requestErrors.length === 0 && <div className="reports-demo-note">Live numbers.</div>}

      <section className="reports-stats">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div className="reports-stat-card" key={stat.label}>
              <div className="reports-stat-icon"><Icon size={21} /></div>
              <div><span>{stat.label}</span><strong>{dashboard ? (stat.value ?? "Not shown") : loading ? "—" : "Not shown"}</strong></div>
            </div>
          );
        })}
      </section>

      <div className="reports-grid">
        <section className="reports-panel">
          <div className="reports-section-heading">
            <div><h2>Level results</h2><p>How students did on all six levels</p></div>
          </div>
          <div className="level-report-list">
            {!dashboard && loading ? (
              <p role="status">Loading level results...</p>
            ) : !dashboard ? (
              <p role="alert">Level results are not shown because the numbers did not load.</p>
            ) : (
              levelRows.map((item) => {
                const percentage = item.reached > 0 && item.cleared !== null
                  ? (item.cleared / item.reached) * 100
                  : 0;
                return (
                  <div className="level-report-row" key={item.level}>
                    <div className="level-report-label">
                      <strong>Level {item.level}</strong>
                      <span>{item.cleared ?? "—"} / {item.reached ?? "—"} cleared</span>
                    </div>
                    <div className="level-report-track"><div style={{ width: `${Math.min(100, percentage)}%` }} /></div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="reports-panel">
          <div className="reports-section-heading">
            <div><h2>Prizes to pay</h2><p>Money students have now</p></div>
            <Wallet size={20} />
          </div>
          {!dashboard && loading ? (
            <p className="reports-muted" role="status">Loading prizes...</p>
          ) : !dashboard ? (
            <p className="reports-muted" role="alert">Prizes are not shown because the numbers did not load.</p>
          ) : (
            <>
              <div className="prize-total">{totalBalance === null ? "Not shown" : formatCurrency(Number(totalBalance))}</div>
              <span className="reports-muted">All students' money put together</span>
              {participantsError ? (
                <p className="reports-muted" role="alert">Money split by student status is not shown: {participantsError}</p>
              ) : (
                <div className="prize-breakdown">
                  {["ACTIVE", "ELIMINATED", "COMPLETED"].map((status) => {
                    const amount = participants.filter((participant) => participant.status === status)
                      .reduce((sum, participant) => sum + (Number(participant.prize) || 0), 0);
                    return (
                      <div key={status}>
                        <span>{status.charAt(0) + status.slice(1).toLowerCase()} students</span>
                        <strong>{formatCurrency(amount)}</strong>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <div className="reports-grid">
        <section className="reports-panel">
          <div className="reports-section-heading"><div><h2>Rounds</h2><p>Round counts for the whole competition</p></div></div>
          {!dashboard && loading ? <p className="reports-muted" role="status">Loading round totals...</p> : !dashboard ? <p className="reports-muted" role="alert">Round totals are not shown because the numbers did not load.</p> : (
            <div className="reports-table-wrap">
              <table className="reports-table">
                <thead><tr><th>Round state</th><th>Count</th></tr></thead>
                <tbody>
                  {roundStatuses.map((status) => <tr key={status}><td>{roundStatusLabel(status)}</td><td>{dashboard.rounds?.byStatus?.[status] ?? "—"}</td></tr>)}
                  <tr><td><strong>Total</strong></td><td><strong>{dashboard.rounds?.total ?? "—"}</strong></td></tr>
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="reports-panel">
          <div className="reports-section-heading"><div><h2>Money totals</h2><p>Counts and amounts by type of money move</p></div></div>
          {!dashboard && loading ? <p className="reports-muted" role="status">Loading money totals...</p> : !dashboard ? <p className="reports-muted" role="alert">Money totals are not shown because the numbers did not load.</p> : (
            <div className="reports-table-wrap">
              <table className="reports-table">
                <thead><tr><th>Type of money move</th><th>Count</th><th>Total</th></tr></thead>
                <tbody>
                  {transactionTypes.map((type) => {
                    const totals = dashboard.transactions?.byType?.[type];
                    return <tr key={type}><td>{transactionTypeLabel(type)}</td><td>{totals?.count ?? "—"}</td><td>{totals?.totalAmount === undefined ? "—" : formatCurrency(Number(totals.totalAmount))}</td></tr>;
                  })}
                  <tr><td><strong>Total</strong></td><td><strong>{dashboard.transactions?.total ?? "—"}</strong></td><td><strong>{dashboard.transactions?.totalAmount === undefined ? "—" : formatCurrency(Number(dashboard.transactions.totalAmount))}</strong></td></tr>
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="reports-panel volunteer-performance">
        <div className="reports-section-heading">
          <div><h2>Organizer results</h2><p>Results given by each organizer</p></div>
        </div>
        <div className="reports-table-wrap">
          <table className="reports-table">
            <thead><tr><th>Organizer</th><th>Students</th><th>Results given</th><th>Waiting</th><th>Done</th></tr></thead>
            <tbody><tr><td colSpan="5">Totals for each organizer are not ready yet.</td></tr></tbody>
          </table>
        </div>
      </section>

      <section className="reports-panel participant-results">
        <div className="reports-section-heading">
          <div><h2>Student results</h2><p>How each student is doing</p></div>
          <span className="reports-record-count">{participantsError ? "Not shown" : `${participants.length} students`}</span>
        </div>
        <div className="reports-table-wrap">
          <table className="reports-table">
            <thead><tr><th>Student</th><th>USN</th><th>Level</th><th>Money now</th><th>Status</th></tr></thead>
            <tbody>
              {participants.map((participant) => (
                <tr key={participant.id}>
                  <td>{participant.name}</td>
                  <td>{participant.usn}</td>
                  <td>Level {participant.level}</td>
                  <td>{formatCurrency(Number(participant.prize || 0))}</td>
                  <td><span className={`report-status ${participant.status.toLowerCase()}`}>{participant.status}</span></td>
                </tr>
              ))}
              {loading && participants.length === 0 && <tr><td colSpan="5" role="status">Loading student results...</td></tr>}
              {!loading && participantsError && <tr><td colSpan="5" role="alert">Student results are not shown: {participantsError}</td></tr>}
              {!loading && !participantsError && participants.length === 0 && <tr><td colSpan="5">No students found.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
