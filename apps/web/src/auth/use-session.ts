"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { successSchema } from "@pokepulse/contracts";
export function useSession() {
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    try {
      const response = await fetch("/api/v1/me/session", {
        cache: "no-store",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15000),
        ]),
      });
      if (controller.signal.aborted) return;
      if (response.status === 401) {
        setUser(null);
        setError(null);
      } else if (response.ok) {
        const body = successSchema(z.object({ id: z.uuid() })).parse(
          await response.json(),
        );
        if (controller.signal.aborted) return;
        setUser(body.data);
        setError(null);
      } else {
        setUser(null);
        setError("Session unavailable");
      }
    } catch {
      if (controller.signal.aborted) return;
      setUser(null);
      setError("Session unavailable");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      void refresh();
    }, 0);
    const verify = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", verify);
    window.addEventListener("pokepulse-auth-change", verify);
    document.addEventListener("visibilitychange", verify);
    const request = current;
    return () => {
      clearTimeout(timer);
      request.current?.abort();
      window.removeEventListener("focus", verify);
      window.removeEventListener("pokepulse-auth-change", verify);
      document.removeEventListener("visibilitychange", verify);
    };
  }, [refresh]);
  return { user, loading, error, refresh };
}
export async function authAction(
  action: "sign-in" | "sign-up" | "recover" | "update-password" | "sign-out",
  body: { email?: string; password?: string },
) {
  const response = await fetch(`/auth/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  if (response.ok) window.dispatchEvent(new Event("pokepulse-auth-change"));
  return response;
}
