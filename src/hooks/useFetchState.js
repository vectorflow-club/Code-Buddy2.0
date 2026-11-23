import { useCallback, useEffect, useState } from "react";

// Shared fetch-state hook for admin pages that load once on mount and
// reload from a Retry button or after a save: loading + error + data +
// a reload the page reuses. The fetcher returns the final data (it does
// its own response shaping); the hook owns the state around it. `setError`
// is exposed because several pages share the same error state between
// their load and their save/update handlers.
export function useFetchState(fetcher, { initialData = null, errorMessage = "Could not load data." } = {}) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await fetcher());
    } catch (loadError) {
      setError(loadError.message || errorMessage);
    } finally {
      setLoading(false);
    }
  }, [fetcher, errorMessage]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, setError, reload };
}
