"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { CommittedReveal } from "./committed-reveal";
import type { CommittedRevealProps } from "./committed-reveal";
import {
  parsePendingOpening,
  recoveryKeys,
  savedOpeningId,
} from "../../../../../packages/domain/src/packs/recovery";
import type { PendingOpening } from "../../../../../packages/domain/src/packs/recovery";
import { uuidValue } from "../../../../../packages/domain/src/radar/policies";
import {
  Skeleton,
  StateCard,
  StatusBadge,
} from "../../../../../packages/ui/src/primitives";

export interface SimulationOdds {
  version: string;
  model: "fictional" | "estimated";
  methodology: string;
  sample_size: number | null;
  source_url: string | null;
  checked_label: string | null;
  uncertainty: string | null;
  slots: readonly {
    label: string;
    outcomes: readonly { label: string; probability: string }[];
  }[];
}
export interface SimulationSet {
  metadata_source?: string;
  id: string;
  name: string;
  rights_status: "approved" | "metadata_only" | "disabled";
  enabled: boolean;
  is_demo: boolean;
  coin_cost: number | null;
  odds: SimulationOdds | null;
}
export interface SavedOpening extends CommittedRevealProps {
  setId: string;
  setName: string;
}
export interface OpeningSummary {
  id: string;
  set_name: string;
  opened_at_label: string;
  odds_version: string;
}
export interface LabState {
  balance: number;
  welcome_grant_on_first_open: number;
  free_open_available: boolean;
  allowance_note: string;
  history: readonly OpeningSummary[];
  next_cursor: string | null;
}
/** Rejected means a validated, definitive no-write denial. Transport failures,
 * timeouts and ambiguous 5xx responses must THROW so the same key is retained.
 */
export type OpeningOutcome =
  | { status: "committed"; opening: SavedOpening }
  | { status: "rejected"; message: string };
export interface LabService {
  state: (signal: AbortSignal) => Promise<LabState>;
  history: (
    cursor: string,
    signal: AbortSignal,
  ) => Promise<{
    openings: readonly OpeningSummary[];
    next_cursor: string | null;
  }>;
  opening: (id: string, signal: AbortSignal) => Promise<SavedOpening>;
  open: (
    body: PendingOpening["body"],
    key: string,
    signal: AbortSignal,
  ) => Promise<OpeningOutcome>;
}
function sourceUrl(value: string | null): string | null {
  try {
    if (value === null) return null;
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function documented(set: SimulationSet): boolean {
  const odds = set.odds;
  return (
    uuidValue(set.id) &&
    set.rights_status === "approved" &&
    set.enabled &&
    set.coin_cost !== null &&
    Number.isSafeInteger(set.coin_cost) &&
    set.coin_cost >= 0 &&
    odds !== null &&
    Boolean(odds.version.trim()) &&
    Boolean(odds.methodology.trim()) &&
    odds.slots.length > 0 &&
    odds.slots.every((slot) => slot.outcomes.length > 0) &&
    (odds.model === "fictional" ||
      (odds.sample_size !== null &&
        Number.isSafeInteger(odds.sample_size) &&
        odds.sample_size > 0 &&
        sourceUrl(odds.source_url) !== null &&
        Boolean(odds.checked_label) &&
        Boolean(odds.uncertainty)))
  );
}
function validOpening(value: SavedOpening): boolean {
  return (
    uuidValue(value.openingId) &&
    uuidValue(value.setId) &&
    Boolean(value.oddsVersion) &&
    Number.isSafeInteger(value.spentCoins) &&
    value.spentCoins >= 0 &&
    typeof value.usedFreeOpen === "boolean" &&
    (!value.usedFreeOpen || value.spentCoins === 0) &&
    Array.isArray(value.cards) &&
    value.cards.length > 0 &&
    value.cards.length <= 100 &&
    [...value.cards]
      .sort((a, b) => a.slot_index - b.slot_index)
      .every(
        (card, index) =>
          card.slot_index === index && uuidValue(card.card_variant_id),
      )
  );
}
function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* Persisted server history remains available. */
  }
}

