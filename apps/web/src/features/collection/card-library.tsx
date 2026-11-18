"use client";
import Link from "next/link";
import { useState } from "react";
import { privateCardLibrarySchema } from "@pokepulse/contracts";
import { Skeleton, StateCard } from "@pokepulse/ui";
import { useSession } from "../../auth/use-session";
import { SignIn } from "../consumer/account";
import { useResource } from "../consumer/workspace";
import { cardRequest } from "../cards/api";
import { CardTile } from "../cards/card-explorer";
export function PrivateCardLibrary({
  kind,
}: {
  kind: "virtual" | "favorite" | "wishlist";
}) {
  const session = useSession();
  return (
    <>
      <p className="pp-eyebrow">YOUR COLLECTION</p>
      <h1>
        {kind === "virtual" ? "Your virtual cards." : "Your saved cards."}
      </h1>
      {session.loading ? (
        <Skeleton label="Checking session" />
      ) : session.user ? (
        <Library key={session.user.id} kind={kind} />
      ) : (
        <SignIn />
      )}
    </>
  );
}
function Library({
  kind: initial,
}: {
  kind: "virtual" | "favorite" | "wishlist";
}) {
  const [kind, setKind] = useState(initial),
    [cursor, setCursor] = useState("");
  const query = new URLSearchParams({
    kind,
    limit: "24",
    ...(cursor ? { cursor } : {}),
  }).toString();
  const resource = useResource(
    (signal) =>
      cardRequest(`me/card-library?${query}`, privateCardLibrarySchema, {
        signal,
      }),
    query,
  );
  const data = resource.data?.data;
  return (
    <>
      {initial === "virtual" ? (
        <p>
          Saved Pack Lab cards. These are virtual results and do not count
          toward physical ownership or valuation.
        </p>
      ) : (
        <div className="pp-row">
          <label>
            Saved cards{" "}
            <select
              className="pp-input"
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as typeof kind);
                setCursor("");
              }}
            >
              <option value="favorite">Favorites</option>
              <option value="wishlist">Wishlist</option>
            </select>
          </label>
          <Link href="/watchlist">Product watches →</Link>
        </div>
      )}
      {resource.loading ? (
        <Skeleton label="Loading saved cards" />
      ) : resource.error ? (
        <StateCard error title="Cards unavailable" retry={resource.retry}>
          {resource.error}
        </StateCard>
      ) : !data?.entries.length ? (
        <StateCard
          title={
            initial === "virtual"
              ? "No virtual cards yet"
              : "No saved cards yet"
          }
        >
          <Link href={initial === "virtual" ? "/lab" : "/cards"}>
            {initial === "virtual" ? "Open a free pack →" : "Browse cards →"}
          </Link>
        </StateCard>
      ) : (
        <div className="pp-pokedex-grid">
          {data.entries.map((entry) => (
            <div key={entry.id}>
              {initial === "virtual" && (
                <p>
                  {entry.quantity} virtual{" "}
                  {entry.quantity === 1 ? "copy" : "copies"}
                </p>
              )}
              {entry.card ? (
                <CardTile card={entry.card} />
              ) : (
                <StateCard title="Card metadata unavailable">
                  Your saved entry is retained.
                </StateCard>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="pp-row">
        {cursor && (
          <button className="pp-button" onClick={() => setCursor("")}>
            First page
          </button>
        )}
        {data?.next_cursor && (
          <button
            className="pp-button"
            onClick={() => setCursor(data.next_cursor!)}
          >
            Next page →
          </button>
        )}
      </div>
    </>
  );
}
