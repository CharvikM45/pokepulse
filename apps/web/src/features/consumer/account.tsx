"use client";
import { useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ruleInputSchema,
  watchSchema,
  ruleSchema,
  notificationSchema,
  privacyJobSchema,
  type AlertRuleDTO,
} from "@pokepulse/contracts";
import { collectorRequest } from "../../collector-contracts";
import { Skeleton, StateCard, useNow } from "@pokepulse/ui";
import { authAction, useSession } from "../../auth/use-session";
import { subscribePush } from "../../auth/push";
import {
  client,
  timestamp,
  safeLink,
  allProducts,
  allOffers,
  Offer,
} from "./discovery";
import { useResource, useSourceRefresh } from "./workspace";

async function accountPages<T extends z.ZodType>(
  path: string,
  schema: T,
  signal?: AbortSignal,
) {
  const data: z.infer<T>[] = [];
  let cursor: string | null | undefined;
  do {
    const page = await collectorRequest(
      `${path}?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      z.array(schema),
      { signal },
    );
    data.push(...page.data);
    cursor = page.meta.next_cursor;
  } while (cursor);
  return { data, meta: { next_cursor: null } };
}

export function SignIn() {
  const router = useRouter();
  const [mode, setMode] = useState<
    "sign-in" | "sign-up" | "recover" | "update-password"
  >("sign-in");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      const response = await authAction(mode, {
        ...(mode !== "update-password"
          ? { email: String(form.get("email")) }
          : {}),
        ...(mode !== "recover"
          ? { password: String(form.get("password")) }
          : {}),
      });
      if (!response.ok)
        throw new Error(
          "Authentication could not be completed. Check your details or try again later.",
        );
      if (mode === "sign-in") router.push("/dashboard");
      else
        setMessage(
          mode === "update-password"
            ? "Password updated."
            : "Check your email for the next step if your address is eligible.",
        );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Authentication unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="pp-card">
      <h2>Sign in to your workspace</h2>
      <p>Public browsing is available without an account.</p>
      <label>
        Action
        <select
          className="pp-input"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value as typeof mode);
            setMessage("");
          }}
        >
          <option value="sign-in">Sign in</option>
          <option value="sign-up">Create account</option>
          <option value="recover">Recover password</option>
          <option value="update-password">Set recovered password</option>
        </select>
      </label>
      <form onSubmit={submit} className="pp-stack">
        {mode !== "update-password" && (
          <label>
            Email
            <input
              className="pp-input"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </label>
        )}
        {mode !== "recover" && (
          <label>
            Password (12–256 characters)
            <input
              className="pp-input"
              name="password"
              type="password"
              minLength={12}
              maxLength={256}
              autoComplete={
                mode === "sign-in" ? "current-password" : "new-password"
              }
              required
            />
          </label>
        )}
        <button className="pp-button" disabled={busy}>
          {busy ? "Working…" : "Continue"}
        </button>
      </form>
      <p role="status">{message}</p>
    </section>
  );
}

export function Account({
  page,
}: {
  page: "dashboard" | "watchlist" | "alerts" | "settings";
}) {
  const session = useSession();
  return (
    <>
      <p className="pp-eyebrow">YOUR WORKSPACE</p>
      <h1>
        {
          {
            dashboard: "Your daily pulse",
            watchlist: "Watchlist",
            alerts: "Alerts & inbox",
            settings: "Account settings",
          }[page]
        }
      </h1>
      {session.loading ? (
        <Skeleton label="Checking session" />
      ) : session.user ? (
        <PrivateAccount
          key={session.user.id}
          page={page}
          userId={session.user.id}
        />
      ) : (
        <>
          <p>
            {session.error ??
              "Sign in to save watches, manage alerts and view your private data."}
          </p>
          <SignIn />
        </>
      )}
    </>
  );
}

function PrivateAccount({ page, userId }: { page: string; userId: string }) {
  const router = useRouter();
  const resource = useResource(async (signal) => {
    const api = client(signal);
    const [watches, rules, notifications, preferences, privacy] =
      await Promise.all([
        accountPages("me/watchlist", watchSchema, signal),
        accountPages("me/alert-rules", ruleSchema, signal),
        accountPages("me/notifications", notificationSchema, signal),
        api.preferences(),
        accountPages("me/privacy-jobs", privacyJobSchema, signal),
      ]);
    return { watches, rules, notifications, preferences, privacy };
  }, userId);
  const publicCatalog = useResource(async (signal) => {
    if (!["dashboard", "watchlist"].includes(page)) return null;
    const [products, offers] = await Promise.all([
      allProducts(signal),
      allOffers(signal),
    ]);
    return { products, offers };
  }, page);
  useSourceRefresh(publicCatalog.data?.offers, publicCatalog.retry);
  const lock = useRef(false),
    pending = useRef<{ body: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [editing, setEditing] = useState<AlertRuleDTO | undefined>();
  async function write(
    identity: unknown,
    operation: (key: string) => Promise<unknown>,
  ) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    const body = JSON.stringify(identity);
    if (pending.current?.body !== body)
      pending.current = { body, key: crypto.randomUUID() };
    try {
      await operation(pending.current.key);
      pending.current = null;
      setMessage(
        identity === "export"
          ? "Export request queued."
          : identity === "delete-account"
            ? "Deletion request queued; your account remains active until processing finishes."
            : "Saved.",
      );
      resource.retry();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message + ". Retry the same action if needed."
          : "Unable to save. Retry.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (resource.loading) return <Skeleton label="Loading your workspace" />;
  if (resource.error || !resource.data)
    return (
      <StateCard error title="Workspace unavailable" retry={resource.retry}>
        {resource.error ?? "Try again."}
      </StateCard>
    );
  const { watches, rules, notifications, preferences, privacy } = resource.data;
  return (
    <>
      <p role="status">{message}</p>
      <fieldset disabled={busy} className="pp-account-fieldset">
        {page === "dashboard" && (
          <>
            <p className="pp-banner">
              Alert delivery depends on enabled sources and your preferences.
              Demo observations do not establish live inventory.
            </p>
            <div className="pp-product-grid">
              <article className="pp-card">
                <h2>{watches.data.length} saved watches on this page</h2>
                <a href="/watchlist">Manage watchlist →</a>
              </article>
              <article className="pp-card">
                <h2>
                  {notifications.data.filter((n) => !n.read_at).length} unread
                  on this page
                </h2>
                <a href="/alerts">Open inbox →</a>
              </article>
              <article className="pp-card">
                <h2>Your collection</h2>
                <a href="/collection">Open real / virtual binder →</a>
              </article>
            </div>
            <h2>Followed products and offers</h2>
            {!watches.data.length && (
              <p>
                No watches yet.{" "}
                <Link href="/products">
                  Explore products to start a watchlist
                </Link>
                .
              </p>
            )}
            <ul>
              {watches.data.slice(0, 5).map((watch) => {
                const offer = publicCatalog.data?.offers.find(
                  (offer) => offer.id === watch.listing_id,
                );
                const product = publicCatalog.data?.products.find(
                  (product) =>
                    product.id === (watch.product_id ?? offer?.product_id),
                );
                return (
                  <li key={watch.id}>
                    {product ? (
                      <a href={`/products/${product.id}`}>{product.name}</a>
                    ) : watch.product_id ? (
                      "Tracked product — details unavailable"
                    ) : (
                      "Exact offer — details unavailable"
                    )}{" "}
                    ·{" "}
                    {watch.listing_id
                      ? "exact offer"
                      : "all matching product offers"}
                  </li>
                );
              })}
            </ul>
            {publicCatalog.loading ? (
              <Skeleton label="Refreshing followed source observations" />
            ) : publicCatalog.error ? (
              <StateCard
                error
                title="Followed source details unavailable"
                retry={publicCatalog.retry}
              >
                {publicCatalog.error}
              </StateCard>
            ) : (
              publicCatalog.data && (
                <div className="pp-product-grid">
                  {publicCatalog.data.offers
                    .filter((offer) =>
                      watches.data.some(
                        (watch) =>
                          watch.product_id === offer.product_id ||
                          watch.listing_id === offer.id,
                      ),
                    )
                    .slice(0, 3)
                    .map((offer) => (
                      <Offer
                        key={offer.id}
                        offer={offer}
                        product={publicCatalog.data?.products.find(
                          (product) => product.id === offer.product_id,
                        )}
                      />
                    ))}
                </div>
              )
            )}
            <h2>Recent alert activity</h2>
            {!notifications.data.length ? (
              <p>
                No notifications yet.{" "}
                <a href="/settings">Choose notification preferences</a> when you
                are ready.
              </p>
            ) : (
              <ul>
                {[...notifications.data]
                  .sort(
                    (a, b) =>
                      Date.parse(b.created_at) - Date.parse(a.created_at),
                  )
                  .slice(0, 3)
                  .map((notification) => (
                    <li key={notification.id}>
                      <strong>{notification.title}</strong> ·{" "}
                      {timestamp(notification.created_at)}
                      <p>{notification.body}</p>
                    </li>
                  ))}
              </ul>
            )}
            <a href="/drops">Browse source observations</a>
          </>
        )}
        {page === "watchlist" && (
          <>
            <p>
              Product watches cover its matching offers. Exact-offer watches
              cover one listing.
            </p>
            {!watches.data.length && (
              <p>
                No saved watches. <Link href="/products">Explore products</Link>
                .
              </p>
            )}
            <ul className="pp-stack">
              {watches.data.map((w) => (
                <li className="pp-card" key={w.id}>
                  <strong>
                    {w.product_id ? "Product watch" : "Exact offer watch"}
                  </strong>
                  <p>
                    {w.product_id ? (
                      <a href={`/products/${w.product_id}`}>
                        {publicCatalog.data?.products.find(
                          (product) => product.id === w.product_id,
                        )?.name ?? "Open product"}
                      </a>
                    ) : (
                      (() => {
                        const offer = publicCatalog.data?.offers.find(
                          (offer) => offer.id === w.listing_id,
                        );
                        const product = publicCatalog.data?.products.find(
                          (product) => product.id === offer?.product_id,
                        );
                        return offer ? (
                          <>
                            <a href={`/products/${offer.product_id}`}>
                              {product?.name ?? "Open product"}
                            </a>{" "}
                            · {offer.retailer_name} ·{" "}
                            {offer.seller_type.replaceAll("_", " ")} ·{" "}
                            {offer.channel.replaceAll("_", " ")}
                          </>
                        ) : (
                          "Offer details unavailable."
                        );
                      })()
                    )}
                  </p>
                  <p>Saved {timestamp(w.created_at)}</p>
                  <button
                    onClick={() =>
                      void write(["unwatch", w.id], (key) =>
                        client().unwatch(w.id, key),
                      )
                    }
                  >
                    Remove watch
                  </button>
                </li>
              ))}
            </ul>
            {watches.meta.next_cursor && (
              <p>
                More watches exist. The list currently shows the first server
                page.
              </p>
            )}
          </>
        )}
        {page === "alerts" && (
          <>
            <p className="pp-banner">
              Inbox and push are opt-in in <a href="/settings">settings</a>.
              Disabled sources may prevent matching events.
            </p>
            <RuleEditor
              key={editing?.id ?? "new"}
              initial={editing}
              onCancel={() => setEditing(undefined)}
              onSave={(value) =>
                write(["rule", value], (key) =>
                  editing
                    ? client().updateRule({ ...value, id: editing.id }, key)
                    : client().createRule(value, key),
                )
              }
            />
            <h2>Your rules</h2>
            {!rules.data.length && <p>No rules yet.</p>}
            {rules.data.map((rule) => (
              <article className="pp-card" key={rule.id}>
                <h3>
                  {rule.triggers.join(", ")} ·{" "}
                  {rule.enabled ? "Active" : "Paused"}
                </h3>
                <p>
                  {rule.product_ids.length} selected products ·{" "}
                  {rule.delivery_channels.join(", ")} · daily cap{" "}
                  {rule.daily_cap}
                </p>
                <div className="pp-actions">
                  <button onClick={() => setEditing(rule)}>Edit rule</button>
                  <button
                    onClick={() =>
                      void write(["pause", rule.id, !rule.enabled], (key) =>
                        client().updateRule(
                          { ...rule, enabled: !rule.enabled },
                          key,
                        ),
                      )
                    }
                  >
                    {rule.enabled ? "Pause" : "Resume"}
                  </button>
                  <button
                    onClick={() =>
                      void write(["delete-rule", rule.id], (key) =>
                        client().deleteRule(rule.id, key),
                      )
                    }
                  >
                    Delete rule
                  </button>
                </div>
              </article>
            ))}
            <h2>Notification inbox</h2>
            {!notifications.data.length && (
              <p>No notifications. This does not establish current stock.</p>
            )}
            {notifications.data.map((n) => (
              <article className="pp-card" key={n.id}>
                <h3>{n.title}</h3>
                <p>{n.body}</p>
                <p>
                  {timestamp(n.created_at)} ·{" "}
                  {n.evidence_type ?? "No evidence recorded"}
                </p>
                {n.observed_at && <p>Observed {timestamp(n.observed_at)}</p>}
                {safeLink(n.action_url) && (
                  <a href={safeLink(n.action_url)!}>View details</a>
                )}
                {!n.read_at && (
                  <button
                    onClick={() =>
                      void write(["read", n.id], (key) =>
                        client().markRead(n.id, key),
                      )
                    }
                  >
                    Mark read
                  </button>
                )}
              </article>
            ))}
          </>
        )}
        {page === "settings" && (
          <>
            <Preferences
              initial={preferences.data}
              save={(value) =>
                write(["preferences", value], (key) =>
                  client().updatePreferences(value, key),
                )
              }
            />
            <section className="pp-card">
              <h2>Web Push</h2>
              <p>
                Push depends on browser support and server configuration. On
                iOS/iPadOS, install this app on the Home Screen first. Your
                inbox remains available if push is denied.
              </p>
              <button
                onClick={async () => {
                  try {
                    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
                    if (!key)
                      throw new Error(
                        "Push is not configured. Use your inbox.",
                      );
                    await subscribePush(key);
                    await write("enable-push", (k) =>
                      client().updatePreferences({ web_push: true }, k),
                    );
                  } catch (error) {
                    setMessage(
                      error instanceof Error
                        ? error.message
                        : "Push unavailable.",
                    );
                  }
                }}
              >
                Enable push notifications
              </button>
              <button
                onClick={() =>
                  void write("disable-push", async (key) => {
                    const result = await client().updatePreferences(
                      { web_push: false },
                      key,
                    );
                    try {
                      if ("serviceWorker" in navigator) {
                        const registration =
                          await navigator.serviceWorker.getRegistration();
                        const subscription =
                          await registration?.pushManager.getSubscription();
                        await subscription?.unsubscribe();
                      }
                    } catch {
                      throw new Error(
                        "Server push delivery is disabled, but removing this device's subscription failed. Revoke browser permission or retry",
                      );
                    }
                    return result;
                  })
                }
              >
                Disable push delivery
              </button>
            </section>
            <PasswordSettings />
            <Privacy jobs={privacy.data} write={write} />
            <button
              onClick={async () => {
                const result = await authAction("sign-out", {});
                if (result.ok) router.push("/");
                else setMessage("Sign-out failed. Retry.");
              }}
            >
              Sign out
            </button>
          </>
        )}
      </fieldset>
    </>
  );
}

function RuleEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial?: AlertRuleDTO;
  onSave: (value: z.infer<typeof ruleInputSchema>) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<z.infer<typeof ruleInputSchema>>(
    initial ?? {
      enabled: true,
      product_ids: [],
      listing_ids: [],
      set_names: [],
      retailer_ids: [],
      region_codes: [],
      source_ids: [],
      product_types: [],
      seller_types: [],
      channels: [],
      evidence_types: [],
      store_ids: [],
      zip: null,
      radius_mi: null,
      max_price_minor: null,
      currency: null,
      triggers: ["restock"],
      delivery_channels: ["in_app"],
      quiet_hours: null,
      daily_cap: 10,
      cooldown_minutes: 60,
    },
  );
  const [step, setStep] = useState(1),
    [error, setError] = useState("");
  const choices = useResource(async () => {
    const [products, offers, retailers] = await Promise.all([
      allProducts(),
      allOffers(),
      client().retailers({ limit: 50 }),
    ]);
    return { products, offers, retailers: retailers.data };
  }, "rule-choices");
  function patch(value: Partial<typeof draft>) {
    setDraft((current) => ({ ...current, ...value }));
  }
  function toggle(
    field:
      | "triggers"
      | "seller_types"
      | "channels"
      | "evidence_types"
      | "delivery_channels",
    value: string,
    checked: boolean,
  ) {
    setDraft((current) => ({
      ...current,
      [field]: checked
        ? [...current[field], value]
        : current[field].filter((v) => v !== value),
    }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (step < 3) {
      setStep(step + 1);
      return;
    }
    const input = { ...draft };
    delete (input as typeof draft & { id?: string }).id;
    const parsed = ruleInputSchema.safeParse(input);
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      );
      return;
    }
    if (
      parsed.data.triggers.includes("local_sighting") &&
      !parsed.data.zip &&
      !parsed.data.store_ids.length
    ) {
      setError(
        "Local sighting alerts need a ZIP and radius, or selected store IDs.",
      );
      return;
    }
    setError("");
    await onSave(parsed.data);
  }
  const names = draft.product_ids.map(
    (id) =>
      choices.data?.products.find((p) => p.id === id)?.name ??
      "Selected product",
  );
  return (
    <section className="pp-card">
      <h2>{initial ? "Edit alert rule" : "Create alert rule"}</h2>
      <p>
        Step {step} of 3 · Match criteria → Delivery → Review. Empty filter
        groups apply to all values.
      </p>
      <form onSubmit={submit} className="pp-stack">
        {step === 1 && (
          <>
            <h3>What should match?</h3>
            <fieldset>
              <legend>Events</legend>
              {["restock", "new_listing", "price_drop", "local_sighting"].map(
                (value) => (
                  <label className="pp-check" key={value}>
                    <input
                      type="checkbox"
                      checked={draft.triggers.includes(
                        value as (typeof draft.triggers)[number],
                      )}
                      onChange={(e) =>
                        toggle("triggers", value, e.target.checked)
                      }
                    />
                    {value.replaceAll("_", " ")}
                  </label>
                ),
              )}
            </fieldset>
            {choices.loading ? (
              <Skeleton label="Loading catalog choices" />
            ) : choices.error ? (
              <StateCard
                error
                title="Catalog choices unavailable"
                retry={choices.retry}
              >
                {choices.error}
              </StateCard>
            ) : (
              <>
                <label>
                  Products (select multiple with Control or Command)
                  <select
                    className="pp-input"
                    multiple
                    size={5}
                    value={draft.product_ids}
                    onChange={(e) =>
                      patch({
                        product_ids: Array.from(
                          e.target.selectedOptions,
                          (o) => o.value,
                        ),
                      })
                    }
                  >
                    {choices.data?.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.is_demo ? " · DEMO" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Exact offers (optional)
                  <select
                    className="pp-input"
                    multiple
                    size={4}
                    value={draft.listing_ids ?? []}
                    onChange={(e) =>
                      patch({
                        listing_ids: Array.from(
                          e.target.selectedOptions,
                          (o) => o.value,
                        ),
                      })
                    }
                  >
                    {choices.data?.offers.map((o) => (
                      <option key={o.id} value={o.id}>
                        {
                          choices.data?.products.find(
                            (p) => p.id === o.product_id,
                          )?.name
                        }{" "}
                        · {o.retailer_name} ·{" "}
                        {o.seller_type.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Retailers
                  <select
                    className="pp-input"
                    multiple
                    value={draft.retailer_ids}
                    onChange={(e) =>
                      patch({
                        retailer_ids: Array.from(
                          e.target.selectedOptions,
                          (o) => o.value,
                        ),
                      })
                    }
                  >
                    {choices.data?.retailers.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {(
              [
                [
                  "seller_types",
                  ["retailer", "third_party", "mixed", "unknown"],
                ],
                [
                  "channels",
                  ["ship_to_home", "pickup", "in_store_report", "unknown"],
                ],
                [
                  "evidence_types",
                  [
                    "retailer_api",
                    "permitted_partner",
                    "moderated_report",
                    "editorial",
                  ],
                ],
              ] as const
            ).map(([field, values]) => (
              <fieldset key={field}>
                <legend>{field.replaceAll("_", " ")}</legend>
                {values.map((value) => (
                  <label className="pp-check" key={value}>
                    <input
                      type="checkbox"
                      checked={(draft[field] as readonly string[]).includes(
                        value,
                      )}
                      onChange={(e) => toggle(field, value, e.target.checked)}
                    />
                    {value.replaceAll("_", " ")}
                  </label>
                ))}
              </fieldset>
            ))}
            <div className="pp-filters">
              <label>
                Maximum price (minor units)
                <input
                  className="pp-input"
                  type="number"
                  min="0"
                  value={draft.max_price_minor ?? ""}
                  onChange={(e) =>
                    patch({
                      max_price_minor:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                Currency
                <input
                  className="pp-input"
                  pattern="[A-Z]{3}"
                  value={draft.currency ?? ""}
                  onChange={(e) => patch({ currency: e.target.value || null })}
                />
              </label>
              <label>
                ZIP for local alerts
                <input
                  className="pp-input"
                  pattern="[0-9]{5}"
                  value={draft.zip ?? ""}
                  onChange={(e) =>
                    patch({
                      zip: e.target.value || null,
                      radius_mi: e.target.value
                        ? (draft.radius_mi ?? 25)
                        : null,
                    })
                  }
                />
              </label>
              <label>
                Radius (miles)
                <input
                  className="pp-input"
                  type="number"
                  min="1"
                  max="100"
                  value={draft.radius_mi ?? 25}
                  onChange={(e) =>
                    patch({
                      radius_mi: draft.zip ? Number(e.target.value) : null,
                    })
                  }
                />
              </label>
            </div>
            <details>
              <summary>
                Set, format, region, source and specific store filters
              </summary>
              <div className="pp-filters">
                {(
                  [
                    "set_names",
                    "product_types",
                    "region_codes",
                    "source_ids",
                    "store_ids",
                  ] as const
                ).map((field) => (
                  <label key={field}>
                    {field.replaceAll("_", " ")} (comma separated)
                    {field === "store_ids" ? " · canonical store IDs" : ""}
                    <input
                      className="pp-input"
                      value={draft[field]?.join(", ") ?? ""}
                      onChange={(e) =>
                        patch({
                          [field]: e.target.value
                            .split(",")
                            .map((v) => v.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </details>
          </>
        )}
        {step === 2 && (
          <>
            <h3>How should we notify you?</h3>
            <fieldset>
              <legend>Delivery channels</legend>
              {["in_app", "web_push"].map((value) => (
                <label key={value} className="pp-check">
                  <input
                    type="checkbox"
                    checked={draft.delivery_channels.includes(
                      value as (typeof draft.delivery_channels)[number],
                    )}
                    onChange={(e) =>
                      toggle("delivery_channels", value, e.target.checked)
                    }
                  />
                  {value === "in_app"
                    ? "Inbox"
                    : "Web Push (requires permission and opt-in)"}
                </label>
              ))}
            </fieldset>
            <div className="pp-filters">
              <label>
                Daily cap
                <input
                  className="pp-input"
                  type="number"
                  min="1"
                  max="100"
                  value={draft.daily_cap}
                  onChange={(e) => patch({ daily_cap: Number(e.target.value) })}
                />
              </label>
              <label>
                Cooldown (minutes)
                <input
                  className="pp-input"
                  type="number"
                  min="0"
                  max="10080"
                  value={draft.cooldown_minutes}
                  onChange={(e) =>
                    patch({ cooldown_minutes: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            <label className="pp-check">
              <input
                type="checkbox"
                checked={draft.quiet_hours !== null}
                onChange={(e) =>
                  patch({
                    quiet_hours: e.target.checked
                      ? { start: "22:00", end: "08:00", time_zone: "UTC" }
                      : null,
                  })
                }
              />
              Use quiet hours
            </label>
            {draft.quiet_hours && (
              <div className="pp-filters">
                <label>
                  Quiet hours start
                  <input
                    className="pp-input"
                    type="time"
                    value={draft.quiet_hours.start}
                    onChange={(e) =>
                      patch({
                        quiet_hours: {
                          ...draft.quiet_hours!,
                          start: e.target.value,
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Quiet hours end
                  <input
                    className="pp-input"
                    type="time"
                    value={draft.quiet_hours.end}
                    onChange={(e) =>
                      patch({
                        quiet_hours: {
                          ...draft.quiet_hours!,
                          end: e.target.value,
                        },
                      })
                    }
                  />
                </label>
                <label>
                  IANA time zone
                  <input
                    className="pp-input"
                    value={draft.quiet_hours.time_zone}
                    onChange={(e) =>
                      patch({
                        quiet_hours: {
                          ...draft.quiet_hours!,
                          time_zone: e.target.value,
                        },
                      })
                    }
                  />
                </label>
              </div>
            )}
          </>
        )}
        <aside aria-label="Live match preview" className="pp-banner">
          <h3>Match preview</h3>
          <p>
            {draft.triggers.map((v) => v.replaceAll("_", " ")).join(", ") ||
              "Choose an event"}{" "}
            · {names.length ? names.join(", ") : "any product"} ·{" "}
            {draft.listing_ids?.length ?? 0} exact offer filters.
          </p>
          <p>
            {draft.seller_types.length
              ? draft.seller_types.join(", ")
              : "Any seller"}{" "}
            ·{" "}
            {draft.channels.length ? draft.channels.join(", ") : "any channel"}{" "}
            ·{" "}
            {draft.evidence_types.length
              ? draft.evidence_types.join(", ")
              : "any evidence type"}
            .
          </p>
          <p>
            {draft.delivery_channels
              .map((v) => (v === "in_app" ? "Inbox" : "Web Push"))
              .join(" + ")}{" "}
            · up to {draft.daily_cap} / day · {draft.cooldown_minutes} minute
            cooldown.
          </p>
          {draft.zip && (
            <p>
              Within {draft.radius_mi} miles of ZIP {draft.zip}.
            </p>
          )}
          {draft.quiet_hours && (
            <p>
              Quiet hours {draft.quiet_hours.start}–{draft.quiet_hours.end} (
              {draft.quiet_hours.time_zone}).
            </p>
          )}
        </aside>
        {step === 3 && (
          <label className="pp-check">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            Enable this rule
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="pp-actions">
          {step > 1 && (
            <button type="button" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <button className="pp-button">
            {step === 3 ? "Save rule" : "Continue"}
          </button>
          {initial && (
            <button type="button" onClick={onCancel}>
              Cancel edit
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function Preferences({
  initial,
  save,
}: {
  initial: Awaited<
    ReturnType<ReturnType<typeof client>["preferences"]>
  >["data"];
  save: (value: typeof initial) => Promise<void>;
}) {
  const [quiet, setQuiet] = useState(initial.quiet_hours);
  return (
    <form
      className="pp-card pp-stack"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void save({
          ...initial,
          in_app: f.get("in_app") === "on",
          zip: String(f.get("zip")) || null,
          time_zone: String(f.get("time_zone")),
          daily_cap: Number(f.get("daily_cap")),
          quiet_hours: quiet,
        });
      }}
    >
      <h2>Notification preferences</h2>
      <label className="pp-check">
        <input type="checkbox" name="in_app" defaultChecked={initial.in_app} />
        Enable inbox delivery
      </label>
      <label>
        ZIP (optional)
        <input
          className="pp-input"
          name="zip"
          pattern="[0-9]{5}"
          defaultValue={initial.zip ?? ""}
        />
      </label>
      <label>
        Time zone
        <input
          className="pp-input"
          name="time_zone"
          defaultValue={initial.time_zone}
        />
      </label>
      <label>
        Daily delivery cap
        <input
          className="pp-input"
          type="number"
          min="1"
          max="100"
          name="daily_cap"
          defaultValue={initial.daily_cap}
        />
      </label>
      <label className="pp-check">
        <input
          type="checkbox"
          checked={quiet !== null}
          onChange={(event) =>
            setQuiet(
              event.target.checked
                ? { start: "22:00", end: "08:00", time_zone: initial.time_zone }
                : null,
            )
          }
        />
        Use account quiet hours
      </label>
      {quiet && (
        <div className="pp-filters">
          <label>
            Account quiet hours start
            <input
              className="pp-input"
              type="time"
              value={quiet.start}
              onChange={(event) =>
                setQuiet({ ...quiet, start: event.target.value })
              }
            />
          </label>
          <label>
            Account quiet hours end
            <input
              className="pp-input"
              type="time"
              value={quiet.end}
              onChange={(event) =>
                setQuiet({ ...quiet, end: event.target.value })
              }
            />
          </label>
          <label>
            Account quiet-hours time zone
            <input
              className="pp-input"
              value={quiet.time_zone}
              onChange={(event) =>
                setQuiet({ ...quiet, time_zone: event.target.value })
              }
            />
          </label>
        </div>
      )}
      <button className="pp-button">Save preferences</button>
    </form>
  );
}

function PasswordSettings() {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <form
      className="pp-card pp-stack"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const form = event.currentTarget;
        const data = new FormData(form);
        setBusy(true);
        try {
          const result = await authAction("update-password", {
            password: String(data.get("password")),
          });
          if (!result.ok)
            throw new Error(
              "Password update failed. Verify your recovery link or sign in again.",
            );
          form.reset();
          setMessage("Password updated.");
        } catch (error) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Password update unavailable.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Change or recover your password</h2>
      <p>After following a recovery email, set your new password here.</p>
      <label>
        New password (12–256 characters)
        <input
          className="pp-input"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={256}
          required
        />
      </label>
      <button className="pp-button" disabled={busy}>
        {busy ? "Updating…" : "Update password"}
      </button>
      <p role="status">{message}</p>
    </form>
  );
}

function Privacy({
  jobs,
  write,
}: {
  jobs: Awaited<ReturnType<ReturnType<typeof client>["privacyJobs"]>>["data"];
  write: (
    id: unknown,
    operation: (key: string) => Promise<unknown>,
  ) => Promise<void>;
}) {
  const [confirmation, setConfirmation] = useState("");
  const now = useNow();
  return (
    <section className="pp-card">
      <h2>Your data</h2>
      <p>
        Exports and deletion requests enter a queue. A request does not mean
        deletion has completed. Export downloads expire.
      </p>
      <button
        onClick={() =>
          void write("export", (key) => client().requestExport(key))
        }
      >
        Request data export
      </button>
      <label>
        Type DELETE to request account deletion
        <input
          className="pp-input"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
      </label>
      <button
        disabled={confirmation !== "DELETE"}
        onClick={() =>
          void write("delete-account", (key) => client().requestDeletion(key))
        }
      >
        Queue account deletion
      </button>
      <ul>
        {jobs.map((job) => (
          <li key={job.id}>
            {job.kind} · {job.status} · {timestamp(job.created_at)}
            {job.kind === "export" &&
              job.status === "completed" &&
              job.expires_at &&
              now > 0 &&
              Date.parse(job.expires_at) > now && (
                <a
                  href={`/api/v1/me/export/${job.id}`}
                  download="pokepulse-export.json"
                >
                  Download export
                </a>
              )}
          </li>
        ))}
      </ul>
    </section>
  );
}
