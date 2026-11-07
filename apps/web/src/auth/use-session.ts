"use client";
import { useCallback, useEffect, useState } from "react";
export function useSession() {
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/me/session", { cache: "no-store" });
      if (response.status === 401) {
        setUser(null);
        setError(null);
      } else if (response.ok) {
        const body = await response.json();
        setUser(body.data);
        setError(null);
      } else {
        setUser(null);
        setError("Session unavailable");
      }
    } catch {
      setUser(null);
      setError("Session unavailable");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      void refresh();
    }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);
  return { user, loading, error, refresh };
}
export async function authAction(
  action: "sign-in" | "sign-up" | "recover" | "update-password" | "sign-out",
  body: { email?: string; password?: string },
) {
  return fetch(`/auth/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}
