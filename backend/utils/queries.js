/**
 * Escape regex metacharacters to safely match search terms without ReDoS risk.
 */
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Execute a Mongoose query safely while tolerating lightweight unit-test query mocks.
 */
const runReadQuery = async (
  query,
  { select = null, sort = null, skip = null, limit = null, lean = true } = {}
) => {
  if (!query) {
    return query;
  }

  let current = query;
  if (select && typeof current.select === 'function') {
    current = current.select(select);
  }
  if (sort && typeof current.sort === 'function') {
    current = current.sort(sort);
  }
  if (skip !== null && skip !== undefined && typeof current.skip === 'function') {
    current = current.skip(skip);
  }
  if (limit !== null && limit !== undefined && typeof current.limit === 'function') {
    current = current.limit(limit);
  }
  if (lean && typeof current.lean === 'function') {
    current = current.lean();
  }

  return await current;
};

module.exports = {
  escapeRegex,
  runReadQuery,
};
