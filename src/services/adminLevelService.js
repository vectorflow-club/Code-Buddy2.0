import { createAdminRequest } from "./adminRequest";

const adminRequest = createAdminRequest({
  makeError: (message) => new Error(message),
  sessionMessage: "Your admin sign-in is missing. Please sign in again.",
  configMessage:
    "The admin side is not set up. Please check the site settings and try again.",
  networkMessage: "Could not reach the site. Check your connection and try again.",
  unauthorizedMessage: "Your admin sign-in ran out. Please sign in again.",
  failureMessage: (status) => `The level change did not work (error ${status}).`,
});

export async function getAdminLevels() {
  const payload = await adminRequest("/api/admin/levels");
  if (!Array.isArray(payload.levels)) {
    throw new Error("The levels reply came back incomplete.");
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
