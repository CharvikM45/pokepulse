"use client";
import { useMemo, useRef, useState } from "react";
import { z } from "zod";
import { ApiError } from "@pokepulse/contracts";
import { Skeleton, StateCard } from "@pokepulse/ui";
import { useSession } from "../../auth/use-session";
import * as c from "../../collector-contracts";
import { PackLab, type LabService, type SavedOpening } from "../lab/pack-lab";
import { Binder } from "../binder/binder";
import { SignIn } from "./account";
import { timestamp } from "./discovery";
import { useResource } from "./workspace";

async function allSets(signal?: AbortSignal) {
  const sets: z.infer<typeof c.setSchema>[] = [];
  let cursor: string | null | undefined;
  let enabled = true;
  do {
    const page = await c.collectorRequest(
      `sets?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      c.setsSchema,
      { signal },
    );
    sets.push(...page.data.sets);
    enabled = enabled && page.data.enabled;
    cursor = page.meta.next_cursor;
  } while (cursor);
  return { sets, enabled };
}
async function allCards(setId: string, signal?: AbortSignal) {
  let result: z.infer<typeof c.cardsSchema> | undefined;
  let cursor: string | null | undefined;
  do {
    const query = new URLSearchParams({
      limit: "50",
      ...(cursor ? { cursor } : {}),
      ...(result?.manifest
        ? { manifest_version: result.manifest.version }
        : {}),
    });
    const page = await c.collectorRequest(
      `sets/${setId}/cards?${query}`,
      c.cardsSchema,
      { signal },
    );
    result = result
      ? { ...result, variants: [...result.variants, ...page.data.variants] }
      : page.data;
    cursor = page.meta.next_cursor;
  } while (cursor);
  return result!;
}

function savedView(data: z.infer<typeof c.openingSchema>): SavedOpening {
  return {
    openingId: data.id,
    setId: data.set_id,
    setName: data.set_name,
    openedAtLabel: timestamp(data.opened_at),
    oddsVersion: data.odds_version,
    spentCoins: data.spent_coins,
    usedFreeOpen: data.used_free_open,
    cards: data.cards.map((card) => ({
      ...card,
      name: card.card_name,
      number: card.card_number,
    })),
  };
}

export function LabPage() {
  const session = useSession();
  const catalog = useResource(allSets, "sets");
  const [signIn, setSignIn] = useState(false);
  const service = useMemo<LabService>(
    () => ({
      state: async (signal) =>
        (await c.collectorRequest("me/lab", c.labSchema, { signal })).data,
      history: async (cursor, signal) =>
        (
          await c.collectorRequest(
            `me/pack-openings?cursor=${encodeURIComponent(cursor)}`,
            c.historySchema,
            { signal },
          )
        ).data,
      opening: async (id, signal) =>
        savedView(
          (
            await c.collectorRequest(
              `me/pack-openings/${id}`,
              c.openingSchema,
              { signal },
            )
          ).data,
        ),
      open: async (body, key, signal) => {
        try {
          return {
            status: "committed",
            opening: savedView(
              (
                await c.collectorRequest("packs/open", c.openingSchema, {
                  method: "POST",
                  body,
                  key,
                  signal,
                })
              ).data,
            ),
          };
        } catch (error) {
          // Only validated, explicit database/request denials establish a no-write outcome.
          if (
            error instanceof ApiError &&
            [400, 401, 403, 409, 429].includes(error.status)
          )
            return { status: "rejected", message: error.message };
          throw error;
        }
      },
    }),
    [],
  );
  return (
    <>
      <p className="pp-eyebrow">COLLECT · FREE SIMULATION</p>
      {catalog.loading || session.loading ? (
        <Skeleton label="Loading Pack Lab" />
      ) : catalog.error || !catalog.data ? (
        <StateCard error title="Pack Lab unavailable" retry={catalog.retry}>
          {catalog.error}
        </StateCard>
      ) : (
        <PackLab
          enabled={catalog.data.enabled}
          sets={catalog.data.sets}
          userScope={session.user?.id ?? null}
          service={service}
          onSignIn={() => setSignIn(true)}
        />
      )}
      {signIn && !session.user && <SignIn />}
      <a href="/collection">Open your binder →</a>
    </>
  );
}

export function CollectionPage({ setId }: { setId?: string }) {
  const sets = useResource(allSets, "sets");
  const [selected, setSelected] = useState(setId ?? "");
  const active = setId ?? (selected || sets.data?.sets[0]?.id);
  return (
    <>
      <p className="pp-eyebrow">COLLECT</p>
      <h1>Your binder</h1>
      <p>
        Virtual simulation results and manually recorded physical ownership stay
        separate. Collections are private.
      </p>
      {sets.loading && <Skeleton label="Loading sets" />}
      {sets.error && (
        <StateCard error title="Sets unavailable" retry={sets.retry}>
          {sets.error}
        </StateCard>
      )}
      {!setId && sets.data && (
        <label>
          Set
          <select
            className="pp-input"
            value={active ?? ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            {sets.data.sets.map((set) => (
              <option key={set.id} value={set.id}>
                {set.name}
                {set.is_demo ? " · fictional demo" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {active ? (
        <SetBinder key={active} setId={active} />
      ) : (
        !sets.loading && <p>No cleared set metadata available.</p>
      )}
    </>
  );
}
function SetBinder({ setId }: { setId: string }) {
  const session = useSession();
  const catalog = useResource((signal) => allCards(setId, signal), setId);
  if (session.loading || catalog.loading)
    return <Skeleton label="Loading binder" />;
  if (catalog.error || !catalog.data)
    return (
      <StateCard error title="Binder unavailable" retry={catalog.retry}>
        {catalog.error}
      </StateCard>
    );
  if (!catalog.data.manifest)
    return (
      <StateCard title="Manifest incomplete">
        This set has no validated published manifest. Completion totals are
        unavailable.
      </StateCard>
    );
  return (
    <>
      <p className="pp-banner">
        Source: {catalog.data.metadata_source} · Manifest{" "}
        {catalog.data.manifest.version} ·{" "}
        {catalog.data.is_demo
          ? "original fictional demo"
          : "published collection scope"}
        . No sharing is enabled.
      </p>
      {session.user ? (
        <PrivateBinder
          key={session.user.id}
          setId={setId}
          catalog={catalog.data}
          userId={session.user.id}
        />
      ) : (
        <>
          <Binder
            manifest={catalog.data.manifest}
            variants={catalog.data.variants}
            mode="virtual"
            entriesMode="virtual"
            entriesComplete={true}
            entries={[]}
            demo
            onModeChange={() => {}}
          />
          <p>
            Anonymous demo sample. These empty slots do not represent your
            possessions.
          </p>
          <SignIn />
        </>
      )}
    </>
  );
}
function PrivateBinder({
  setId,
  catalog,
  userId,
}: {
  setId: string;
  catalog: z.infer<typeof c.cardsSchema>;
  userId: string;
}) {
  const [mode, setMode] = useState<"real" | "virtual">("virtual");
  const inventory = useResource(
    async () =>
      (
        await c.collectorRequest(
          `me/collections?${new URLSearchParams({ set_id: setId, mode, manifest_version: catalog.manifest!.version })}`,
          c.inventorySchema,
        )
      ).data,
    `${userId}:${setId}:${mode}:${catalog.manifest?.version}`,
  );
  const pending = useRef<{ body: string; key: string } | null>(null);
  if (!catalog.manifest) return null;
  return (
    <Binder
      manifest={catalog.manifest}
      variants={catalog.variants}
      mode={mode}
      entriesMode={inventory.data?.mode ?? mode}
      entriesComplete={
        !!inventory.data && !inventory.loading && !inventory.error
      }
      entries={inventory.data?.entries ?? []}
      realNotes={inventory.data?.realNotes}
      loading={inventory.loading}
      loadError={inventory.error}
      onRetryInventory={inventory.retry}
      onModeChange={setMode}
      onSaveReal={async (edit) => {
        const body = JSON.stringify(edit);
        if (pending.current?.body !== body)
          pending.current = { body, key: crypto.randomUUID() };
        await c.collectorRequest(
          "me/collections/real",
          z.object({ id: c.uuid }),
          { method: "PATCH", body: edit, key: pending.current.key },
        );
        pending.current = null;
        inventory.retry();
      }}
      onMissingExport={async (request) => {
        const response = await fetch(
          `/api/v1/me/collections/missing-export?${new URLSearchParams(request)}`,
          { credentials: "same-origin", cache: "no-store" },
        );
        if (!response.ok)
          throw new Error(
            "Export unavailable. Refresh inventory and try again.",
          );
        const blob = await response.blob(),
          href = URL.createObjectURL(blob),
          link = document.createElement("a");
        link.href = href;
        link.download = `pokepulse-${mode}-missing.csv`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
      }}
    />
  );
}
