import { useCallback, useState } from "react";
import {
  Settings2,
  Users,
  Trophy,
  Clock3,
  BookOpen,
  Pencil,
  X,
  Save,
  CheckCircle2,
  AlertCircle,
  Layers3,
} from "lucide-react";
import "./levels.css";
import { useFetchState } from "../../hooks/useFetchState";
import { formatCurrency, levelStatusLabel } from "../../utils/formatters";
import { getAdminDashboardStats } from "../../services/adminDataService";
import { getAdminQuestionList } from "../../services/adminQuestionService";
import { getAdminLevels, setAdminLevelActive, updateAdminLevel } from "../../services/adminLevelService";

export default function LevelManagement() {
  const fetchLevels = useCallback(async () => {
    const [configuredLevels, dashboard, questions] = await Promise.all([
      getAdminLevels(),
      getAdminDashboardStats(),
      getAdminQuestionList(),
    ]);
    return configuredLevels.map((level) => {
      const progress = dashboard.levels?.[`L${level.number}`] || {};
      const levelQuestions = questions.filter((question) => question.levelNumber === level.number && question.isActive);
      return {
        id: level.number,
        name: level.name,
        entryFee: level.entryRiskAmount ?? "",
        passReward: level.winningPayout,
        duration: (level.durationSeconds || 0) / 60,
        easy: levelQuestions.filter((question) => question.difficulty === "EASY").length,
        hard: levelQuestions.filter((question) => question.difficulty === "HARD").length,
        reached: progress.reachedCount ?? 0,
        cleared: progress.clearedCount ?? 0,
        status: level.isActive ? "ACTIVE" : "INACTIVE",
        isUsedInCompetition: level.isUsedInCompetition === true,
        hasOpenRounds: level.hasOpenRounds === true,
      };
    });
  }, []);
  const { data: levels, loading, error, setError, reload: loadLevels } = useFetchState(fetchLevels, {
    initialData: [],
    errorMessage: "Could not load the levels.",
  });
  const [editingLevel, setEditingLevel] = useState(null);
  const [savedMessage, setSavedMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const totalReached = levels.find((level) => level.id === 1)?.reached ?? 0;
  const totalCleared = levels.find((level) => level.id === 6)?.cleared ?? 0;

  const updateField = (field, value) => {
    setEditingLevel((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const saveLevel = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    const updates = {
      winningPayout: Number(editingLevel.passReward),
      durationSeconds: Number(editingLevel.duration) * 60,
    };
    if (editingLevel.entryFee !== "") updates.entryRiskAmount = Number(editingLevel.entryFee);
    try {
      await updateAdminLevel(editingLevel.id, updates);
      setEditingLevel(null);
      setSavedMessage("Level saved.");
      await loadLevels();
      window.setTimeout(() => setSavedMessage(""), 3000);
    } catch (saveError) {
      setError(saveError.message || "Could not save the level.");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (level) => {
    setError("");
    try {
      await setAdminLevelActive(level.id, level.status !== "ACTIVE");
      await loadLevels();
    } catch (toggleError) {
      setError(toggleError.message || "Could not switch the level off or on.");
    }
  };

  return (
    <div className="levels-page">
      <div className="levels-header">
        <div>
          <span className="levels-eyebrow">ADMIN / SETTINGS</span>
          <h1>Levels</h1>
          <p>Set the money, time, and prizes for each level.</p>
        </div>

        <div className="levels-count">
          <Layers3 size={17} />
          6 Competition Levels
        </div>
      </div>

      {savedMessage && (
        <div className="levels-success-message">
          <CheckCircle2 size={17} />
          {savedMessage}
        </div>
      )}

      {error && <div className="levels-demo-note" role="alert"><AlertCircle size={17} />{error} <button type="button" onClick={loadLevels}>Retry</button></div>}
      {loading && <div className="levels-demo-note" role="status">Loading levels…</div>}

      <section className="levels-overview">
        <OverviewCard
          icon={<Layers3 />}
          label="Total Levels"
          value="06"
        />
        <OverviewCard
          icon={<Users />}
          label="Students who started"
          value={loading ? "—" : totalReached}
        />
        <OverviewCard
          icon={<Trophy />}
          label="Reached Level 6"
          value={loading ? "—" : levels.find((level) => level.id === 6)?.reached ?? 0}
        />
        <OverviewCard
          icon={<CheckCircle2 />}
          label="Finished all levels"
          value={loading ? "—" : totalCleared}
        />
      </section>

      <section className="levels-section">
        <div className="levels-section-heading">
          <div>
            <h2>Competition Levels</h2>
            <p>Change each level's settings.</p>
          </div>
        </div>

        <div className="levels-grid">
          {levels.map((level) => {
            const percentage = level.reached
              ? Math.round((level.cleared / level.reached) * 100)
              : 0;

            return (
              <article className="level-card" key={level.id}>
                <div className="level-card-top">
                  <div className="level-number">
                    {String(level.id).padStart(2, "0")}
                  </div>

                  <span className={`level-status ${level.status.toLowerCase()}`}>
                    {levelStatusLabel(level.status)}
                  </span>
                </div>

                <h3>{level.name}</h3>
                <p className="level-card-subtitle">
                  Stage {level.id} of 6
                </p>

                <div className="level-card-details">
                  <div>
                    <span><WalletIcon /> Risk amount</span>
                    <strong>
                      {level.entryFee === "" ? "Not set" : formatCurrency(level.entryFee)}
                    </strong>
                  </div>

                  <div>
                    <span><Trophy size={14} /> Prize for passing</span>
                    <strong>
                      {level.passReward === "" ? "Not set" : formatCurrency(level.passReward)}
                    </strong>
                  </div>

                  <div>
                    <span><Clock3 size={14} /> Time</span>
                    <strong>{level.duration} minutes</strong>
                  </div>
                </div>

                <div className="level-card-progress">
                  <div className="level-progress-heading">
                    <span>How far students got</span>
                    <strong>{percentage}% cleared</strong>
                  </div>

                  <div className="level-progress-track">
                    <div style={{ width: `${Math.min(100, percentage)}%` }} />
                  </div>

                  <div className="level-progress-counts">
                    <span>{level.reached} reached</span>
                    <span>{level.cleared} cleared</span>
                  </div>
                </div>

                <div className="level-card-footer">
                  <button
                    className="level-edit-btn"
                    onClick={() => setEditingLevel({ ...level })}
                  >
                    <Pencil size={15} />
                    Edit level
                  </button>

                  <button
                    className="level-toggle-btn"
                    onClick={() => toggleStatus(level)}
                    title={level.status === "ACTIVE" ? "Switch off level" : "Switch on level"}
                  >
                    {level.status === "ACTIVE" ? "Switch off" : "Switch on"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="levels-section allocation-panel">
        <div className="levels-section-heading">
          <div>
            <h2>Which questions students get</h2>
            <p>Easy or hard depends on the student's year.</p>
          </div>
          <BookOpen size={21} />
        </div>

        <div className="allocation-grid">
          <div className="allocation-item">
            <span className="allocation-year">1st Year</span>
            <strong className="easy-tag">EASY</strong>
            <p>One question per level</p>
          </div>

          <div className="allocation-item">
            <span className="allocation-year">2nd Year</span>
            <strong className="hard-tag">HARD</strong>
            <p>One question per level</p>
          </div>

          <div className="allocation-item">
            <span className="allocation-year">3rd Year</span>
            <strong className="hard-tag">HARD</strong>
            <p>One question per level</p>
          </div>

          <div className="allocation-item">
            <span className="allocation-year">4th Year</span>
            <strong className="hard-tag">HARD</strong>
            <p>One question per level</p>
          </div>
        </div>

        <div className="allocation-note">
          Each student gets one question per level. Refreshing the page must not give a new question.
        </div>
      </section>

      <section className="levels-section rules-panel">
        <div className="levels-section-heading">
          <div>
            <h2>Competition Rules</h2>
            <p>How the competition works.</p>
          </div>
          <Settings2 size={21} />
        </div>

        <div className="rules-list">
          <div>
            <CheckCircle2 size={17} />
            Six levels, one after the other.
          </div>
          <div>
            <CheckCircle2 size={17} />
            Each answer is marked right or wrong.
          </div>
          <div>
            <CheckCircle2 size={17} />
            Your money decides if you can enter the next level.
          </div>
          <div>
            <CheckCircle2 size={17} />
            Students who cannot afford the next level keep the money they have.
          </div>
          <div>
            <CheckCircle2 size={17} />
            Clearing Level 6 means you finished.
          </div>
        </div>

        <p className="rules-disclaimer">
          Risk amounts, prizes, and timer rules still need the event team to confirm.
        </p>
      </section>

      {editingLevel && (
        <div
          className="level-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setEditingLevel(null);
            }
          }}
        >
          <div className="level-modal">
            <div className="level-modal-header">
              <div>
                <span className="levels-eyebrow">LEVEL SETTINGS</span>
                <h2>Edit {editingLevel.name}</h2>
              </div>

              <button
                className="level-modal-close"
                onClick={() => setEditingLevel(null)}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={saveLevel}>
              <div className="level-form-grid">
                <label>
                  Risk amount (₹)
                  <input
                    type="number"
                    min="0"
                    value={editingLevel.entryFee}
                    placeholder="Type the amount"
                    onChange={(e) => updateField("entryFee", e.target.value)}
                  />
                </label>

                <label>
                  Prize for passing (₹)
                  <input
                    type="number"
                    min="0"
                    value={editingLevel.passReward}
                    placeholder="Type the amount"
                    onChange={(e) => updateField("passReward", e.target.value)}
                  />
                </label>

                <label>
                  Time (minutes)
                  <input
                    type="number"
                    min="1"
                    max="60"
                    step="any"
                    required
                    value={editingLevel.duration}
                    onChange={(e) => updateField("duration", Number(e.target.value))}
                  />
                </label>

                <label>
                  Easy questions ready
                  <input
                    type="number"
                    min="0"
                    value={editingLevel.easy}
                    readOnly
                  />
                </label>

                <label>
                  Hard questions ready
                  <input
                    type="number"
                    min="0"
                    value={editingLevel.hard}
                    readOnly
                  />
                </label>
              </div>

              <div className="level-form-note">
                Question counts come from switched-on questions. Risk, prize, and time are saved with each level.
              </div>

              <div className="level-modal-actions">
                <button
                  type="button"
                  className="level-cancel-btn"
                  onClick={() => setEditingLevel(null)}
                >
                  Cancel
                </button>

                <button type="submit" className="level-save-btn" disabled={saving}>
                  <Save size={16} />
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function OverviewCard({ icon, label, value }) {
  return (
    <div className="levels-overview-card">
      <div className="levels-overview-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function WalletIcon() {
  return <span className="rupee-symbol">₹</span>;
}
