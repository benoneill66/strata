import { useCallback, useEffect, useRef, useState } from "react";

interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** True only on the very first load — lets views show skeletons once, then
      refresh silently in the background. */
  initial: boolean;
  reload: () => void;
}

/** Run an async loader on mount and whenever `deps` change, with optional polling. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = [], pollSecs = 0): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [initial, setInitial] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const d = await loaderRef.current();
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setInitial(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
    if (pollSecs > 0) {
      const id = window.setInterval(run, pollSecs * 1000);
      return () => window.clearInterval(id);
    }
  }, [run, pollSecs]);

  return { data, error, loading, initial, reload: run };
}
