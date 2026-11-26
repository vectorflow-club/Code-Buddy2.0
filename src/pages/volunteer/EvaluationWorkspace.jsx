import {
  Users,
  CheckCircle2,
  XCircle,
  ClipboardCheck,
  Clock3,
  Code2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  evaluateVolunteerStudentRound,
  extendVolunteerStudentRound,
  getVolunteerStudentRound,
  pauseVolunteerStudentRound,
  progressVolunteerStudentRound,
  resetVolunteerStudentRound,
  resumeVolunteerStudentRound,
  settleVolunteerStudentRound,
  startVolunteerStudentRound,
} from "../../services/volunteerRoundService";
import { getVolunteerSession } from "../../services/volunteerAuthService";
import {
  competitionStatusLabel,
  evaluationStatusLabel,
  questionCode,
  roundAvailabilityLabel,
  roundStatusLabel,
} from "../../utils/formatters";
import TimerPanel from "./TimerPanel";
import "./evaluation.css";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidLookupResult(value) {
  const student = value?.student;
  const round = value?.round;
  const question = round?.question;

  return (
    value?.success === true &&
    isRecord(student) &&
    typeof student.usn === "string" &&
    isRecord(round) &&
    typeof round.levelNumber === "number" &&
    isRecord(question) &&
    typeof question.title === "string" &&
    typeof question.statement === "string" &&
    Array.isArray(question.constraints) &&
    Array.isArray(question.examples)
  );
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "Not given";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function getErrorMessage(error) {
  if (error?.kind === "network") {
    return `No connection. Check your internet and try again. ${error.message || ""}`.trim();
  }
  if (typeof error?.status === "number" && error.status >= 500) {
    return `That did not work. ${error.message || "Please try again."}`;
  }
  return error?.message || "That round action did not work. Please try again.";
}

export default function EvaluationWorkspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const lookupResult = location.state?.lookupResult;
  const [workspaceResult, setWorkspaceResult] = useState(() =>
    isValidLookupResult(lookupResult) ? lookupResult : null,
  );
  const [activeAction, setActiveAction] = useState("");
  const activeActionRef = useRef("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [remarks, setRemarks] = useState("");
  const [programmingLanguage, setProgrammingLanguage] = useState("");

  useEffect(() => {
    setWorkspaceResult(isValidLookupResult(lookupResult) ? lookupResult : null);
    setActionError("");
    setActionMessage("");
  }, [location.key, lookupResult]);

  const hasLookupResult = isValidLookupResult(workspaceResult);
  const student = hasLookupResult ? workspaceResult.student : null;
  const round = hasLookupResult ? workspaceResult.round : null;
  const question = hasLookupResult ? round.question : null;
  const evaluation = isRecord(workspaceResult?.evaluation)
    ? workspaceResult.evaluation
    : null;
  const progression = isRecord(workspaceResult?.progression)
    ? workspaceResult.progression
    : null;
  const settlement = isRecord(workspaceResult?.settlement)
    ? workspaceResult.settlement
    : null;
  const hasEvaluation =
    isRecord(evaluation) && ["PASS", "FAIL"].includes(evaluation.status);
  const isSettled = evaluation?.isSettled === true;
  const isProgressed = evaluation?.isProgressed === true || Boolean(progression);
  const isBusy = Boolean(activeAction);
  const roundStatus = round?.status;
  const canStart = hasLookupResult && roundStatus === "ready";
  const canExtend =
    hasLookupResult &&
    roundStatus === "inProgress" &&
    round.isExpired !== true &&
    round.isPaused !== true;
  const canReset =
    hasLookupResult &&
    roundStatus === "inProgress" &&
    round.isExpired !== true &&
    round.isPaused !== true;
  const canPause =
    hasLookupResult &&
    roundStatus === "inProgress" &&
    round.isExpired !== true &&
    round.isPaused !== true;
  const canResume =
    hasLookupResult && roundStatus === "inProgress" && round.isPaused === true;
  const canEvaluate =
    hasLookupResult &&
    ["inProgress", "timeExpired"].includes(roundStatus) &&
    !hasEvaluation;
  const canSettle = hasLookupResult && hasEvaluation && !isSettled;
  const canProgress = hasLookupResult && hasEvaluation && !isProgressed;
  const studentName = typeof student?.name === "string" ? student.name.trim() : "";
  const participantDisplayName = studentName || student?.usn || "";
  // The USN lookup is open across spots (a wrong-location student must stay
  // reachable), so a cross-spot open is flagged visibly instead of blocked.
  const organizerSpot = getVolunteerSession()?.volunteer?.assignedLab || "";
  const isDifferentSpot =
    hasLookupResult &&
    Boolean(student?.location) &&
    Boolean(organizerSpot) &&
    student.location !== organizerSpot;

  async function runAction(actionName, operation) {
    if (activeActionRef.current || !student?.usn) return null;

    activeActionRef.current = actionName;
    setActiveAction(actionName);
    setActionError("");
    setActionMessage("");

    try {
      const response = await operation(student.usn);
      if (!isValidLookupResult(response)) {
        const invalidResponse = new Error(
          "The round details came back incomplete. Please try again.",
        );
        invalidResponse.kind = "invalid_response";
        throw invalidResponse;
      }
      setWorkspaceResult(response);
      setActionMessage(
        typeof response.message === "string" && response.message.trim()
          ? response.message
          : "The round was updated.",
      );
      return response;
    } catch (error) {
      let message = getErrorMessage(error);

      if (error?.status === 409 || error?.kind === "invalid_response") {
        try {
          const refreshed = await getVolunteerStudentRound(student.usn);
          if (isValidLookupResult(refreshed)) {
            setWorkspaceResult(refreshed);
          } else {
            message += " The student details could not be refreshed.";
          }
        } catch (refreshError) {
          message += ` Could not refresh the student details: ${getErrorMessage(refreshError)}`;
        }
      }

      setActionError(message);
      return null;
    } finally {
      activeActionRef.current = "";
      setActiveAction("");
    }
  }

  function handleStart() {
    if (!canStart) return null;
    return runAction("start", (usn) => startVolunteerStudentRound(usn));
  }

  function handleExtend(extensionSeconds, reason) {
    if (!canExtend) return null;
    return runAction("extend", (usn) =>
      extendVolunteerStudentRound(usn, {
        extensionSeconds,
        ...(reason ? { reason } : {}),
      }),
    );
  }

  function handleReset() {
    if (!canReset) return null;
    return runAction("reset", (usn) => resetVolunteerStudentRound(usn));
  }

  function handlePause() {
    if (!canPause) return null;
    return runAction("pause", (usn) => pauseVolunteerStudentRound(usn));
  }

  function handleResume() {
    if (!canResume) return null;
    return runAction("resume", (usn) => resumeVolunteerStudentRound(usn));
  }

  function handleEvaluate(result) {
    if (!canEvaluate) return null;
    const optionalRemarks = remarks.trim();
    const optionalLanguage = programmingLanguage.trim();
    return runAction("evaluate", (usn) =>
      evaluateVolunteerStudentRound(usn, {
        result,
        ...(optionalRemarks ? { remarks: optionalRemarks } : {}),
        ...(optionalLanguage ? { programmingLanguage: optionalLanguage } : {}),
      }),
    );
  }

  function handleSettle() {
    if (!canSettle) return null;
    return runAction("settle", (usn) => settleVolunteerStudentRound(usn));
  }

  function handleProgress() {
    if (!canProgress) return null;
    return runAction("progress", (usn) => progressVolunteerStudentRound(usn));
  }

  return (
    <div className="evaluation-page">
      <div className="evaluation-header">
        <div>
          <span className="evaluation-eyebrow">ORGANIZER / RESULTS</span>
          <h1>Results Workspace</h1>
          <p>Run student rounds and give results.</p>
        </div>
      </div>

      <div className="evaluation-demo-note" role="status">
        {hasLookupResult
          ? "Student and round details came from the Dashboard USN search."
          : lookupResult
            ? "The student search came back incomplete. Go back to the Dashboard and search the USN again."
            : "Find a student by USN on the Organizer Dashboard to see their round."}
      </div>

      {actionError && (
        <div className="evaluation-demo-note" role="alert">
          {actionError}
        </div>
      )}
      {actionMessage && (
        <div className="evaluation-demo-note" role="status">
          {actionMessage}
        </div>
      )}

      <div className="evaluation-stats">
        <div className="evaluation-stat-card">
          <Users size={20} />
          <div>
            <span>Students here</span>
            <strong>N/A</strong>
          </div>
        </div>

        <div className="evaluation-stat-card">
          <Clock3 size={20} />
          <div>
            <span>Results to give</span>
            <strong>N/A</strong>
          </div>
        </div>

        <div className="evaluation-stat-card">
          <ClipboardCheck size={20} />
          <div>
            <span>Results given</span>
            <strong>N/A</strong>
          </div>
        </div>
      </div>

      <div className="evaluation-layout">
        <section className="evaluation-panel participant-selector">
          <div className="evaluation-panel-heading">
            <div>
              <h2>Selected student</h2>
              <p>Student details from the Dashboard search.</p>
            </div>
          </div>

          {hasLookupResult ? (
            <div className="evaluation-participant-list">
              <div className="evaluation-participant selected">
                <div className="evaluation-avatar">
                  {participantDisplayName.slice(0, 1).toUpperCase()}
                </div>
                <div className="evaluation-participant-info">
                  <strong>{participantDisplayName}</strong>
                  <span>{student.usn}</span>
                </div>
                <span className="evaluation-status pending">
                  {progression ? "Moved to next level" : `Level ${round.levelNumber}`}
                </span>
              </div>
            </div>
          ) : (
            <div className="evaluation-empty" role="status">
              <div className="evaluation-empty-icon">
                <Users size={27} />
              </div>
              <h2>Find a student first</h2>
              <p>
                {lookupResult
                  ? "The student or round details could not be checked."
                  : "No student came from the Dashboard."}
              </p>
              <button
                type="button"
                className="evaluation-primary-btn"
                onClick={() => navigate("/volunteer/dashboard")}
              >
                Back to Organizer Dashboard
              </button>
            </div>
          )}
        </section>

        <section className="evaluation-panel evaluation-main">
          {!hasLookupResult && (
            <div className="evaluation-empty" role="status">
              <div className="evaluation-empty-icon">
                <Users size={27} />
              </div>
              <h2>No student picked</h2>
              <p>Go to the Organizer Dashboard and find a student by USN.</p>
              <button
                type="button"
                className="evaluation-primary-btn"
                onClick={() => navigate("/volunteer/dashboard")}
              >
                Back to Organizer Dashboard
              </button>
            </div>
          )}

          <div className="evaluation-selected-header">
            <div>
              <span className="evaluation-eyebrow">STUDENT AND ROUND</span>
              <h2>{hasLookupResult ? participantDisplayName : "No details yet"}</h2>
              <p>
                {hasLookupResult
                  ? `${student.usn} · Round status: ${roundStatusLabel(round.status)} · Student level: ${displayValue(student.currentLevel)} - Spot: ${displayValue(student.location)}`
                  : "Round details will appear after a valid Dashboard lookup."}
              </p>
              {isDifferentSpot && (
                <p className="evaluation-spot-note" role="status">
                  This student signed up at {student.location}, not your spot ({organizerSpot}).
                  You can still run their round from here.
                </p>
              )}
            </div>
          </div>

          {hasLookupResult && (
            <div className="evaluation-question">
              <div className="evaluation-question-heading">
                <div>
                  <span className="evaluation-eyebrow">
                    {progression ? "RESULT GIVEN" : "ROUND DETAILS"}
                  </span>
                  <h2>Level {round.levelNumber}</h2>
                </div>
              </div>
              <p>
                Year: {displayValue(student.year)} · Status: {competitionStatusLabel(student.competitionStatus)} · {roundAvailabilityLabel(student.roundAvailability)}
              </p>
              {progression && (
                <p role="status">
                  {workspaceResult.message} Level {displayValue(progression.evaluatedLevel)} finished; result {evaluationStatusLabel(progression.evaluationResult)}.
                  {progression.advancedToLevel !== null &&
                  progression.advancedToLevel !== undefined
                    ? ` Moved to Level ${progression.advancedToLevel}.`
                    : progression.isCompleted
                      ? " Finished the competition."
                      : progression.isEliminated
                        ? " Student is out."
                        : " No next level was given."}
                </p>
              )}
              {settlement && (
                <div className="evaluation-example">
                  <strong>Money update</strong>
                  <p>Result: {evaluationStatusLabel(settlement.evaluationResult)}</p>
                  <p>
                    Money before: {displayValue(settlement.previousWalletBalance)} · Money now: {displayValue(settlement.targetBalance)} · Change: {displayValue(settlement.deltaAmount)}
                  </p>
                  <p>
                    Safe zone: {settlement.isSafeZone ? "Yes" : "No"}
                    {typeof settlement.didSettleNow === "boolean"
                      ? ` · Money updated while moving on: ${settlement.didSettleNow ? "Yes" : "No"}`
                      : ""}
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="evaluation-question">
            <div className="evaluation-question-heading">
              <div>
                <span className="evaluation-eyebrow">THEIR QUESTION</span>
                <h2>{hasLookupResult ? question.title : "No question details yet"}</h2>
              </div>
            </div>
            <p>
              {hasLookupResult
                ? question.statement
                : "The question will appear after you find a student on the Dashboard."}
            </p>
            {hasLookupResult && (
              <>
                {question.bankNumber ? (
                  <p>
                    Question number: {questionCode(round.levelNumber, question.bankNumber) || question.bankNumber}
                    {question.showBankNumber === false ? " · hidden from student" : ""}
                  </p>
                ) : null}
                <p>Difficulty: {displayValue(question.difficulty)}</p>
                <div className="evaluation-example">
                  <strong>Limits</strong>
                  {question.constraints.length ? (
                    <ul>
                      {question.constraints.map((constraint, index) => (
                        <li key={index}>{displayValue(constraint)}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>No limits given.</p>
                  )}
                </div>
                {question.examples.map((example, index) => (
                  <div className="evaluation-example" key={index}>
                    <strong>Example {index + 1}</strong>
                    <pre>{displayValue(example)}</pre>
                  </div>
                ))}
              </>
            )}
          </div>

          {hasLookupResult && (
            <TimerPanel
              levelNumber={round.levelNumber}
              roundStatus={roundStatus}
              remainingSeconds={round.remainingSeconds}
              deadline={round.deadline}
              isExpired={round.isExpired}
              isPaused={round.isPaused === true}
              canStart={canStart}
              canExtend={canExtend}
              canReset={canReset}
              canPause={canPause}
              canResume={canResume}
              isStarting={activeAction === "start"}
              isExtending={activeAction === "extend"}
              isResetting={activeAction === "reset"}
              isPausing={activeAction === "pause"}
              isResuming={activeAction === "resume"}
              isBusy={isBusy}
              onStart={handleStart}
              onExtend={handleExtend}
              onReset={handleReset}
              onPause={handlePause}
              onResume={handleResume}
            />
          )}

          <div className="evaluation-decision">
            <h3>{hasEvaluation ? "Result" : "Give the result"}</h3>
            {hasEvaluation ? (
              <p>
                Result: <strong>{evaluationStatusLabel(evaluation.status)}</strong>
                {evaluation.volunteerNotes ? ` · ${evaluation.volunteerNotes}` : ""}
                {evaluation.programmingLanguage
                  ? ` · ${evaluation.programmingLanguage}`
                  : ""}
              </p>
            ) : (
              <p>
                {canEvaluate
                  ? "Record the result for this round."
                  : "You can give a result only while the round is running or time is up."}
              </p>
            )}

            <div className="evaluation-example">
              <strong>
                <label htmlFor="evaluation-remarks">Note (optional)</label>
              </strong>
              <div className="vol-search">
                <input
                  id="evaluation-remarks"
                  name="remarks"
                  type="text"
                  maxLength={1000}
                  placeholder="Add a note"
                  aria-label="Note, optional, up to 1000 characters"
                  value={remarks}
                  onChange={(event) => setRemarks(event.target.value)}
                  disabled={!canEvaluate || isBusy}
                />
              </div>
            </div>

            <div className="evaluation-example">
              <strong>
                <label htmlFor="evaluation-language">
                  Programming language (optional)
                </label>
              </strong>
              <div className="vol-search">
                <input
                  id="evaluation-language"
                  name="programmingLanguage"
                  type="text"
                  maxLength={50}
                  placeholder="Programming language"
                  aria-label="Programming language, optional, up to 50 characters"
                  value={programmingLanguage}
                  onChange={(event) => setProgrammingLanguage(event.target.value)}
                  disabled={!canEvaluate || isBusy}
                />
              </div>
            </div>

            {!hasEvaluation && (
              <div className="evaluation-decision-buttons">
                <button
                  type="button"
                  className="evaluation-pass-btn"
                  disabled={!canEvaluate || isBusy}
                  onClick={() => handleEvaluate("PASS")}
                >
                  <CheckCircle2 size={17} />
                  {activeAction === "evaluate" ? "Saving…" : "Correct"}
                </button>

                <button
                  type="button"
                  className="evaluation-fail-btn"
                  disabled={!canEvaluate || isBusy}
                  onClick={() => handleEvaluate("FAIL")}
                >
                  <XCircle size={17} />
                  {activeAction === "evaluate" ? "Saving…" : "Not correct"}
                </button>
              </div>
            )}

            {hasEvaluation && (
              <div className="evaluation-decision-buttons">
                <button
                  type="button"
                  className="evaluation-pass-btn"
                  disabled={!canSettle || isBusy}
                  onClick={handleSettle}
                >
                  <CheckCircle2 size={17} />
                  {activeAction === "settle"
                    ? "Updating money…"
                    : isSettled
                      ? "Money updated"
                      : "Update money"}
                </button>
                <button
                  type="button"
                  className="evaluation-fail-btn"
                  disabled={!canProgress || isBusy}
                  onClick={handleProgress}
                >
                  <Code2 size={17} />
                  {activeAction === "progress"
                    ? "Moving on…"
                    : isProgressed
                      ? "Moved on"
                      : "Finish level"}
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="evaluation-footer-note">
        <Code2 size={17} />
        <span>
          Round, timer, result, money, and level change as you record them.
        </span>
      </div>
    </div>
  );
}
