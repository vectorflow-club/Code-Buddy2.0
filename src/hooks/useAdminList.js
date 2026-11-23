import { useEffect, useRef, useState } from "react";

// Shared list-fetching hook for the admin Rounds and Transactions pages:
// draft/applied filters, request dedup by filter key, race guard,
// pagination, retry and refresh. The pages keep their own filter controls
// and tables; only the fetching machinery is identical.
export function useAdminList({ fetcher, emptyFilters, resultKey, pageLimit = 20 }) {
  const [draftFilters, setDraftFilters] = useState(emptyFilters);
  const [filters, setFilters] = useState({ ...emptyFilters, page: 1, limit: pageLimit });
  const [retryCount, setRetryCount] = useState(0);
  const [refreshCount, setRefreshCount] = useState(0);
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestSequence = useRef(0);
  const activeRequests = useRef(new Map());

  useEffect(() => {
    const requestKey = JSON.stringify(filters);
    const requestId = ++requestSequence.current;
    let request = activeRequests.current.get(requestKey);
    if (!request) {
      request = fetcher(filters);
      activeRequests.current.set(requestKey, request);
      request.then(
        () => { if (activeRequests.current.get(requestKey) === request) activeRequests.current.delete(requestKey); },
        () => { if (activeRequests.current.get(requestKey) === request) activeRequests.current.delete(requestKey); },
      );
    }

    setLoading(true);
    setError(null);
    setItems([]);
    setPagination(null);
    request.then((result) => {
      if (requestSequence.current !== requestId) return;
      setItems(result[resultKey]);
      setPagination(result.pagination);
    }).catch((requestError) => {
      if (requestSequence.current === requestId) setError(requestError);
    }).finally(() => {
      if (requestSequence.current === requestId) setLoading(false);
    });

    return () => {
      if (requestSequence.current === requestId) requestSequence.current += 1;
    };
  }, [filters, retryCount, refreshCount, fetcher, resultKey]);

  const handleFilterChange = (event) => {
    const { name, value } = event.target;
    setDraftFilters((current) => ({ ...current, [name]: value }));
  };

  const applyFilters = (event) => {
    event.preventDefault();
    setFilters({
      ...draftFilters,
      levelNumber: draftFilters.levelNumber ? Number(draftFilters.levelNumber) : "",
      usn: draftFilters.usn.trim(),
      search: draftFilters.search.trim(),
      page: 1,
      limit: filters.limit,
    });
  };

  const clearFilters = () => {
    setDraftFilters({ ...emptyFilters });
    setFilters({ ...emptyFilters, page: 1, limit: filters.limit });
  };

  const changePage = (nextPage) => {
    if (loading || !pagination || nextPage < 1) return;
    setFilters((current) => ({ ...current, page: nextPage }));
  };

  const changeLimit = (event) => {
    const limit = Number(event.target.value);
    setFilters((current) => ({ ...current, limit, page: 1 }));
  };

  const retry = () => {
    if (!loading) setRetryCount((count) => count + 1);
  };

  const refresh = () => {
    setRefreshCount((count) => count + 1);
  };

  return {
    items,
    setItems,
    pagination,
    loading,
    error,
    draftFilters,
    filters,
    handleFilterChange,
    applyFilters,
    clearFilters,
    changePage,
    changeLimit,
    retry,
    refresh,
  };
}
