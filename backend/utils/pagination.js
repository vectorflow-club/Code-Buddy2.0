const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Parse and strictly validate page and limit query parameters.
 */
const parsePaginationQuery = (query = {}) => {
  let page = DEFAULT_PAGE;
  let limit = DEFAULT_LIMIT;

  if (query.page !== undefined) {
    const rawPage = String(query.page).trim();
    if (!/^\d+$/.test(rawPage)) {
      return {
        error: {
          status: 400,
          code: 'INVALID_PAGINATION',
          message: "Page must be a whole number above 0.",
        },
      };
    }
    page = Number(rawPage);
    if (!Number.isSafeInteger(page) || page < 1) {
      return {
        error: {
          status: 400,
          code: 'INVALID_PAGINATION',
          message: "Page must be 1 or more.",
        },
      };
    }
  }

  if (query.limit !== undefined) {
    const rawLimit = String(query.limit).trim();
    if (!/^\d+$/.test(rawLimit)) {
      return {
        error: {
          status: 400,
          code: 'INVALID_PAGINATION',
          message: "How many per page must be a whole number above 0.",
        },
      };
    }
    limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return {
        error: {
          status: 400,
          code: 'INVALID_PAGINATION',
          message: `How many per page must be between 1 and ${MAX_LIMIT}.`,
        },
      };
    }
  }

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
};

/**
 * Build standard pagination metadata for read-only list responses.
 */
const buildPaginationMeta = (page, limit, totalItems) => {
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);
  return {
    page,
    limit,
    totalItems,
    totalPages,
    hasNextPage: totalPages > 0 && page < totalPages,
    hasPrevPage: totalPages > 0 && page > 1,
  };
};

module.exports = {
  parsePaginationQuery,
  buildPaginationMeta,
};
