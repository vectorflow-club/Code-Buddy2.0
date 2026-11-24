import { createAdminRequest } from "./adminRequest";

const adminRequest = createAdminRequest({
  makeError: (message) => new Error(message),
  sessionMessage: "Your admin session is missing. Please sign in again.",
  configMessage:
    "Admin API is not configured. Set VITE_API_BASE_URL and restart the frontend.",
  networkMessage: "Could not reach the server. Check that it is running and try again.",
  unauthorizedMessage: "Your admin session is no longer authorized. Please sign in again.",
  failureMessage: (status) => `The question request failed (HTTP ${status}).`,
});

export async function getAdminQuestionList() {
  const payload = await adminRequest("/api/admin/questions");
  if (!Array.isArray(payload.questions)) {
    throw new Error("The question list response is missing a valid questions array.");
  }
  return payload.questions;
}

export async function getAdminQuestions() {
  const questions = await getAdminQuestionList();
  return Promise.all(questions.map(async (question) => {
    const detail = await adminRequest(`/api/admin/questions/${encodeURIComponent(question.id)}`);
    return { ...question, isAssigned: detail.isAssigned === true };
  }));
}

export function createAdminQuestion(question) {
  return adminRequest("/api/admin/questions", {
    method: "POST",
    body: question,
  });
}

export function updateAdminQuestion(id, question) {
  return adminRequest(`/api/admin/questions/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: question,
  });
}

export function setAdminQuestionActive(id, isActive) {
  const action = isActive ? "reactivate" : "deactivate";
  return adminRequest(`/api/admin/questions/${encodeURIComponent(id)}/${action}`, {
    method: "PATCH",
  });
}

export function deleteAdminQuestion(id) {
  return adminRequest(`/api/admin/questions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
