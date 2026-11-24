import { useCallback, useRef, useState } from "react";
import {
  Plus,
  Search,
  Pencil,
  Trash,
  Trash2,
  X,
  BookOpen,
} from "lucide-react";
import "./questions.css";
import { useFetchState } from "../../hooks/useFetchState";
import {
  createAdminQuestion,
  deleteAdminQuestion,
  getAdminQuestions,
  setAdminQuestionActive,
  updateAdminQuestion,
} from "../../services/adminQuestionService";

const emptyForm = {
  title: "",
  level: 1,
  difficulty: "EASY",
  statement: "",
  constraints: "",
  bankNumber: "",
  showBankNumber: true,
  examples: [{ input: "", output: "" }],
  hiddenTestCases: [],
};

export default function QuestionManagement() {
  const fetchQuestions = useCallback(async () => {
    const data = await getAdminQuestions();
    return data.map((question) => ({
      id: question.id,
      number: question.bankNumber || question.id,
      bankNumber: question.bankNumber || "",
      showBankNumber: question.showBankNumber !== false,
      title: question.title,
      level: question.levelNumber,
      difficulty: question.difficulty,
      statement: question.statement,
      constraints: Array.isArray(question.constraints) ? question.constraints.join("\n") : "",
      examples: Array.isArray(question.examples) ? question.examples : [],
      hiddenTestCases: Array.isArray(question.hiddenTestCases) ? question.hiddenTestCases : [],
      assigned: question.isAssigned === true,
      isActive: question.isActive === true,
    }));
  }, []);
  const { data: questions, loading, error, setError, reload: loadQuestions } = useFetchState(fetchQuestions, {
    initialData: [],
    errorMessage: "Could not load questions.",
  });
  const [search, setSearch] = useState("");
  const [difficulty, setDifficulty] = useState("ALL");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const filteredQuestions = questions.filter((question) => {
    const matchesSearch =
      question.title.toLowerCase().includes(search.toLowerCase()) ||
      question.number.toLowerCase().includes(search.toLowerCase());

    const matchesDifficulty =
      difficulty === "ALL" ||
      question.difficulty === difficulty;

    return matchesSearch && matchesDifficulty;
  });

  const openAddForm = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEditForm = (question) => {
    setEditingId(question.id);

    setForm({
      title: question.title,
      level: question.level,
      difficulty: question.difficulty,
      statement: question.statement,
      constraints: question.constraints,
      bankNumber: question.bankNumber || "",
      showBankNumber: question.showBankNumber !== false,
      examples: question.examples.length > 0
        ? question.examples.map((example) => ({ ...example }))
        : [{ input: "", output: "" }],
      hiddenTestCases: question.hiddenTestCases.map((testCase) => ({ ...testCase })),
    });

    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...emptyForm });
  };

  const updateExample = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      examples: prev.examples.map((example, i) =>
        i === index ? { ...example, [field]: value } : example
      ),
    }));
  };

  const updateHiddenCase = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      hiddenTestCases: prev.hiddenTestCases.map((testCase, i) =>
        i === index ? { ...testCase, [field]: value } : testCase
      ),
    }));
  };

  const addExample = () => {
    setForm((prev) => ({ ...prev, examples: [...prev.examples, { input: "", output: "" }] }));
  };

  const addHiddenCase = () => {
    setForm((prev) => ({
      ...prev,
      hiddenTestCases: [...prev.hiddenTestCases, { input: "", expectedOutput: "" }],
    }));
  };

  const removeExample = (index) => {
    setForm((prev) => ({ ...prev, examples: prev.examples.filter((_, i) => i !== index) }));
  };

  const removeHiddenCase = (index) => {
    setForm((prev) => ({
      ...prev,
      hiddenTestCases: prev.hiddenTestCases.filter((_, i) => i !== index),
    }));
  };

  const moveExampleToHidden = (index) => {
    setForm((prev) => {
      const example = prev.examples[index];
      return {
        ...prev,
        examples: prev.examples.filter((_, i) => i !== index),
        hiddenTestCases: [
          ...prev.hiddenTestCases,
          { input: example.input, expectedOutput: example.output },
        ],
      };
    });
  };

  const moveHiddenToVisible = (index) => {
    setForm((prev) => {
      const testCase = prev.hiddenTestCases[index];
      return {
        ...prev,
        hiddenTestCases: prev.hiddenTestCases.filter((_, i) => i !== index),
        examples: [...prev.examples, { input: testCase.input, output: testCase.expectedOutput }],
      };
    });
  };

  const handleSave = (event) => {
    event.preventDefault();
    if (savingRef.current) return;
    const constraints = form.constraints.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    // Rows left completely blank are dropped, not saved as empty test cases.
    // Example objects keep their other fields (id, title, explanation) —
    // only input/output are ever edited here.
    const examples = form.examples.filter((example) => example.input !== "" || example.output !== "");
    const hiddenTestCases = form.hiddenTestCases.filter(
      (testCase) => testCase.input !== "" || testCase.expectedOutput !== ""
    );
    if (examples.length === 0) {
      setError("Add at least one visible test case.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    const payload = {
      title: form.title.trim(),
      statement: form.statement.trim(),
      levelNumber: Number(form.level),
      difficulty: form.difficulty,
      constraints,
      bankNumber: form.bankNumber.trim(),
      showBankNumber: form.showBankNumber,
      examples,
      hiddenTestCases,
    };

    const save = async () => {
      setError("");
      try {
        if (editingId !== null) await updateAdminQuestion(editingId, payload);
        else await createAdminQuestion(payload);
        closeForm();
        await loadQuestions();
      } catch (saveError) {
        setError(saveError.message || "Could not save the question.");
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    };
    save();
  };

  const handleDelete = async (question) => {
    if (question.assigned && question.isActive) return;
    const confirmed = window.confirm(
      `Are you sure you want to ${question.isActive ? "deactivate" : "reactivate"} "${question.title}"?`
    );
    if (!confirmed) return;
    setError("");
    try {
      await setAdminQuestionActive(question.id, !question.isActive);
      await loadQuestions();
    } catch (updateError) {
      setError(updateError.message || "Could not update the question status.");
    }
  };

  const handlePermanentDelete = async (question) => {
    const confirmed = window.confirm(
      `Are you sure you want to permanently delete "${question.title}"? This cannot be undone.`
    );
    if (!confirmed) return;
    setError("");
    try {
      await deleteAdminQuestion(question.id);
      await loadQuestions();
    } catch (deleteError) {
      setError(deleteError.message || "Could not delete the question.");
    }
  };

  return (
    <div className="question-management">

      <div className="question-page-header">
        <div>
          <span className="admin-eyebrow">
            COMPETITION MANAGEMENT
          </span>
          <h1>Question Bank.</h1>
          <p>
            Create, edit and manage coding questions across levels.
          </p>
        </div>

        <button
          className="question-add-btn"
          onClick={openAddForm}
        >
          <Plus size={18} />
          Add Question
        </button>
      </div>

      <div className="question-summary">
        <div className="question-summary-card">
          <span>Total Questions</span>
          <strong>{questions.length}</strong>
        </div>

        <div className="question-summary-card">
          <span>Easy Questions</span>
          <strong>
            {questions.filter((q) => q.difficulty === "EASY").length}
          </strong>
        </div>

        <div className="question-summary-card">
          <span>Hard Questions</span>
          <strong>
            {questions.filter((q) => q.difficulty === "HARD").length}
          </strong>
        </div>
      </div>

      {error && <p role="alert">{error} <button type="button" onClick={loadQuestions}>Retry</button></p>}
      {loading && <p role="status">Loading questions…</p>}

      <div className="question-toolbar">
        <div className="question-search">
          <Search size={18} />

          <input
            type="text"
            placeholder="Search by question title or ID..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <select
          value={difficulty}
          onChange={(event) => setDifficulty(event.target.value)}
        >
          <option value="ALL">All Difficulties</option>
          <option value="EASY">Easy</option>
          <option value="HARD">Hard</option>
        </select>
      </div>

      <div className="question-table-container">
        <div className="question-table-heading">
          <div>
            <BookOpen size={20} />
            <h2>All Questions</h2>
          </div>

          <span>{filteredQuestions.length} questions</span>
        </div>

        <div className="question-table-scroll">
          <table className="question-table">
            <thead>
              <tr>
                <th>QUESTION ID</th>
                <th>TITLE</th>
                <th>LEVEL</th>
                <th>DIFFICULTY</th>
                <th>STATUS</th>
                <th>ACTIONS</th>
              </tr>
            </thead>

            <tbody>
              {filteredQuestions.map((question) => (
                <tr key={question.id}>
                  <td>{question.number}</td>

                  <td>
                    <strong>{question.title}</strong>
                  </td>

                  <td>Level {question.level}</td>

                  <td>
                    <span
                      className={`question-difficulty ${question.difficulty.toLowerCase()}`}
                    >
                      {question.difficulty}
                    </span>
                  </td>

                  <td>
                    <span
                      className={
                        question.assigned
                          ? "question-status assigned"
                          : question.isActive ? "question-status available" : "question-status inactive"
                      }
                    >
                      {question.assigned ? "Assigned" : question.isActive ? "Available" : "Inactive"}
                    </span>
                  </td>

                  <td>
                    <div className="question-actions">
                      <button
                        title="Edit question"
                        disabled={!question.isActive}
                        onClick={() => openEditForm(question)}
                      >
                        <Pencil size={16} />
                      </button>

                      <button
                        title={question.isActive ? "Deactivate question" : "Reactivate question"}
                        disabled={question.assigned && question.isActive}
                        onClick={() => handleDelete(question)}
                      >
                        <Trash2 size={16} />
                      </button>

                      <button
                        title="Permanently delete question"
                        onClick={() => handlePermanentDelete(question)}
                      >
                        <Trash size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {!loading && !error && filteredQuestions.length === 0 && (
                <tr>
                  <td colSpan="6" className="question-empty">
                    No questions found. Try another search or add a question.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="question-modal-overlay">
          <div className="question-modal">

            <div className="question-modal-header">
              <div>
                <span className="admin-eyebrow">
                  QUESTION MANAGEMENT
                </span>

                <h2>
                  {editingId !== null
                    ? "Edit Question"
                    : "Add New Question"}
                </h2>
              </div>

              <button
                type="button"
                className="question-close-btn"
                onClick={closeForm}
              >
                <X size={21} />
              </button>
            </div>

            <form onSubmit={handleSave}>
              <div className="question-form-grid">

                <div className="question-form-field full-width">
                  <label>Question Title</label>
                  <input
                    type="text"
                    placeholder="Enter question title"
                    value={form.title}
                    onChange={(event) =>
                      setForm({ ...form, title: event.target.value })
                    }
                    required
                  />
                </div>

                <div className="question-form-field">
                  <label>Competition Level</label>
                  <input
                    type="number"
                    min="1"
                    value={form.level}
                    onChange={(event) =>
                      setForm({ ...form, level: event.target.value })
                    }
                    required
                  />
                </div>

                <div className="question-form-field">
                  <label>Difficulty</label>
                  <select
                    value={form.difficulty}
                    onChange={(event) =>
                      setForm({ ...form, difficulty: event.target.value })
                    }
                  >
                    <option value="EASY">Easy</option>
                    <option value="HARD">Hard</option>
                  </select>
                </div>

                <div className="question-form-field full-width">
                  <label>Problem Statement</label>
                  <textarea
                    rows="4"
                    placeholder="Describe the coding problem..."
                    value={form.statement}
                    onChange={(event) =>
                      setForm({ ...form, statement: event.target.value })
                    }
                    required
                  />
                </div>

                <div className="question-form-field full-width">
                  <label>Constraints</label>
                  <textarea
                    rows="2"
                    placeholder="Enter input constraints"
                    value={form.constraints}
                    onChange={(event) =>
                      setForm({ ...form, constraints: event.target.value })
                    }
                  />
                </div>

                <div className="question-form-field">
                  <label>Question Number</label>
                  <input
                    type="text"
                    placeholder="e.g. E1"
                    maxLength={20}
                    value={form.bankNumber}
                    onChange={(event) =>
                      setForm({ ...form, bankNumber: event.target.value })
                    }
                  />
                </div>

                <div className="question-form-field question-checkbox-field">
                  <label>
                    <input
                      type="checkbox"
                      checked={form.showBankNumber}
                      onChange={(event) =>
                        setForm({ ...form, showBankNumber: event.target.checked })
                      }
                    />
                    Show number to student
                  </label>
                </div>

                <div className="question-form-field full-width">
                  <label>Visible test cases (shown to students)</label>
                  {form.examples.map((example, index) => (
                    <div className="test-case-row" key={index}>
                      <textarea
                        rows="2"
                        placeholder="Input"
                        value={example.input}
                        onChange={(event) =>
                          updateExample(index, "input", event.target.value)
                        }
                      />
                      <textarea
                        rows="2"
                        placeholder="Expected output"
                        value={example.output}
                        onChange={(event) =>
                          updateExample(index, "output", event.target.value)
                        }
                      />
                      <div className="test-case-row-actions">
                        <button
                          type="button"
                          onClick={() => moveExampleToHidden(index)}
                        >
                          Make hidden
                        </button>
                        <button
                          type="button"
                          onClick={() => removeExample(index)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="test-case-add-btn"
                    onClick={addExample}
                  >
                    + Add visible test case
                  </button>
                </div>

                <div className="question-form-field full-width">
                  <label>Hidden test cases (not shown to students)</label>
                  {form.hiddenTestCases.map((testCase, index) => (
                    <div className="test-case-row" key={index}>
                      <textarea
                        rows="2"
                        placeholder="Input"
                        value={testCase.input}
                        onChange={(event) =>
                          updateHiddenCase(index, "input", event.target.value)
                        }
                      />
                      <textarea
                        rows="2"
                        placeholder="Expected output"
                        value={testCase.expectedOutput}
                        onChange={(event) =>
                          updateHiddenCase(index, "expectedOutput", event.target.value)
                        }
                      />
                      <div className="test-case-row-actions">
                        <button
                          type="button"
                          onClick={() => moveHiddenToVisible(index)}
                        >
                          Make visible
                        </button>
                        <button
                          type="button"
                          onClick={() => removeHiddenCase(index)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="test-case-add-btn"
                    onClick={addHiddenCase}
                  >
                    + Add hidden test case
                  </button>
                </div>

              </div>

              <div className="question-form-actions">
                <button
                  type="button"
                  className="question-cancel-btn"
                  onClick={closeForm}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="question-save-btn"
                  disabled={saving}
                >
                  {saving ? "Saving…" : editingId !== null
                    ? "Save Changes"
                    : "Add Question"}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
}
