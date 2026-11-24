import { useRef, useState } from "react";
import { Search } from "lucide-react";
import { Pagination } from "../../components/ui";
import { useAdminList } from "../../hooks/useAdminList";
import { evaluationStatusLabel, formatDate, roundStatusLabel } from "../../utils/formatters";
import { getAdminRounds, recoverAdminRound } from "../../services/adminDataService";
import "./participants.css";

const PAGE_LIMIT = 20;
const roundStatuses = ["ready", "inProgress", "timeExpired", "submitted", "evaluated", "abandoned"];
const evaluationStatuses = ["PENDING", "PASS", "FAIL"];
const emptyFilters = {
  levelNumber: "",
  status: "",
  evaluationStatus: "",
  usn: "",
  search: "",
};

function formatSeconds(value) {
  if (!Number.isFinite(value) || value < 0) return "—";
  const seconds = Math.floor(value);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function displayState(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "—";
}

export default function RoundsManagement() {
  const {
    items: rounds,
    setItems: setRounds,
    pagination,
    loading,
    error,
    draftFilters,
    filters,
    handleFilterChange,
    applyFilters,
    clearFilters,
    changePage,
    changeLimit,
    retry,
    refresh,
  } = useAdminList({ fetcher: getAdminRounds, emptyFilters, resultKey: "rounds", pageLimit: PAGE_LIMIT });
  const [recoveringRoundId, setRecoveringRoundId] = useState(null);
  const [recoverySuccess, setRecoverySuccess] = useState("");
  const [recoveryError, setRecoveryError] = useState(null);
  const recoveryInFlight = useRef(false);

  const recoverRound = async (round) => {
    if (recoveryInFlight.current || round?.status !== "abandoned" || !round.id) return;
    const confirmed = window.confirm("Bring this round back? It will be checked first.");
    if (!confirmed) return;

    recoveryInFlight.current = true;
    setRecoveringRoundId(round.id);
    setRecoveryError(null);
    setRecoverySuccess("");
    try {
      const result = await recoverAdminRound(round.id);
      setRounds((current) => current.map((item) => item.id === result.round.id ? result.round : item));
      setRecoverySuccess(result.message || `Round ${result.round.id} is back and ready.`);
      refresh();
    } catch (requestError) {
      setRecoveryError(requestError);
      if (requestError.status === 409 || requestError.status === 404) {
        refresh();
      }
    } finally {
      recoveryInFlight.current = false;
      setRecoveringRoundId(null);
    }
  };

  return (
    <div className="participant-management">
      <div className="participant-page-header">
        <div>
          <span className="admin-eyebrow">MANAGE THE COMPETITION</span>
          <h1>Rounds.</h1>
          <p>See student rounds, questions, and results.</p>
        </div>
      </div>

      <form onSubmit={applyFilters}>
        <div className="participant-toolbar">
          <div className="participant-search">
            <Search size={18} />
            <input name="search" type="search" placeholder="Search student name, USN or question..." value={draftFilters.search} onChange={handleFilterChange} maxLength={100} />
          </div>
          <div className="participant-search">
            <input name="usn" type="search" aria-label="Filter by USN" placeholder="Filter by USN..." value={draftFilters.usn} onChange={handleFilterChange} minLength={8} maxLength={15} pattern="[A-Za-z0-9]{8,15}" title="Type a USN, 8 to 15 letters or numbers" />
          </div>
        </div>
        <div className="participant-toolbar">
          <select name="levelNumber" aria-label="Filter by level" value={draftFilters.levelNumber} onChange={handleFilterChange}>
            <option value="">All Levels</option>
            {[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={level}>Level {level}</option>)}
          </select>
          <select name="status" aria-label="Filter by round state" value={draftFilters.status} onChange={handleFilterChange}>
            <option value="">All round states</option>
            {roundStatuses.map((status) => <option key={status} value={status}>{roundStatusLabel(status)}</option>)}
          </select>
          <select name="evaluationStatus" aria-label="Filter by result" value={draftFilters.evaluationStatus} onChange={handleFilterChange}>
            <option value="">All results</option>
            {evaluationStatuses.map((status) => <option key={status} value={status}>{evaluationStatusLabel(status)}</option>)}
          </select>
          <button className="participant-view-btn" type="submit" disabled={loading}>Apply filters</button>
          <button className="participant-view-btn" type="button" onClick={clearFilters} disabled={loading}>Clear filters</button>
        </div>
      </form>

      {error && (
        <p role="alert">
          {error.message || "Could not load rounds."}
          {error.code ? ` (${error.code})` : ""} {error.status ? `HTTP ${error.status}.` : ""}{" "}
          <button className="participant-view-btn" type="button" onClick={retry} disabled={loading}>Retry</button>
        </p>
      )}
      {loading && <p role="status">Loading rounds…</p>}
      {recoverySuccess && <p role="status">{recoverySuccess}</p>}
      {recoveryError && (
        <p role="alert">
          {recoveryError.message || "Could not bring this round back."}
          {recoveryError.code ? ` (${recoveryError.code})` : ""} {recoveryError.status ? `HTTP ${recoveryError.status}.` : ""}{" "}
          <button
            className="participant-view-btn"
            type="button"
            onClick={() => {
              setRecoveryError(null);
              refresh();
            }}
            disabled={loading}
          >
            Refresh rounds
          </button>
        </p>
      )}

      <div className="participant-table-container">
        <div className="participant-table-heading">
          <h2>Rounds</h2>
          <span>{pagination ? `${pagination.totalItems} total rounds` : ""}</span>
        </div>
        <div className="participant-table-scroll">
          <table className="participant-table">
            <thead>
              <tr><th>ROUND</th><th>STUDENT</th><th>QUESTION</th><th>TIMER</th><th>RESULT</th><th>ACTION</th></tr>
            </thead>
            <tbody>
              {rounds.map((round) => (
                <tr key={round.id}>
                  <td>
                    <strong>Level {round.levelNumber ?? "—"}</strong>
                    <span className="participant-status">{roundStatusLabel(round.status)}</span>
                  </td>
                  <td>
                    <strong>{round.participant?.name || "—"}</strong>
                    <small>{round.participant?.usn || "—"}</small>
                  </td>
                  <td>
                    <strong>{round.question?.title || "—"}</strong>
                    <small>{round.question?.difficulty || "—"}</small>
                  </td>
                  <td>
                    <strong>{formatSeconds(round.durationSeconds)}</strong>
                    <small>Remaining: {formatSeconds(round.remainingSeconds)}</small>
                    <small>Ends at: {formatDate(round.deadline)}</small>
                    <small>Time up: {displayState(round.isExpired)}</small>
                  </td>
                  <td>
                    <strong>{evaluationStatusLabel(round.evaluation?.status)}</strong>
                    <small>Language: {round.evaluation?.programmingLanguage || "—"}</small>
                    <small>Money done: {displayState(round.evaluation?.isSettled)}</small>
                    <small>Moved on: {displayState(round.evaluation?.isProgressed)}</small>
                  </td>
                  <td>
                    {round.status === "abandoned" && (
                      <button
                        className="participant-view-btn"
                        type="button"
                        onClick={() => recoverRound(round)}
                        disabled={loading || recoveringRoundId !== null}
                      >
                        {recoveringRoundId === round.id ? "Bringing back…" : "Bring back"}
                      </button>
                    )}
                    {round.status !== "abandoned" && "—"}
                  </td>
                </tr>
              ))}
              {!loading && !error && rounds.length === 0 && (
                <tr><td colSpan="6" className="participant-empty">No rounds match these filters.</td></tr>
              )}
              {!loading && error && <tr><td colSpan="6" className="participant-empty">Rounds are not shown.</td></tr>}
              {loading && <tr><td colSpan="6" className="participant-empty">Loading rounds…</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination pagination={pagination} limit={filters.limit} loading={loading} onPageChange={changePage} onLimitChange={changeLimit} perPageLabel="Rounds per page" />
      </div>
    </div>
  );
}
