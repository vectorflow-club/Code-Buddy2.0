import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Search,
  X,
  Users,
  UserCheck,
  UserX,
  Eye,
} from "lucide-react";
import {
  bulkCreateAdminVolunteers,
  createAdminVolunteer,
  deleteAdminVolunteer,
  getAdminVolunteerDetails,
  getAdminVolunteers,
  resetAdminVolunteerPassword,
  setAdminVolunteerActive,
  updateAdminVolunteer,
} from "../../services/adminVolunteerService";
import "./volunteer.css";

const emptyForm = { name: "", username: "", password: "", assignedLab: "" };

// The three event spots. Must match ORGANIZER_LOCATIONS in backend/constants.
const ORGANIZER_LOCATIONS = ["M Block Entrance", "CCD", "Mangaluru Canteen"];
const MAX_BULK_ROWS = 50;

function statusLabel(volunteer) {
  return volunteer.isActive ? "ACTIVE" : "INACTIVE";
}

// A location stored before the dropdown existed (for example "Lab 1") is not
// a valid choice, so the edit form starts blank and forces a fresh pick.
function editableLocation(value) {
  return ORGANIZER_LOCATIONS.includes(value) ? value : "";
}

// Organizer passwords are stored as plain text and shown back to the admin.
// A value starting with $2 is a bcrypt hash from before the change: the
// original password cannot be recovered, so the admin resets it instead.
function displayPassword(password) {
  if (!password) return "—";
  if (password.startsWith("$2")) return "Scrambled (reset to set a readable password)";
  return password;
}

