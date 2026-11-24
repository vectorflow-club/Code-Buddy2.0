import { createAdminRequest } from "./adminRequest";

const adminRequest = createAdminRequest({
  makeError: (message) => new Error(message),
  sessionMessage: "Your admin session is missing. Please sign in again.",
  configMessage:
    "The admin side is not set up. Please check the site settings and try again.",
  networkMessage: "Could not reach the site. Check your connection and try again.",
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
