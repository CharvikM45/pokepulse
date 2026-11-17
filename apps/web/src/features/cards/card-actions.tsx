"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { useCardUser } from "./card-user";
import { useResource } from "../consumer/workspace";
import { cardRequest, receipt } from "./api";
export function CardActions({ id }: { id: string }) {
  const user = useCardUser();
  return (
    <ActionButtons key={`${user ?? "anonymous"}:${id}`} id={id} user={user} />
  );
}
const actions = z.array(
  z.object({ card_id: z.uuid(), kind: z.enum(["favorite", "wishlist"]) }),
);
function ActionButtons({ id, user }: { id: string; user: string | null }) {
  const current = useResource(
    async (signal) =>
      user
        ? (
            await cardRequest(`me/card-actions?card_id=${id}`, actions, {
              signal,
            })
          ).data
        : [],
    `${user}:${id}`,
  );
  const [saved, setSaved] = useState<
      Partial<Record<"favorite" | "wishlist", boolean>>
    >({}),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false),
    pending = useRef<{ kind: string; active: boolean; key: string } | null>(
      null,
    );
  const isSaved = (kind: "favorite" | "wishlist") =>
    saved[kind] ?? current.data?.some((a) => a.kind === kind) ?? false;
  async function save(kind: "favorite" | "wishlist") {
    if (lock.current) return;
    if (!user) {
      setMessage("Sign in to save cards.");
      return;
    }
    lock.current = true;
    setBusy(true);
    const active = !isSaved(kind);
    if (pending.current?.kind !== kind || pending.current?.active !== active)
      pending.current = { kind, active, key: crypto.randomUUID() };
    try {
      await cardRequest(`me/card-actions/${kind}`, receipt, {
        method: "POST",
        body: { card_id: id, active },
        key: pending.current.key,
      });
      setSaved((v) => ({ ...v, [kind]: active }));
      pending.current = null;
      setMessage(
        active
          ? "Saved to your " +
              (kind === "favorite" ? "favorites" : "wishlist") +
              "."
          : "Removed.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="pp-card-actions">
      <button
        className="pp-button"
        data-variant="secondary"
        disabled={busy || Boolean(user && current.loading)}
        aria-pressed={isSaved("favorite")}
        onClick={() => void save("favorite")}
      >
        {isSaved("favorite") ? "Favorited ♥" : "Save favorite ♡"}
      </button>
      <button
        className="pp-button"
        data-variant="secondary"
        disabled={busy || Boolean(user && current.loading)}
        aria-pressed={isSaved("wishlist")}
        onClick={() => void save("wishlist")}
      >
        {isSaved("wishlist") ? "On wishlist" : "Save to wishlist"}
      </button>
      <span role="status">{message}</span>
      {/sign in/i.test(message) && <Link href="/dashboard">Sign in</Link>}
    </div>
  );
}