export default function VolunteerManagement() {
  const [volunteers, setVolunteers] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [showForm, setShowForm] = useState(false);
  const [showBulkForm, setShowBulkForm] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkResults, setBulkResults] = useState(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const [selectedVolunteer, setSelectedVolunteer] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState({ name: "", assignedLab: "" });
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [listLoadFailed, setListLoadFailed] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detailSaving, setDetailSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [success, setSuccess] = useState("");
  const [detailSuccess, setDetailSuccess] = useState("");
  const [editing, setEditing] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const detailRequestId = useRef(0);

  const loadVolunteers = async () => {
    setLoading(true);
    setError("");
    try {
      setVolunteers(await getAdminVolunteers());
      setListLoadFailed(false);
    } catch (loadError) {
      setListLoadFailed(true);
      setError(loadError.message || "Could not load organizers.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVolunteers();
  }, []);

  const openVolunteerDetails = async (volunteer) => {
    const requestId = ++detailRequestId.current;
    setSelectedVolunteer(volunteer);
    setDetailLoading(true);
    setDetailError("");
    setDetailSuccess("");
    setEditing(false);
    setResettingPassword(false);
    setConfirmingDelete(false);
    try {
      const result = await getAdminVolunteerDetails(volunteer.id);
      if (detailRequestId.current === requestId) {
        setSelectedVolunteer(result.volunteer);
        setEditForm({ name: result.volunteer.name || "", assignedLab: editableLocation(result.volunteer.assignedLab || "") });
      }
    } catch (loadError) {
      if (detailRequestId.current === requestId) {
        setDetailError(loadError.message || "Could not load organizer details.");
      }
    } finally {
      if (detailRequestId.current === requestId) setDetailLoading(false);
    }
  };

  const closeDetails = () => {
    detailRequestId.current += 1;
    setSelectedVolunteer(null);
    setDetailError("");
    setDetailSuccess("");
    setConfirmingDelete(false);
  };

  const retryDetails = () => {
    if (selectedVolunteer?.id) openVolunteerDetails(selectedVolunteer);
  };

  const filteredVolunteers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return volunteers.filter((volunteer) => {
      const matchesSearch = [volunteer.name, volunteer.username, volunteer.assignedLab]
        .some((value) => String(value || "").toLowerCase().includes(query));
      const matchesStatus = statusFilter === "ALL" || statusLabel(volunteer) === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [volunteers, search, statusFilter]);

  const activeCount = volunteers.filter((volunteer) => volunteer.isActive).length;
  const inactiveCount = volunteers.length - activeCount;

  const openAddForm = () => {
    setForm({ ...emptyForm });
    setError("");
    setSuccess("");
    setShowForm(true);
  };

  const closeForm = () => {
    if (saving) return;
    setShowForm(false);
    setForm({ ...emptyForm });
  };

  const openBulkForm = () => {
    setBulkText("");
    setBulkResults(null);
    setBulkError("");
    setError("");
    setSuccess("");
    setShowBulkForm(true);
  };

  const closeBulkForm = () => {
    if (bulkSaving) return;
    setShowBulkForm(false);
    setBulkText("");
    setBulkResults(null);
    setBulkError("");
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await createAdminVolunteer({
        name: form.name.trim(),
        username: form.username.trim(),
        password: form.password,
        assignedLab: form.assignedLab.trim(),
      });
      setShowForm(false);
      setForm({ ...emptyForm });
      setSuccess("Organizer created successfully.");
      await loadVolunteers();
    } catch (saveError) {
      setError(saveError.message || "Could not create the organizer.");
    } finally {
      setSaving(false);
    }
  };

  const handleBulkSave = async (event) => {
    event.preventDefault();
    if (bulkSaving) return;
    const lines = bulkText.split("\n").map((line) => line.trim()).filter((line) => line !== "");
    if (lines.length === 0) {
      setBulkError("Enter at least one organizer, one per line.");
      return;
    }
    if (lines.length > MAX_BULK_ROWS) {
      setBulkError(`Bulk add is limited to ${MAX_BULK_ROWS} organizers at a time.`);
      return;
    }
    setBulkSaving(true);
    setBulkError("");
    setBulkResults(null);
    try {
      const rows = [];
      const localResults = [];
      lines.forEach((line, lineIndex) => {
        const parts = line.split(",").map((part) => part.trim());
        if (parts.length !== 4) {
          localResults.push({
            lineNumber: lineIndex + 1,
            username: parts[1] || "",
            status: "skipped",
            reason: "Use the format: Full Name, username, password, location.",
          });
          return;
        }
        rows.push({
          lineNumber: lineIndex + 1,
          name: parts[0],
          username: parts[1],
          password: parts[2],
          assignedLab: parts[3],
        });
      });
      let merged = [...localResults];
      if (rows.length > 0) {
        const payload = await bulkCreateAdminVolunteers(
          rows.map(({ name, username, password, assignedLab }) => ({ name, username, password, assignedLab }))
        );
        merged = merged.concat(
          payload.results.map((result) => ({
            lineNumber: rows[result.index].lineNumber,
            username: result.username,
            status: result.status,
            reason: result.reason,
          }))
        );
        if (payload.summary.created > 0) {
          setSuccess(`Bulk add complete: ${payload.summary.created} created, ${payload.summary.skipped} skipped.`);
          await loadVolunteers();
        }
      }
      merged.sort((a, b) => a.lineNumber - b.lineNumber);
      setBulkResults(merged);
    } catch (bulkSaveError) {
      setBulkError(bulkSaveError.message || "Could not add organizers in bulk.");
    } finally {
      setBulkSaving(false);
    }
  };

  const handleUpdate = async (event) => {
    event.preventDefault();
    if (!selectedVolunteer || detailSaving) return;
    setDetailSaving(true);
    setDetailError("");
    setDetailSuccess("");
    try {
      const result = await updateAdminVolunteer(selectedVolunteer.id, {
        name: editForm.name.trim(),
        assignedLab: editForm.assignedLab.trim(),
      });
      // The update response carries no password; keep the one the detail
      // view already loaded so it stays visible.
      setSelectedVolunteer({ ...result.volunteer, password: selectedVolunteer.password });
      setEditForm({ name: result.volunteer.name || "", assignedLab: editableLocation(result.volunteer.assignedLab || "") });
      setEditing(false);
      setDetailSuccess(result.message || "Organizer details updated successfully.");
      await loadVolunteers();
    } catch (updateError) {
      setDetailError(updateError.message || "Could not update organizer details.");
    } finally {
      setDetailSaving(false);
    }
  };

  const handlePasswordReset = async (event) => {
    event.preventDefault();
    if (!selectedVolunteer || passwordSaving) return;
    setPasswordSaving(true);
    setDetailError("");
    setDetailSuccess("");
    try {
      const resetTo = newPassword;
      const result = await resetAdminVolunteerPassword(selectedVolunteer.id, resetTo);
      setSelectedVolunteer({ ...result.volunteer, password: resetTo });
      setNewPassword("");
      setResettingPassword(false);
      setDetailSuccess(result.message || "Organizer password reset successfully.");
    } catch (resetError) {
      setDetailError(resetError.message || "Could not reset the organizer password.");
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedVolunteer || deleting) return;
    setDeleting(true);
    setDetailError("");
    setDetailSuccess("");
    try {
      const result = await deleteAdminVolunteer(selectedVolunteer.id);
      setSuccess(result.message || "Organizer deleted permanently.");
      closeDetails();
      await loadVolunteers();
    } catch (deleteError) {
      setDetailError(deleteError.message || "Could not delete the organizer.");
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  const toggleStatus = async (volunteer) => {
    if (updatingId !== null) return;
    setUpdatingId(volunteer.id);
    setError("");
    setSuccess("");
    try {
      const result = await setAdminVolunteerActive(volunteer.id, !volunteer.isActive);
      setSuccess(result.message || `Organizer ${volunteer.isActive ? "deactivated" : "reactivated"} successfully.`);
      await loadVolunteers();
      if (selectedVolunteer?.id === volunteer.id) {
        setSelectedVolunteer({ ...result.volunteer, password: selectedVolunteer.password });
        setDetailSuccess(result.message || "Organizer status updated successfully.");
      }
    } catch (updateError) {
      setError(updateError.message || "Could not update the organizer status.");
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="volunteer-management">
      <div className="volunteer-page-header">
        <div>
          <span className="admin-eyebrow">COMPETITION MANAGEMENT</span>
          <h1>Organizer Management.</h1>
          <p>Manage organizer accounts and competition assignments.</p>
        </div>
        <div style={{ display: "flex", gap: "12px" }}>
          <button className="volunteer-add-btn" onClick={openBulkForm}>
            <Plus size={18} />
            Bulk Add
          </button>
          <button className="volunteer-add-btn" onClick={openAddForm}>
            <Plus size={18} />
            Add Organizer
          </button>
        </div>
      </div>

      <div className="volunteer-summary">
        <div><Users size={21} /><span>Total Organizers</span><strong>{volunteers.length}</strong></div>
        <div><UserCheck size={21} /><span>Active Organizers</span><strong>{activeCount}</strong></div>
        <div><UserX size={21} /><span>Inactive Organizers</span><strong>{inactiveCount}</strong></div>
      </div>

      <div className="volunteer-toolbar">
        <div className="volunteer-search">
          <Search size={18} />
          <input type="text" placeholder="Search name, username or assigned location..." value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="ALL">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </div>

      {error && !showForm && !showBulkForm && <p className="volunteer-api-message" role="alert">{error}</p>}
      {success && <p className="volunteer-api-message" role="status">{success}</p>}

      <div className="volunteer-table-container">
        <div className="volunteer-table-heading"><h2>Organizer Directory</h2><span>{filteredVolunteers.length} organizers</span></div>
        <div className="volunteer-table-scroll">
          <table className="volunteer-table">
            <thead><tr><th>ORGANIZER</th><th>ASSIGNED LOCATION</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
            <tbody>
              {filteredVolunteers.map((volunteer) => {
                const status = statusLabel(volunteer);
                return (
                  <tr key={volunteer.id}>
                    <td><strong>{volunteer.name}</strong><small>{volunteer.username}</small></td>
                    <td>{volunteer.assignedLab || "—"}</td>
                    <td><span className={`volunteer-status ${status.toLowerCase()}`}>{status}</span></td>
                    <td>
                      <div className="volunteer-actions">
        <button type="button" title="View details" aria-label={`View ${volunteer.name}`} disabled={detailSaving || passwordSaving} onClick={() => openVolunteerDetails(volunteer)}><Eye size={15} /></button>
                        <button type="button" title={volunteer.isActive ? "Deactivate organizer" : "Reactivate organizer"} aria-label={volunteer.isActive ? "Deactivate organizer" : "Reactivate organizer"} disabled={updatingId !== null} onClick={() => toggleStatus(volunteer)}>
                          {volunteer.isActive ? <UserX size={15} /> : <UserCheck size={15} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && filteredVolunteers.length === 0 && <tr><td colSpan="4" className="volunteer-empty">No organizers found.</td></tr>}
              {loading && <tr><td colSpan="4" className="volunteer-empty">Loading organizers…</td></tr>}
            </tbody>
          </table>
        </div>
        {!loading && listLoadFailed && <button className="volunteer-close-btn" type="button" onClick={loadVolunteers}>Retry loading organizers</button>}
      </div>

      {showForm && (
        <div className="volunteer-modal-overlay">
          <div className="volunteer-modal">
            <div className="volunteer-modal-header"><div><span className="admin-eyebrow">ORGANIZER ACCOUNTS</span><h2>Add Organizer</h2></div><button type="button" onClick={closeForm} aria-label="Close add organizer form"><X size={20} /></button></div>
            {error && <p className="volunteer-api-message" role="alert">{error}</p>}
            <form onSubmit={handleSave}>
              <div className="volunteer-form-field"><label htmlFor="volunteer-name">Full Name</label><input id="volunteer-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Enter organizer name" required minLength={2} /></div>
              <div className="volunteer-form-field"><label htmlFor="volunteer-username">Username</label><input id="volunteer-username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="Enter username" autoComplete="off" required minLength={3} /></div>
              <div className="volunteer-form-field"><label htmlFor="volunteer-password">Password</label><input id="volunteer-password" type="text" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Set an initial password" autoComplete="new-password" required minLength={8} /></div>
              <div className="volunteer-form-field"><label htmlFor="volunteer-location">Assigned Location</label><select id="volunteer-location" value={form.assignedLab} onChange={(event) => setForm({ ...form, assignedLab: event.target.value })} required><option value="">Select a location</option>{ORGANIZER_LOCATIONS.map((location) => <option key={location} value={location}>{location}</option>)}</select></div>
              <div className="volunteer-form-actions"><button type="button" onClick={closeForm} disabled={saving}>Cancel</button><button type="submit" disabled={saving}>{saving ? "Adding…" : "Add Organizer"}</button></div>
            </form>
          </div>
        </div>
      )}

      {showBulkForm && (
        <div className="volunteer-modal-overlay">
          <div className="volunteer-modal">
            <div className="volunteer-modal-header"><div><span className="admin-eyebrow">ORGANIZER ACCOUNTS</span><h2>Bulk Add Organizers</h2></div><button type="button" onClick={closeBulkForm} aria-label="Close bulk add form"><X size={20} /></button></div>
            {bulkError && <p className="volunteer-api-message" role="alert">{bulkError}</p>}
            <form onSubmit={handleBulkSave}>
              <div className="volunteer-form-field"><label htmlFor="volunteer-bulk-text">Organizers</label><textarea id="volunteer-bulk-text" value={bulkText} onChange={(event) => setBulkText(event.target.value)} placeholder={"Ananya Rao, ananya, password123, CCD\nLikith Kumar, likith, password123, M Block Entrance"} rows={8} /></div>
              <p className="volunteer-bulk-hint">One organizer per line: Full Name, username, password, location. Locations must be M Block Entrance, CCD or Mangaluru Canteen. Passwords need 8 or more characters. Up to {MAX_BULK_ROWS} lines at a time.</p>
              {bulkResults && (
                <ul className="volunteer-bulk-results" role="status">
                  {bulkResults.map((result) => (
                    <li key={result.lineNumber} className={result.status === "created" ? "volunteer-bulk-created" : "volunteer-bulk-skipped"}>
                      Line {result.lineNumber}{result.username ? ` (${result.username})` : ""}: {result.status === "created" ? "Created" : `Skipped - ${result.reason}`}
                    </li>
                  ))}
                </ul>
              )}
              <div className="volunteer-form-actions"><button type="button" onClick={closeBulkForm} disabled={bulkSaving}>Done</button><button type="submit" disabled={bulkSaving}>{bulkSaving ? "Adding…" : "Add Organizers"}</button></div>
            </form>
          </div>
        </div>
      )}

      {selectedVolunteer && (
        <div className="volunteer-modal-overlay">
          <div className="volunteer-modal">
            <div className="volunteer-modal-header"><div><span className="admin-eyebrow">ORGANIZER DETAILS</span><h2>{selectedVolunteer.name}</h2></div><button type="button" onClick={closeDetails} aria-label="Close organizer details" disabled={detailSaving || passwordSaving || deleting}><X size={20} /></button></div>
            {detailLoading && <p className="volunteer-empty">Loading organizer details…</p>}
            {detailError && <p className="volunteer-api-message" role="alert">{detailError}</p>}
            {detailError && <button className="volunteer-close-btn" type="button" onClick={retryDetails} disabled={detailLoading}>Retry details</button>}
            {detailSuccess && <p className="volunteer-api-message" role="status">{detailSuccess}</p>}
            {!detailLoading && !detailError && (
              <>
                <div className="volunteer-detail-list">
                  <div><span>Username</span><strong>{selectedVolunteer.username}</strong></div>
                  <div><span>Password</span><strong>{displayPassword(selectedVolunteer.password)}</strong></div>
                  <div><span>Role</span><strong>{selectedVolunteer.role || "—"}</strong></div>
                  <div><span>Assigned Location</span><strong>{selectedVolunteer.assignedLab || "—"}</strong></div>
                  <div><span>Account Status</span><strong>{statusLabel(selectedVolunteer)}</strong></div>
                  <div><span>Created</span><strong>{selectedVolunteer.createdAt || "—"}</strong></div>
                  <div><span>Last Updated</span><strong>{selectedVolunteer.updatedAt || "—"}</strong></div>
                </div>
                {!editing && !resettingPassword && !confirmingDelete && <div className="volunteer-form-actions"><button type="button" onClick={() => { setEditForm({ name: selectedVolunteer.name || "", assignedLab: editableLocation(selectedVolunteer.assignedLab || "") }); setEditing(true); setDetailError(""); }}>Edit details</button><button type="button" onClick={() => { setNewPassword(""); setResettingPassword(true); setDetailError(""); }}>Reset password</button><button type="button" onClick={() => { setConfirmingDelete(true); setDetailError(""); }}>Delete</button></div>}
                {confirmingDelete && <div className="volunteer-form-actions"><span className="volunteer-delete-warning">Delete permanently? This cannot be undone.</span><button type="button" onClick={() => setConfirmingDelete(false)} disabled={deleting}>Cancel</button><button type="button" className="volunteer-danger-btn" onClick={handleDelete} disabled={deleting}>{deleting ? "Deleting…" : "Delete permanently"}</button></div>}
                {editing && <form onSubmit={handleUpdate}>
                  <div className="volunteer-form-field"><label htmlFor="edit-volunteer-name">Full Name</label><input id="edit-volunteer-name" value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} required minLength={2} /></div>
                  <div className="volunteer-form-field"><label htmlFor="edit-volunteer-location">Assigned Location</label><select id="edit-volunteer-location" value={editForm.assignedLab} onChange={(event) => setEditForm({ ...editForm, assignedLab: event.target.value })} required><option value="">Select a location</option>{ORGANIZER_LOCATIONS.map((location) => <option key={location} value={location}>{location}</option>)}</select></div>
                  <div className="volunteer-form-actions"><button type="button" onClick={() => setEditing(false)} disabled={detailSaving}>Cancel</button><button type="submit" disabled={detailSaving}>{detailSaving ? "Saving…" : "Save changes"}</button></div>
                </form>}
                {resettingPassword && <form onSubmit={handlePasswordReset}>
                  <div className="volunteer-form-field"><label htmlFor="reset-volunteer-password">New Password</label><input id="reset-volunteer-password" type="text" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" required minLength={8} /></div>
                  <div className="volunteer-form-actions"><button type="button" onClick={() => setResettingPassword(false)} disabled={passwordSaving}>Cancel</button><button type="submit" disabled={passwordSaving}>{passwordSaving ? "Resetting…" : "Reset password"}</button></div>
                </form>}
              </>
            )}
            <button className="volunteer-close-btn" onClick={closeDetails} disabled={detailSaving || passwordSaving || deleting}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
