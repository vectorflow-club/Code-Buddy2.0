import { createAdminRequest } from "./adminRequest";

const adminRequest = createAdminRequest({
  makeError: (message) => new Error(message),
  sessionMessage: "Your admin session is missing. Please sign in again.",
  configMessage:
    "Admin API is not configured. Set VITE_API_BASE_URL and restart the frontend.",
  networkMessage: "Could not reach the server. Check that it is running and try again.",
  unauthorizedMessage: "Your admin session is no longer authorized. Please sign in again.",
  failureMessage: (status) => `The level request failed (HTTP ${status}).`,
});

export async function getAdminLevels() {
  const payload = await adminRequest("/api/admin/levels");
  if (!Array.isArray(payload.levels)) {
    throw new Error("The levels response is missing a valid levels array.");
  }
  return payload.levels;
}

export function updateAdminLevel(number, updates) {
  return adminRequest(`/api/admin/levels/${encodeURIComponent(number)}`, {
    method: "PUT",
    body: updates,
  });
}

export function setAdminLevelActive(number, isActive) {
  const action = isActive ? "activate" : "deactivate";
  return adminRequest(`/api/admin/levels/${encodeURIComponent(number)}/${action}`, {
    method: "PATCH",
  });
}
