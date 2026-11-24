import { createAdminRequest } from "./adminRequest";

export class AdminVolunteerApiError extends Error {
  constructor(message, { status = null, code = null, kind = "api" } = {}) {
    super(message);
    this.name = "AdminVolunteerApiError";
    this.status = status;
    this.code = code;
    this.kind = kind;
  }
}

const adminRequest = createAdminRequest({
  makeError: (message, meta) => new AdminVolunteerApiError(message, meta),
  sessionMessage: "Your admin session is missing. Please sign in again.",
  configMessage:
    "The admin side is not set up. Please check the site settings and try again.",
  networkMessage: "Could not reach the site. Check your connection and try again.",
  unauthorizedMessage: "Your admin session is no longer authorized. Please sign in again.",
  failureMessage: (status) => `The organizer request failed (HTTP ${status}). Please try again.`,
});

function validateVolunteer(payload, context = "organizer response") {
  if (!payload?.volunteer || typeof payload.volunteer !== "object" || Array.isArray(payload.volunteer)) {
    throw new AdminVolunteerApiError(`The ${context} is missing valid organizer data.`, {
      kind: "response",
    });
  }
  return payload;
}

export async function getAdminVolunteers() {
  const result = await adminRequest("/api/admin/volunteers");
  if (!Array.isArray(result.volunteers)) {
    throw new AdminVolunteerApiError("The organizer list response is missing a valid organizers array.", {
      kind: "response",
    });
  }
  return result.volunteers;
}

export async function createAdminVolunteer({ name, username, password, assignedLab }) {
  const payload = await adminRequest("/api/admin/volunteers", {
    method: "POST",
    body: { name, username, password, ...(assignedLab ? { assignedLab } : {}) },
  });
  return validateVolunteer(payload, "create response");
}

export async function getAdminVolunteerDetails(id) {
  const payload = await adminRequest(`/api/admin/volunteers/${encodeURIComponent(id)}`);
  return validateVolunteer(payload, "details response");
}

export async function updateAdminVolunteer(id, fields) {
  const body = {};
  if (fields.name !== undefined) body.name = fields.name;
  if (fields.assignedLab !== undefined) body.assignedLab = fields.assignedLab;
  const payload = await adminRequest(`/api/admin/volunteers/${encodeURIComponent(id)}`, {
    method: "PUT",
    body,
  });
  return validateVolunteer(payload, "update response");
}

export async function resetAdminVolunteerPassword(id, password) {
  const payload = await adminRequest(
    `/api/admin/volunteers/${encodeURIComponent(id)}/reset-password`,
    { method: "PATCH", body: { newPassword: password } },
  );
  return validateVolunteer(payload, "password reset response");
}

export async function setAdminVolunteerActive(id, isActive) {
  const action = isActive ? "reactivate" : "deactivate";
  const payload = await adminRequest(`/api/admin/volunteers/${encodeURIComponent(id)}/${action}`, {
    method: "PATCH",
  });
  return validateVolunteer(payload, `${action} response`);
}

export async function deleteAdminVolunteer(id) {
  return adminRequest(`/api/admin/volunteers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function bulkCreateAdminVolunteers(volunteers) {
  const payload = await adminRequest("/api/admin/volunteers/bulk", {
    method: "POST",
    body: { volunteers },
  });
  if (!Array.isArray(payload.results) || typeof payload.summary !== "object" || payload.summary === null) {
    throw new AdminVolunteerApiError("The bulk add response is missing per-row results.", {
      kind: "response",
    });
  }
  return payload;
}
