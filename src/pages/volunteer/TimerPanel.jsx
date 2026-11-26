import { useEffect, useMemo, useState } from "react";
import {
  Pause,
  Play,
  RotateCcw,
  Timer,
  AlertCircle,
  CheckCircle2,
  Plus,
} from "lucide-react";
import "./timer.css";
import { formatClock, formatDate } from "../../utils/formatters";

export default function TimerPanel({
  levelNumber,
  roundStatus,
  remainingSeconds,
  deadline,
  isExpired,
  isPaused = false,
  canStart = false,
  canExtend = false,
  canReset = false,
  canPause = false,
  canResume = false,
  isStarting = false,
  isExtending = false,
  isResetting = false,
  isPausing = false,
  isResuming = false,
  isBusy = false,
  onStart,
  onExtend,
  onReset,
  onPause,
  onResume,
}) {
  const [now, setNow] = useState(() => Date.now());
  const [extensionMinutes, setExtensionMinutes] = useState("");
  const [extensionReason, setExtensionReason] = useState("");
  const [extensionError, setExtensionError] = useState("");

  useEffect(() => {
    if (
      roundStatus !== "inProgress" ||
      isExpired === true ||
      isPaused === true ||
      !deadline
    )
      return undefined;

    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [deadline, isExpired, isPaused, roundStatus]);

  const deadlineMilliseconds = deadline ? new Date(deadline).getTime() : NaN;
  const hasDeadline = Number.isFinite(deadlineMilliseconds);
  const hasRemainingTime =
    typeof remainingSeconds === "number" && Number.isFinite(remainingSeconds);
  const isFinished = isExpired === true;
  const countdownSeconds = useMemo(() => {
    if (isFinished) return 0;
    if (isPaused) return hasRemainingTime ? Math.max(0, remainingSeconds) : null;
    if (roundStatus === "inProgress" && hasDeadline) {
      return Math.max(0, Math.ceil((deadlineMilliseconds - now) / 1000));
    }
    return hasRemainingTime ? Math.max(0, remainingSeconds) : null;
  }, [
    deadlineMilliseconds,
    hasDeadline,
    hasRemainingTime,
    isFinished,
    isPaused,
    now,
    remainingSeconds,
    roundStatus,
  ]);
  const canDisplayCountdown = countdownSeconds !== null;
  const isAwaitingBackendExpiration =
    roundStatus === "inProgress" && countdownSeconds === 0 && !isFinished;
  const isWarning =
    canDisplayCountdown && !isFinished && countdownSeconds <= 30 && countdownSeconds > 0;
  const extensionValue = Number(extensionMinutes);
  const isValidExtension =
    extensionMinutes.trim() !== "" &&
    Number.isSafeInteger(extensionValue) &&
    extensionValue > 0;

  async function handleExtensionSubmit(event) {
    event.preventDefault();
    setExtensionError("");
    if (!canExtend || isBusy || !isValidExtension) {
      setExtensionError("Enter whole minutes, more than 0.");
      return;
    }

    const response = await onExtend?.(
      extensionValue * 60,
      extensionReason.trim() || undefined,
    );
    if (response) {
      setExtensionMinutes("");
      setExtensionReason("");
    }
  }

  return (
    <section
      className="timer-panel"
      aria-busy={isStarting || isExtending || isPausing || isResuming}
    >
      <div className="timer-header">
        <div>
          <p className="timer-eyebrow">COMPETITION TIMER</p>
          <h2>{levelNumber ? `Level ${levelNumber} Timer` : "Round Timer"}</h2>
        </div>

        <div className="timer-icon">
          <Timer size={22} />
        </div>
      </div>

      <div
        className={`timer-display ${
          isWarning ? "timer-warning" : ""
        } ${isFinished ? "timer-finished" : ""}`}
      >
        <span className="timer-time">
          {canDisplayCountdown ? formatClock(countdownSeconds) : "--:--"}
        </span>

        <span className="timer-status">
          {isFinished
            ? "TIME IS UP"
            : isPaused
              ? "PAUSED"
              : isAwaitingBackendExpiration
                ? "AWAITING TIMER UPDATE"
                : canDisplayCountdown
                  ? "TIME REMAINING"
                  : roundStatus === "ready"
                    ? "READY TO START"
                    : "NO TIMER"}
        </span>
      </div>

      {isPaused && !isFinished && (
        <div className="timer-message">
          <Pause size={16} />
          Timer paused. The time left stays as it is until you resume it.
        </div>
      )}

      {isWarning && (
        <div className="timer-message timer-message-warning">
          <AlertCircle size={16} />
          Less than 30 seconds remaining!
        </div>
      )}

      {isFinished && (
        <div className="timer-message timer-message-finished">
          <CheckCircle2 size={16} />
          Time is up!
        </div>
      )}

      {isAwaitingBackendExpiration && (
        <div className="timer-message">
          <AlertCircle size={16} />
          The countdown reached zero; waiting for the timer to update.
        </div>
      )}

      <div className="timer-controls">
        <button
          type="button"
          className="timer-primary-button"
          disabled={!canStart || isBusy}
          onClick={onStart}
        >
          <Play size={17} />
          {isStarting ? "Starting…" : "Start"}
        </button>

        <button
          type="button"
          className="timer-reset-button"
          disabled={!canReset || isBusy}
          onClick={onReset}
          title="Restart the timer to the full level time"
        >
          <RotateCcw size={16} />
          {isResetting ? "Resetting…" : "Reset"}
        </button>

        <button
          type="button"
          className="timer-pause-button"
          disabled={(!canPause && !canResume) || isBusy}
          onClick={isPaused ? onResume : onPause}
          title={isPaused ? "Resume the timer" : "Pause the timer"}
        >
          {isPaused ? <Play size={16} /> : <Pause size={16} />}
          {isResuming
            ? "Resuming…"
            : isPausing
              ? "Pausing…"
              : isPaused
                ? "Resume"
                : "Pause"}
        </button>
      </div>

      {canExtend && (
        <form
          className="vol-toolbar timer-extension-form"
          onSubmit={handleExtensionSubmit}
        >
          <div className="vol-search">
            <input
              id="timer-extension-minutes"
              name="extensionMinutes"
              type="number"
              min="1"
              step="1"
              placeholder="Extra minutes"
              aria-label="Extra time in minutes"
              value={extensionMinutes}
              onChange={(event) => {
                setExtensionMinutes(event.target.value);
                setExtensionError("");
              }}
              disabled={isBusy}
              required
            />
          </div>
          <div className="vol-search">
            <input
              id="timer-extension-reason"
              name="reason"
              type="text"
              placeholder="Reason (optional)"
              aria-label="Timer extension reason (optional)"
              value={extensionReason}
              onChange={(event) => setExtensionReason(event.target.value)}
              disabled={isBusy}
            />
          </div>
          {extensionError && (
            <p className="form-error" role="alert">
              {extensionError}
            </p>
          )}
          <button
            type="submit"
            className="vol-filter"
            disabled={!isValidExtension || isBusy}
          >
            <Plus size={16} />
            {isExtending ? "Extending…" : "Extend time"}
          </button>
        </form>
      )}

      <div className="timer-duration-note">
        <span>{levelNumber ? `Level ${levelNumber}` : "Round"}</span>
        <span>Ends at: {formatDate(deadline, "Not set")}</span>
      </div>
    </section>
  );
}
