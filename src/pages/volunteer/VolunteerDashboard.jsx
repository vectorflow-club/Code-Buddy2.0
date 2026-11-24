import {
  Users,
  Clock,
  CheckCircle2,
  ClipboardList,
  Search,
  CircleUserRound,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./volunteer-dashboard.css";
import { getVolunteerSession } from "../../services/volunteerAuthService";
import {
  getVolunteerDashboard,
  getVolunteerStudentRound,
  startVolunteerStudentRound,
  evaluateVolunteerStudentRound,
  settleVolunteerStudentRound,
  progressVolunteerStudentRound,
} from "../../services/volunteerRoundService";
import { formatCurrency } from "../../utils/formatters";

// Friendly status for a roster row, from the raw competition/round state the
// dashboard endpoint returns. Tone maps to the existing status-tag styles.
function rosterStatus(entry) {
  if (entry.competitionStatus === "stopped") return { label: "Stopped", tone: "neutral" };
  if (entry.competitionStatus === "eliminated") return { label: "Eliminated", tone: "neutral" };
  if (entry.competitionStatus === "completed") return { label: "Completed", tone: "completed" };
  switch (entry.roundStatus) {
    case "ready":
      return { label: "Question ready", tone: "pending" };
    case "inProgress":
      return { label: "Solving now", tone: "pending" };
    case "timeExpired":
      return { label: "Time expired", tone: "pending" };
    case "submitted":
      return { label: "Needs evaluation", tone: "pending" };
    case "evaluated":
      return { label: "Evaluated", tone: "completed" };
    default:
      return entry.levelsCleared > 0
        ? { label: "Between levels", tone: "neutral" }
        : { label: "Registered", tone: "neutral" };
  }
}

export default function VolunteerDashboard() {
  const volunteerSession = getVolunteerSession();
  const volunteerName = volunteerSession?.volunteer?.name || "Organizer";
  const organizerSpot = volunteerSession?.volunteer?.assignedLab || "";
  const navigate = useNavigate();
  const [usn, setUsn] = useState("");
  const [lookupPending, setLookupPending] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const lookupInProgress = useRef(false);

  const [dashboard, setDashboard] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState("");
  const [page, setPage] = useState(1);
  const [rowBusy, setRowBusy] = useState(null);
  const [rowError, setRowError] = useState("");

  const loadDashboard = useCallback(async (pageToLoad, silent = false) => {
    if (!silent) setDashboardLoading(true);
    setDashboardError("");
    try {
      const data = await getVolunteerDashboard({ page: pageToLoad, limit: 20 });
      setDashboard(data);
    } catch (error) {
      setDashboardError(error?.message || "The dashboard could not be loaded. Please try again.");
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard(page);
  }, [page, loadDashboard]);

  const refreshDashboard = useCallback(
    () => loadDashboard(page, true),
    [loadDashboard, page]
  );

  // Keep the roster live while the organizer watches this page: students
  // allocate new levels from their phones, and without a refresh the row
  // keeps its old state (no Start button for a freshly allocated round).
  // Same 10-second cadence as the student dashboard. Silent, so the table
  // does not flash a loading state; paused while a row action is in
  // flight, and the interval is cleaned up on unmount and page change.
  useEffect(() => {
    if (rowBusy) return undefined;
    const timerId = window.setInterval(() => {
      refreshDashboard();
    }, 10000);
    return () => window.clearInterval(timerId);
  }, [refreshDashboard, rowBusy]);

  async function handleLookup(event) {
    event.preventDefault();
    if (lookupInProgress.current) return;

    const trimmedUsn = usn.trim();
    if (!trimmedUsn) {
      setLookupError("Enter a USN to look up a participant.");
      return;
    }

    lookupInProgress.current = true;
    setLookupPending(true);
    setLookupError("");

    try {
      const response = await getVolunteerStudentRound(trimmedUsn);
      navigate("/volunteer/evaluations", { state: { lookupResult: response } });
    } catch (error) {
      const message = error?.message || "The participant lookup failed. Please try again.";
      const codeMessages = {
        MISSING_USN: `USN is required: ${message}`,
        INVALID_USN_FORMAT: `The USN format is invalid: ${message}`,
        STUDENT_NOT_FOUND: `No registered participant was found for that USN: ${message}`,
        REGISTRATION_INCOMPLETE: `The participant registration is incomplete: ${message}`,
        INVALID_STUDENT_LEVEL: `The participant's current level is invalid: ${message}`,
        ROUND_NOT_ALLOCATED: `No round is currently allocated for this participant: ${message}`,
      };

      if (error?.kind === "network") {
        setLookupError(`Network error. Check your connection and retry. ${message}`);
      } else if (codeMessages[error?.code]) {
        setLookupError(codeMessages[error.code]);
      } else if (error?.status >= 500 || error?.code === "INTERNAL_SERVER_ERROR") {
        setLookupError(`Server error. Please retry the lookup. ${message}`);
      } else if (error?.kind === "http" || error?.kind === "api") {
        setLookupError(message);
      } else {
        setLookupError(`The lookup could not be completed. Please retry. ${message}`);
      }
    } finally {
      lookupInProgress.current = false;
      setLookupPending(false);
    }
  }

  async function handleStart(entry) {
    if (rowBusy) return;
    setRowBusy({ usn: entry.usn, action: "start" });
    setRowError("");
    try {
      await startVolunteerStudentRound(entry.usn);
      await refreshDashboard();
    } catch (error) {
      setRowError(`Could not start the round for ${entry.usn}: ${error?.message || "please try again."}`);
    } finally {
      setRowBusy(null);
    }
  }

  // Row verdict: the same evaluate -> settle -> progress chain the Evaluation
  // Workspace performs, in one tap. Progress finalizes the outcome: on PASS
  // it moves the student to the next level; on FAIL it records the
  // elimination (no level advance). Stops at the first failing step and
  // names it, so the organizer knows where to resume in the Workspace.
  async function handleVerdict(entry, result) {
    if (rowBusy) return;
    const label = result === "PASS" ? "Correct" : "Not correct";
    setRowBusy({ usn: entry.usn, action: label });
    setRowError("");
    const steps = [
      ["evaluation", () => evaluateVolunteerStudentRound(entry.usn, { result })],
      ["settlement", () => settleVolunteerStudentRound(entry.usn)],
      ["progression", () => progressVolunteerStudentRound(entry.usn)],
    ];
    try {
      for (const [stepName, runStep] of steps) {
        try {
          await runStep();
        } catch (stepError) {
          throw new Error(`${stepName} failed: ${stepError?.message || "please try again."}`);
        }
      }
      await refreshDashboard();
    } catch (error) {
      setRowError(`${label} for ${entry.usn} stopped: ${error.message}`);
    } finally {
      setRowBusy(null);
    }
  }

  // Finish an evaluated round from the row: the verdict was already given
  // (in the Workspace, or by a verdict chain whose progression step failed),
  // so only the progression step is left. On PASS it moves the student to
  // the next level; on FAIL it records the elimination.
  async function handleFinishLevel(entry) {
    if (rowBusy) return;
    setRowBusy({ usn: entry.usn, action: "Finish level" });
    setRowError("");
    try {
      await progressVolunteerStudentRound(entry.usn);
      await refreshDashboard();
    } catch (error) {
      setRowError(`Could not finish the level for ${entry.usn}: ${error?.message || "please try again."}`);
    } finally {
      setRowBusy(null);
    }
  }

  async function handleOpen(entry) {
    if (rowBusy) return;
    setRowBusy({ usn: entry.usn, action: "open" });
    setRowError("");
    try {
      const response = await getVolunteerStudentRound(entry.usn);
      navigate("/volunteer/evaluations", { state: { lookupResult: response } });
    } catch (error) {
      setRowError(`Could not open ${entry.usn}: ${error?.message || "please try again."}`);
    } finally {
      setRowBusy(null);
    }
  }

  const stats = dashboard?.stats || null;
  const participants = dashboard?.participants || [];
  const pagination = dashboard?.pagination || null;
  const spotLabel = dashboard?.location || organizerSpot || "your spot";

  return (
    <div className="vol-dashboard">
      <header className="vol-dashboard-header">
        <div>
          <p className="vol-eyebrow">ORGANIZER PANEL</p>
          <h1>Welcome back, {volunteerName}!</h1>
          <p className="vol-subtitle">
            Here&apos;s an overview of your assigned participants and evaluations.
          </p>
        </div>

        <div className="vol-profile-chip">
          <CircleUserRound size={20} />
          <span>{volunteerName}</span>
        </div>
      </header>

      <p className="vol-subtitle" role="status">
        Look up a registered participant by USN to view their current round.
      </p>

      <div className="vol-stats-grid">
        <div className="vol-stat-card">
          <div className="vol-stat-icon"><Users size={21} /></div>
          <p>Assigned Participants</p>
          <h2>{stats ? stats.assignedParticipants : "-"}</h2>
          <span>Registered at {spotLabel}</span>
        </div>

        <div className="vol-stat-card">
          <div className="vol-stat-icon"><Clock size={21} /></div>
          <p>Pending Evaluations</p>
          <h2>{stats ? stats.pendingEvaluations : "-"}</h2>
          <span>Rounds awaiting a verdict at {spotLabel}</span>
        </div>

        <div className="vol-stat-card">
          <div className="vol-stat-icon"><CheckCircle2 size={21} /></div>
          <p>Completed Evaluations</p>
          <h2>{stats ? stats.completedEvaluations : "-"}</h2>
          <span>Verdicts recorded at {spotLabel}</span>
        </div>

        <div className="vol-stat-card">
          <div className="vol-stat-icon">
            <ClipboardList size={21} />
          </div>

          <p>Evaluation Progress</p>

          <h2>{stats ? `${stats.evaluationProgress}%` : "-"}</h2>
          <span>Share of evaluations complete at {spotLabel}</span>
        </div>
      </div>

      <section className="vol-participants-section">
        <div className="vol-section-heading">
          <div>
            <p className="vol-eyebrow">YOUR WORKSPACE</p>
            <h2>Participants</h2>
            <p>Students registered at {spotLabel}. Enter a USN below to find a participant from any spot.</p>
          </div>

          <span className="vol-count">
            {pagination ? `${pagination.totalItems} participants` : "USN lookup"}
          </span>
        </div>

        <form className="vol-toolbar" onSubmit={handleLookup}>
          <div className="vol-search">
            <Search size={17} />
            <input
              type="text"
              placeholder="Enter participant USN..."
              value={usn}
              onChange={(event) => {
                setUsn(event.target.value);
                if (lookupError) setLookupError("");
              }}
              disabled={lookupPending}
              aria-label="Participant USN"
              aria-invalid={Boolean(lookupError)}
              aria-describedby={lookupError ? "volunteer-lookup-error" : undefined}
            />
          </div>

          <button type="submit" className="vol-filter" disabled={lookupPending}>
            {lookupPending
              ? "Looking up…"
              : lookupError
                ? "Retry lookup"
                : "Look up participant"}
          </button>

          <button
            type="button"
            className="vol-filter"
            disabled={dashboardLoading}
            onClick={() => loadDashboard(page)}
          >
            Refresh
          </button>
        </form>

        {lookupError && (
          <p id="volunteer-lookup-error" role="alert">
            {lookupError}
          </p>
        )}

        {rowError && (
          <p className="vol-row-error" role="alert">
            {rowError}
          </p>
        )}

        <div className="vol-table-wrapper">
          <table className="vol-table">
            <thead>
              <tr>
                <th>PARTICIPANT</th>
                <th>USN</th>
                <th>CURRENT LEVEL</th>
                <th>STATUS</th>
                <th>BALANCE</th>
                <th>ACTION</th>
              </tr>
            </thead>

            <tbody>
              {dashboardLoading && !dashboard ? (
                <tr>
                  <td colSpan="6" className="vol-empty-state" role="status">
                    Loading participants...
                  </td>
                </tr>
              ) : dashboardError ? (
                <tr>
                  <td colSpan="6" className="vol-empty-state" role="alert">
                    {dashboardError}{" "}
                    <button
                      type="button"
                      className="vol-action-button"
                      onClick={() => loadDashboard(page)}
                    >
                      Retry
                    </button>
                  </td>
                </tr>
              ) : participants.length === 0 ? (
                <tr>
                  <td colSpan="6" className="vol-empty-state" role="status">
                    No participants have registered at {spotLabel} yet.
                  </td>
                </tr>
              ) : (
                participants.map((entry) => {
                  const status = rosterStatus(entry);
                  const isTerminal = ["stopped", "eliminated", "completed"].includes(
                    entry.competitionStatus
                  );
                  const canStart = entry.roundStatus === "ready";
                  const canEvaluate = ["inProgress", "timeExpired"].includes(entry.roundStatus);
                  const canFinish = entry.roundStatus === "evaluated" && !isTerminal;
                  const hasRound = entry.roundStatus !== "none";
                  const busyThisRow = rowBusy?.usn === entry.usn;
                  return (
                    <tr key={entry.id}>
                      <td className="vol-participant-name">{entry.name}</td>
                      <td>{entry.usn}</td>
                      <td>Level {entry.currentLevel}</td>
                      <td>
                        <span className={`vol-status-tag vol-${status.tone}`}>{status.label}</span>
                      </td>
                      <td className="vol-balance">{formatCurrency(entry.walletBalance)}</td>
                      <td>
                        <span className="vol-row-actions">
                          {canStart && (
                            <button
                              type="button"
                              className="vol-action-button"
                              disabled={Boolean(rowBusy)}
                              onClick={() => handleStart(entry)}
                            >
                              {busyThisRow && rowBusy.action === "start" ? "Starting..." : "Start"}
                            </button>
                          )}
                          {canEvaluate && (
                            <>
                              <button
                                type="button"
                                className="vol-action-button vol-action-correct"
                                disabled={Boolean(rowBusy)}
                                onClick={() => handleVerdict(entry, "PASS")}
                              >
                                {busyThisRow && rowBusy.action === "Correct" ? "Saving..." : "Correct"}
                              </button>
                              <button
                                type="button"
                                className="vol-action-button vol-action-wrong"
                                disabled={Boolean(rowBusy)}
                                onClick={() => handleVerdict(entry, "FAIL")}
                              >
                                {busyThisRow && rowBusy.action === "Not correct" ? "Saving..." : "Not correct"}
                              </button>
                            </>
                          )}
                          {canFinish && (
                            <button
                              type="button"
                              className="vol-action-button"
                              disabled={Boolean(rowBusy)}
                              onClick={() => handleFinishLevel(entry)}
                            >
                              {busyThisRow && rowBusy.action === "Finish level" ? "Finishing..." : "Finish level"}
                            </button>
                          )}
                          {hasRound && !isTerminal && (
                            <button
                              type="button"
                              className="vol-action-button"
                              disabled={Boolean(rowBusy)}
                              onClick={() => handleOpen(entry)}
                            >
                              {busyThisRow && rowBusy.action === "open" ? "Opening..." : "Open"}
                            </button>
                          )}
                          {!canStart && !canEvaluate && (!hasRound || isTerminal) && (
                            <span className="vol-no-action">-</span>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {pagination && pagination.totalPages > 1 && (
          <div className="vol-pagination">
            <button
              type="button"
              className="vol-filter"
              disabled={!pagination.hasPrevPage || dashboardLoading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </button>
            <span>
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              type="button"
              className="vol-filter"
              disabled={!pagination.hasNextPage || dashboardLoading}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
