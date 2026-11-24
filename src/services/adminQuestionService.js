import { createAdminRequest } from "./adminRequest";

const adminRequest = createAdminRequest({
  makeError: (message) => new Error(message),
  sessionMessage: "Your admin sign-in is missing. Please sign in again.",
  configMessage:
    "The admin side is not set up. Please check the site settings and try again.",
  networkMessage: "Could not reach the site. Check your connection and try again.",
  unauthorizedMessage: "Your admin sign-in ran out. Please sign in again.",
  failureMessage: (status) => `The question change did not work (error ${status}).`,
});

export async function getAdminQuestionList() {
  const payload = await adminRequest("/api/admin/questions");
  if (!Array.isArray(payload.questions)) {
    throw new Error("The questions reply came back incomplete.");
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
