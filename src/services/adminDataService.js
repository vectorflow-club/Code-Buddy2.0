import { createAdminRequest } from "./adminRequest";

export class AdminDataApiError extends Error {
  constructor(message, { status = null, code = null, kind = "api" } = {}) {
    super(message);
    this.name = "AdminDataApiError";
    this.status = status;
    this.code = code;
    this.kind = kind;
  }
}

const adminRequest = createAdminRequest({
  makeError: (message, meta) => new AdminDataApiError(message, meta),
  sessionMessage: "Your admin sign-in is missing. Please sign in again.",
  configMessage:
    "The admin side is not set up. Please check the site settings and try again.",
  networkMessage: "Could not reach the site. Check your connection and try again.",
  unauthorizedMessage: "Your admin sign-in ran out. Please sign in again.",
  failureMessage: (status) => `The admin side had a problem (error ${status}).`,
});

export async function getAdminDashboardStats() {
  const payload = await adminRequest("/api/admin/dashboard");
  if (!payload.dashboard || typeof payload.dashboard !== "object") {
    throw new Error("The admin reply did not include the numbers.");
  }
  return payload.dashboard;
}

async function getPaginatedCollection(path, collectionName) {
  const results = [];
  let page = 1;
  let totalPages = 1;
  do {
    const separator = path.includes("?") ? "&" : "?";
    const payload = await adminRequest(`${path}${separator}page=${page}&limit=100`);
    if (!Array.isArray(payload[collectionName])) {
      throw new Error(`The admin reply came back incomplete.`);
    }
    results.push(...payload[collectionName]);
    totalPages = Number(payload.pagination?.totalPages) || 1;
    page += 1;
  } while (page <= totalPages);
  return results;
}

export function getAdminParticipants({ search = "" } = {}) {
  const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
  return getPaginatedCollection(`/api/admin/participants${query}`, "participants");
}

export async function getAdminParticipantDetails(identifier) {
  const payload = await adminRequest(`/api/admin/participants/${encodeURIComponent(identifier)}`);
  if (!payload.participant || typeof payload.participant !== "object") {
    throw new Error("The student details reply came back incomplete.");
  }
  return payload;
}

export async function reopenAdminParticipant(identifier) {
  const payload = await adminRequest(
    `/api/admin/participants/${encodeURIComponent(identifier)}/reopen`,
    { method: "POST" },
  );
  if (!payload.participant || typeof payload.participant !== "object") {
    throw new Error("The re-open reply came back incomplete.");
  }
  return payload;
}

export async function adjustAdminParticipantWallet(identifier, { amount, reason }) {
  const payload = await adminRequest(
    `/api/admin/participants/${encodeURIComponent(identifier)}/wallet-adjustments`,
    { method: "POST", body: { amount, reason } },
  );
  if (!payload.transaction || typeof payload.transaction !== "object") {
    throw new Error("The money change reply came back incomplete.");
  }
  if (typeof payload.walletBalance !== "number") {
    throw new Error("The money change reply did not include the new amount.");
  }
  return payload;
}

function buildQueryString(parameters) {
  const query = new URLSearchParams();
  Object.entries(parameters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  });
  return query.toString();
}

function validateParticipantHistoryResponse(payload, collectionName) {
  if (
    !payload.participant ||
    typeof payload.participant !== "object" ||
    Array.isArray(payload.participant)
  ) {
    throw new Error("The student history reply came back incomplete.");
  }
  if (!Array.isArray(payload[collectionName])) {
    throw new Error(`The student history reply came back incomplete.`);
  }
  if (
    !payload.pagination ||
    typeof payload.pagination !== "object" ||
    Array.isArray(payload.pagination)
  ) {
    throw new Error("The student history reply came back incomplete.");
  }
  return payload;
}

export async function getAdminParticipantRounds(
  identifier,
  { page = 1, limit = 20, levelNumber, status } = {},
) {
  const query = buildQueryString({ page, limit, levelNumber, status });
  const payload = await adminRequest(
    `/api/admin/participants/${encodeURIComponent(identifier)}/rounds?${query}`,
  );
  return validateParticipantHistoryResponse(payload, "rounds");
}

export async function getAdminParticipantTransactions(
  identifier,
  { page = 1, limit = 20, type, levelNumber } = {},
) {
  const query = buildQueryString({ page, limit, type, levelNumber });
  const payload = await adminRequest(
    `/api/admin/participants/${encodeURIComponent(identifier)}/transactions?${query}`,
  );
  return validateParticipantHistoryResponse(payload, "transactions");
}

export async function getAdminRounds({
  page = 1,
  limit = 20,
  levelNumber,
  status,
  evaluationStatus,
  usn,
  search,
} = {}) {
  const query = buildQueryString({ page, limit, levelNumber, status, evaluationStatus, usn, search });
  const payload = await adminRequest(`/api/admin/rounds?${query}`);
  const pagination = payload.pagination;
  const validPagination = pagination &&
    typeof pagination === "object" &&
    !Array.isArray(pagination) &&
    Number.isInteger(pagination.page) &&
    pagination.page >= 1 &&
    Number.isInteger(pagination.limit) &&
    pagination.limit >= 1 &&
    pagination.limit <= 100 &&
    Number.isInteger(pagination.totalItems) &&
    pagination.totalItems >= 0 &&
    Number.isInteger(pagination.totalPages) &&
    pagination.totalPages >= 0 &&
    typeof pagination.hasNextPage === "boolean" &&
    typeof pagination.hasPrevPage === "boolean";

  if (!Array.isArray(payload.rounds) || !validPagination) {
    throw new AdminDataApiError("The rounds reply came back incomplete.", {
      status: null,
      code: null,
      kind: "response",
    });
  }
  return payload;
}

export async function recoverAdminRound(roundId) {
  const payload = await adminRequest(
    `/api/admin/rounds/${encodeURIComponent(roundId)}/recover`,
    { method: "POST" },
  );
  const round = payload.round;
  if (
    !round ||
    typeof round !== "object" ||
    Array.isArray(round) ||
    typeof round.id !== "string" ||
    round.id.length === 0 ||
    round.status !== "ready"
  ) {
    throw new AdminDataApiError("The round recovery reply came back incomplete.", {
      kind: "response",
    });
  }
  return payload;
}

export async function getAdminTransactions({
  page = 1,
  limit = 20,
  type,
  levelNumber,
  usn,
  search,
} = {}) {
  const query = buildQueryString({ page, limit, type, levelNumber, usn, search });
  const payload = await adminRequest(`/api/admin/transactions?${query}`);
  const pagination = payload.pagination;
  const validPagination = pagination &&
    typeof pagination === "object" &&
    !Array.isArray(pagination) &&
    Number.isInteger(pagination.page) &&
    pagination.page >= 1 &&
    Number.isInteger(pagination.limit) &&
    pagination.limit >= 1 &&
    pagination.limit <= 100 &&
    Number.isInteger(pagination.totalItems) &&
    pagination.totalItems >= 0 &&
    Number.isInteger(pagination.totalPages) &&
    pagination.totalPages >= 0 &&
    typeof pagination.hasNextPage === "boolean" &&
    typeof pagination.hasPrevPage === "boolean";

  if (
    typeof payload.message !== "string" ||
    !Number.isInteger(payload.count) ||
    payload.count < 0 ||
    !Array.isArray(payload.transactions) ||
    !validPagination
  ) {
    throw new AdminDataApiError(
      "The money moves reply came back incomplete.",
      { kind: "response" },
    );
  }
  return payload;
}