export interface PackLabProps {
  enabled: boolean;
  sets: readonly SimulationSet[];
  /** Verified user UUID from A's session, never an access token or request-body identity. */
  userScope: string | null;
  service: LabService;
  onSignIn: () => void;
}
export function PackLab(props: PackLabProps) {
  return <SessionLab key={props.userScope ?? "anonymous"} {...props} />;
}
function SessionLab({
  enabled,
  sets,
  userScope,
  service,
  onSignIn,
}: PackLabProps) {
  const [state, setState] = useState<LabState | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [useFree, setUseFree] = useState(true);
  const [pending, setPending] = useState<PendingOpening | null>(null);
  const [processing, setProcessing] = useState(false);
  const [openingBusy, setOpeningBusy] = useState(false);
  const [opening, setOpening] = useState<SavedOpening | null>(null);
  const [requestError, setRequestError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [moreBusy, setMoreBusy] = useState(false);
  const active = useRef(true);
  const lock = useRef(false);
  const stateAbort = useRef<AbortController | null>(null),
    openAbort = useRef<AbortController | null>(null),
    resultAbort = useRef<AbortController | null>(null),
    moreAbort = useRef<AbortController | null>(null);
  const resultGeneration = useRef(0);
  const validScope = userScope !== null && uuidValue(userScope);
  const openGeneration = useRef(0);
  async function refresh() {
    if (!validScope) return;
    stateAbort.current?.abort();
    const controller = new AbortController();
    stateAbort.current = controller;
    setPhase("loading");
    try {
      const next = await service.state(controller.signal);
      if (!active.current || controller.signal.aborted) return;
      if (
        !Number.isSafeInteger(next.balance) ||
        next.balance < 0 ||
        !Number.isSafeInteger(next.welcome_grant_on_first_open) ||
        next.welcome_grant_on_first_open < 0 ||
        typeof next.free_open_available !== "boolean"
      )
        throw new Error();
      setState(next);
      setUseFree(next.free_open_available);
      setPhase("ready");
    } catch {
      if (active.current && !controller.signal.aborted) setPhase("error");
    }
  }
  async function showOpening(id: string) {
    if (!validScope || !uuidValue(id) || lock.current) return;
    resultAbort.current?.abort();
    const controller = new AbortController();
    resultAbort.current = controller;
    const generation = ++resultGeneration.current;
    setOpeningBusy(true);
    setHistoryError("");
    try {
      const result = await service.opening(id, controller.signal);
      if (
        !active.current ||
        controller.signal.aborted ||
        generation !== resultGeneration.current
      )
        return;
      if (!validOpening(result) || result.openingId !== id) throw new Error();
      setOpening(result);
      write(recoveryKeys(userScope!).opening, id);
    } catch {
      if (
        active.current &&
        !controller.signal.aborted &&
        generation === resultGeneration.current
      )
        setHistoryError(
          "The saved opening could not be loaded. Retry from history; no new opening request was made.",
        );
    } finally {
      if (active.current && generation === resultGeneration.current)
        setOpeningBusy(false);
    }
  }
  const boot = useEffectEvent(() => {
    lock.current = false;
    setProcessing(false);
    setOpeningBusy(false);
    setMoreBusy(false);
    if (validScope) {
      const keys = recoveryKeys(userScope!);
      const cached = parsePendingOpening(read(keys.pending));
      setPending(cached);
      void refresh();
      const saved = savedOpeningId(read(keys.opening));
      if (saved && cached === null) void showOpening(saved);
    }
  });
  useEffect(() => {
    active.current = true;
    const timer = setTimeout(() => boot(), 0);
    const stateRequest = stateAbort,
      openingRequest = openAbort,
      resultRequest = resultAbort,
      historyRequest = moreAbort;
    return () => {
      clearTimeout(timer);
      active.current = false;
      lock.current = false;
      stateRequest.current?.abort();
      openingRequest.current?.abort();
      resultRequest.current?.abort();
      historyRequest.current?.abort();
    };
  }, [userScope, service]);
  async function submitRequest(request: PendingOpening) {
    if (!validScope || lock.current) return;
    resultAbort.current?.abort();
    resultGeneration.current++;
    setOpeningBusy(false);
    const generation = ++openGeneration.current;
    lock.current = true;
    setProcessing(true);
    setRequestError("");
    setPending(request);
    write(recoveryKeys(userScope!).pending, JSON.stringify(request));
    const controller = new AbortController();
    openAbort.current = controller;
    try {
      const result = await service.open(
        request.body,
        request.key,
        controller.signal,
      );
      if (
        !active.current ||
        controller.signal.aborted ||
        generation !== openGeneration.current
      )
        return;
      if (result.status === "rejected") {
        setPending(null);
        write(recoveryKeys(userScope!).pending, null);
        setRequestError(result.message);
        await refresh();
        return;
      }
      if (
        !validOpening(result.opening) ||
        result.opening.setId !== request.body.set_id
      )
        throw new Error();
      write(recoveryKeys(userScope!).opening, result.opening.openingId);
      write(recoveryKeys(userScope!).pending, null);
      setPending(null);
      setOpening(result.opening);
      await refresh();
    } catch {
      if (
        active.current &&
        !controller.signal.aborted &&
        generation === openGeneration.current
      )
        setRequestError(
          "The opening response was not acknowledged. Retry the pending request to reuse its key; check saved history before starting another opening.",
        );
    } finally {
      if (generation === openGeneration.current) {
        lock.current = false;
        if (active.current) setProcessing(false);
      }
    }
  }
  function open(set: SimulationSet) {
    if (userScope === null) {
      onSignIn();
      return;
    }
    if (
      !validScope ||
      !enabled ||
      phase !== "ready" ||
      pending ||
      opening ||
      openingBusy ||
      lock.current ||
      !documented(set) ||
      !state
    )
      return;
    const free = useFree && state.free_open_available;
    if (
      !free &&
      (set.coin_cost ?? Infinity) >
        state.balance + state.welcome_grant_on_first_open
    )
      return;
    void submitRequest({
      version: 1,
      key: crypto.randomUUID(),
      body: { set_id: set.id, use_free_open: free },
    });
  }
  async function moreHistory() {
    if (!validScope || !state?.next_cursor || moreBusy) return;
    const controller = new AbortController();
    moreAbort.current = controller;
    setMoreBusy(true);
    setHistoryError("");
    try {
      const result = await service.history(
        state.next_cursor,
        controller.signal,
      );
      if (!active.current || controller.signal.aborted) return;
      setState((current) =>
        current
          ? {
              ...current,
              history: [
                ...current.history,
                ...result.openings.filter(
                  (item) => !current.history.some((old) => old.id === item.id),
                ),
              ],
              next_cursor: result.next_cursor,
            }
          : current,
      );
    } catch {
      if (active.current && !controller.signal.aborted)
        setHistoryError("Opening history could not be loaded. Try again.");
    } finally {
      if (active.current) setMoreBusy(false);
    }
  }
  return (
    <section className="pp-stack" aria-label="Free simulated Pack Lab">
      <h1>Pack Lab</h1>
      <p className="pp-banner">
        Free simulation only. No physical cards, purchases, cash value,
        transfers, trading, redemption or prizes.
      </p>
      {!enabled && (
        <StateCard title="Pack opening unavailable">
          Simulation is disabled. Previously saved results can still be viewed
          when signed in.
        </StateCard>
      )}
      {userScope === null ? (
        <>
          <StateCard title="Browse first, sign in to save">
            Opening history and free resources are private. Sign in only when
            you want to open or view your saved results.
          </StateCard>
          <button className="pp-button" type="button" onClick={onSignIn}>
            Sign in to view saved history
          </button>
        </>
      ) : !validScope ? (
        <StateCard title="Verified account unavailable" error>
          A verified account is required to access private pack data.
        </StateCard>
      ) : phase === "loading" ? (
        <Skeleton label="Loading private wallet and opening history" />
      ) : phase === "error" ? (
        <StateCard
          title="Wallet and history unavailable"
          error
          retry={() => void refresh()}
        >
          The latest free balance could not be loaded. Your saved opening, if
          shown below, remains committed.
        </StateCard>
      ) : (
        state && (
          <section className="pp-card">
            <h2>Free-only wallet</h2>
            <p>
              {processing || pending
                ? "Last loaded wallet balance"
                : "Wallet balance"}
              : {state.balance} free coins.
            </p>
            {state.welcome_grant_on_first_open > 0 && (
              <p>
                Your first eligible opening adds{" "}
                {state.welcome_grant_on_first_open} free coins as a one-time
                grant.
              </p>
            )}
            <p>{state.allowance_note}</p>
            <label className="pp-check">
              <input
                type="checkbox"
                checked={useFree && state.free_open_available}
                disabled={
                  !state.free_open_available || processing || pending !== null
                }
                onChange={(event) => setUseFree(event.target.checked)}
              />
              <span>Use an available free opening allowance</span>
            </label>
          </section>
        )
      )}
      {pending && validScope && (
        <section className="pp-card">
          <h2>Pending opening request</h2>
          <p>
            A prior response may have been lost. Retrying reuses its original
            request key and body. If it was not saved, retrying may create this
            one opening.
          </p>
          <button
            className="pp-button"
            type="button"
            disabled={processing}
            onClick={() => void submitRequest(pending)}
          >
            {processing ? "Resolving request…" : "Retry pending opening"}
          </button>
          <button
            className="pp-button"
            data-variant="secondary"
            type="button"
            disabled={processing}
            onClick={() => void refresh()}
          >
            Check saved history
          </button>
        </section>
      )}
      {requestError && (
        <p className="pp-error" role="alert">
          {requestError}
        </p>
      )}
      <div className="pp-grid">
        {sets.map((set) => {
          const ready = documented(set);
          const odds = set.odds;
          const enough =
            state !== null &&
            ((useFree && state.free_open_available) ||
              (set.coin_cost !== null &&
                state.balance + state.welcome_grant_on_first_open >=
                  set.coin_cost));
          return (
            <article className="pp-card" key={set.id}>
              {set.is_demo && (
                <StatusBadge tone="warning">DEMO DATA</StatusBadge>
              )}
              <h2>{set.name}</h2>
              {set.metadata_source && (
                <p>Metadata source: {set.metadata_source}</p>
              )}
              <p>
                {set.coin_cost === null
                  ? "Free coin cost unavailable"
                  : `${set.coin_cost} free-only coins, or an available free allowance`}
              </p>
              {odds && (
                <details>
                  <summary>
                    {odds.model === "fictional"
                      ? "Fictional configured rates"
                      : "Independently estimated rates"}{" "}
                    · {odds.version}
                  </summary>
                  <p>Methodology: {odds.methodology}</p>
                  {odds.model === "estimated" && (
                    <>
                      <p>
                        Sample size: {odds.sample_size ?? "Unavailable"} ·
                        checked {odds.checked_label ?? "Unavailable"}
                      </p>
                      <p>{odds.uncertainty ?? "Uncertainty not documented."}</p>
                      {sourceUrl(odds.source_url) && (
                        <a href={sourceUrl(odds.source_url)!}>
                          Odds methodology source
                        </a>
                      )}
                    </>
                  )}
                  {odds.slots.map((slot, index) => (
                    <section key={index}>
                      <h3>{slot.label}</h3>
                      <ul>
                        {slot.outcomes.map((item, itemIndex) => (
                          <li key={itemIndex}>
                            {item.label}: {item.probability}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                  <p>
                    These are simulated configurations, not a promise of exact
                    physical pull rates.
                  </p>
                </details>
              )}
              {!ready && (
                <p>
                  Simulation unavailable: rights, eligible content or odds
                  documentation are incomplete.
                </p>
              )}
              <button
                className="pp-button"
                type="button"
                disabled={
                  !enabled ||
                  !ready ||
                  (userScope !== null &&
                    (!validScope ||
                      phase !== "ready" ||
                      !enough ||
                      processing ||
                      pending !== null ||
                      opening !== null ||
                      openingBusy))
                }
                onClick={() => open(set)}
              >
                {userScope === null
                  ? "Sign in to open a free simulation"
                  : processing
                    ? "Saving opening…"
                    : `Open ${set.name} simulation`}
              </button>
            </article>
          );
        })}
      </div>
      {!sets.length && (
        <StateCard title="No approved simulated sets">
          Supported content will appear only after its rights and configuration
          gates pass.
        </StateCard>
      )}
      {openingBusy && <Skeleton label="Loading saved opening; no new draw" />}
      {opening && (
        <>
          <p>Saved set: {opening.setName}</p>
          <CommittedReveal {...opening} />
          <button
            className="pp-button"
            data-variant="secondary"
            type="button"
            disabled={processing || pending !== null || openingBusy}
            onClick={() => {
              setOpening(null);
              if (validScope) write(recoveryKeys(userScope!).opening, null);
            }}
          >
            Choose another simulated opening
          </button>
        </>
      )}
      {historyError && (
        <p className="pp-error" role="alert">
          {historyError}
        </p>
      )}
      {validScope && phase === "ready" && state && (
        <section className="pp-stack">
          <h2>Saved opening history</h2>
          {!state.history.length ? (
            <p>No saved openings yet.</p>
          ) : (
            <ul className="pp-history-list">
              {state.history.map((item) => (
                <li className="pp-card" key={item.id}>
                  <h3>{item.set_name}</h3>
                  <p>
                    {item.opened_at_label} · odds {item.odds_version}
                  </p>
                  <button
                    className="pp-button"
                    type="button"
                    disabled={processing || openingBusy}
                    onClick={() => void showOpening(item.id)}
                  >
                    View saved opening {item.opened_at_label}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {state.next_cursor && (
            <button
              className="pp-button"
              type="button"
              disabled={moreBusy || processing}
              onClick={() => void moreHistory()}
            >
              {moreBusy ? "Loading history…" : "Load more opening history"}
            </button>
          )}
        </section>
      )}
    </section>
  );
}
