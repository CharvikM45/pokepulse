"use client";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppShell } from "@pokepulse/ui";

export function Workspace({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [theme, setTheme] = useState("system");
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const value = localStorage.getItem("pokepulse-theme") ?? "system";
        setTheme(value);
        document.documentElement.dataset.theme = value;
      } catch {
        /* Storage is optional. */
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  return (
    <AppShell pathname={pathname}>
      <header className="pp-topbar">
        <Link href="/">◈ PokéPulse</Link>
        <div>
          <label>
            Appearance{" "}
            <select
              value={theme}
              onChange={(event) => {
                const value = event.target.value;
                setTheme(value);
                document.documentElement.dataset.theme = value;
                try {
                  localStorage.setItem("pokepulse-theme", value);
                } catch {
                  /* Optional preference. */
                }
              }}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <a href="/dashboard">Your workspace</a>
        </div>
      </header>
      {children}
      <footer className="pp-muted">
        Check source, seller, region and observation time before visiting or
        buying. Community reports and simulations carry separate labels.
      </footer>
    </AppShell>
  );
}

export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  identity: string,
) {
  const runLoad = useEffectEvent(load);
  const [state, setState] = useState<{
    identity: string;
    data?: T;
    error?: string;
    loading: boolean;
  }>({ identity, loading: true });
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState((previous) => ({
        identity,
        loading: true,
        ...(previous.identity === identity ? { data: previous.data } : {}),
      }));
      void runLoad(controller.signal).then(
        (data) => {
          if (active) setState({ identity, data, loading: false });
        },
        (error) => {
          if (active)
            setState({
              identity,
              error:
                error instanceof Error ? error.message : "Request unavailable.",
              loading: false,
            });
        },
      );
    }, 0);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [identity, revision]);
  return {
    ...(state.identity === identity
      ? state
      : { loading: true, data: undefined, error: undefined }),
    retry,
  };
}

/** Ask A to project current truth again; the browser never derives stock status. */
export function useSourceRefresh(
  observations: readonly { stale_after: string | null }[] | undefined,
  retry: () => void,
) {
  useEffect(() => {
    if (!observations) return;
    const now = Date.now(),
      future = observations
        .map((value) =>
          value.stale_after ? Date.parse(value.stale_after) : Infinity,
        )
        .filter((value) => value > now);
    const delay = Math.max(50, Math.min(60000, Math.min(...future) - now + 1));
    const timer = setTimeout(() => {
      if (document.visibilityState === "visible") retry();
    }, delay);
    const check = () => {
      if (document.visibilityState === "visible") retry();
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [observations, retry]);
}
