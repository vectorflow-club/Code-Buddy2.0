import { useState } from "react";

// Shared loader for the participant detail history tables (rounds and
// transactions): one page of history at a time, with its own loading and
// error state. `load` resets page/data/error before each fetch, exactly as
// the two loaders it replaces did.
export function usePagedHistory(fetcher, errorMessage, limit = 5) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

  const load = async (identifier, nextPage = 1) => {
    setPage(nextPage);
    setData(null);
    setLoading(true);
    setError("");
    try {
      const result = await fetcher(identifier, { page: nextPage, limit });
      setData(result);
    } catch (historyError) {
      setError(historyError.message || errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return { data, loading, error, page, load };
}
