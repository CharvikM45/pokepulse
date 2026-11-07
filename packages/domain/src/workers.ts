import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as webpush from "web-push";
import { z } from "zod";
import {
  observationSchema,
  providerOutcomeSchema,
  ruleSchema,
  localEventSchema,
  type StockProviderAdapter,
  type ProviderCheckQuery,
  type LocalSightingEvent,
} from "@pokepulse/contracts";
import { matchRule, type MatchEvent, inQuietHours } from "./alerts";
import { safeSourceUrl } from "./inventory/catalog";
export function serviceDatabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing server database configuration");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
function check(error: { message: string } | null) {
  if (error) throw new Error("DATABASE_OPERATION_FAILED");
}
const jobSchema = z.object({
  id: z.string(),
  listing_id: z.string(),
  source_id: z.string(),
  lease_token: z.string(),
});
export async function schedule(db: SupabaseClient) {
  const r = await db.rpc("schedule_checks");
  check(r.error);
  return r.data as number;
}
export async function ingestOne(
  db: SupabaseClient,
  adapters: ReadonlyMap<string, StockProviderAdapter>,
): Promise<boolean> {
  const result = await db.rpc("claim_check");
  check(result.error);
  if (!result.data) return false;
  const job = jobSchema.parse(result.data);
  const { data: listing, error } = await db
    .from("listings")
    .select("*")
    .eq("id", job.listing_id)
    .single();
  check(error);
  const { data: source, error: sourceError } = await db
    .from("source_permissions")
    .select("*")
    .eq("id", job.source_id)
    .single();
  check(sourceError);
  let outcome;
  const adapter = adapters.get(job.source_id);
  if (!source.enabled || source.status !== "approved" || !adapter)
    outcome = {
      kind: "not_supported",
      reason: "provider_unconfigured_or_disabled",
    };
  else {
    const query: ProviderCheckQuery = {
      listing_id: listing.id,
      source_id: listing.source_id,
      source_item_id: listing.source_item_id,
      source_url: listing.retailer_url,
      seller_type: listing.seller_type,
      seller_id: listing.seller_id,
      channel: listing.channel,
      region_code: listing.region_code,
      check_id: job.id,
    };
    try {
      safeSourceUrl(query.source_url, source.allowed_hosts);
      outcome = providerOutcomeSchema.parse(await adapter.check(query));
      if (outcome.kind === "observation")
        observationSchema.parse(outcome.observation);
    } catch {
      outcome = { kind: "temporary_error", reason_code: "adapter_failure" };
    }
  }
  const done = await db.rpc("finish_check", {
    p_job: job.id,
    p_token: job.lease_token,
    p_outcome: outcome,
  });
  check(done.error);
  return true;
}
function eventForMatch(
  id: string,
  event_type: string,
  s: Record<string, unknown>,
): MatchEvent {
  return {
    id,
    event_type,
    source_id: typeof s.source_id === "string" ? s.source_id : undefined,
    product_id: typeof s.product_id === "string" ? s.product_id : null,
    listing_id: typeof s.listing_id === "string" ? s.listing_id : undefined,
    set_name: typeof s.set_name === "string" ? s.set_name : null,
    product_type: typeof s.product_type === "string" ? s.product_type : null,
    retailer_id: typeof s.retailer_id === "string" ? s.retailer_id : null,
    seller_type: z
      .enum(["retailer", "third_party", "mixed", "unknown"])
      .catch("unknown")
      .parse(s.seller_type),
    channel: z
      .enum(["ship_to_home", "pickup", "in_store_report", "unknown"])
      .catch("unknown")
      .parse(s.channel),
    evidence_type: z
      .enum([
        "retailer_api",
        "permitted_partner",
        "moderated_report",
        "editorial",
      ])
      .parse(s.evidence_type),
    price_minor: typeof s.price_minor === "number" ? s.price_minor : null,
    currency: typeof s.currency === "string" ? s.currency : null,
    region_code: typeof s.region_code === "string" ? s.region_code : null,
    store_id: typeof s.store_id === "string" ? s.store_id : undefined,
    store_zip: typeof s.store_zip === "string" ? s.store_zip : null,
    stale_after: z.string().parse(s.stale_after),
    source_url: typeof s.source_url === "string" ? s.source_url : null,
    is_demo: s.is_demo === true,
  };
}
export async function matchOne(
  db: SupabaseClient,
  resolveDistance?: (fromZip: string, toZip: string) => Promise<number | null>,
): Promise<boolean> {
  const claim = await db.rpc("claim_alert");
  check(claim.error);
  if (!claim.data) return false;
  const job = z
    .object({
      event_id: z.string(),
      lease_token: z.string(),
      attempts: z.number(),
    })
    .parse(claim.data);
  try {
    const { data: event, error } = await db
      .from("stock_events")
      .select("*")
      .eq("id", job.event_id)
      .single();
    check(error);
    const matchEvent = eventForMatch(
      event.id,
      event.event_type,
      event.snapshot,
    );
    for (let offset = 0; ; offset += 500) {
      const { data: rules, error: rulesError } = await db
        .from("alert_rules")
        .select("*")
        .order("id")
        .range(offset, offset + 499);
      check(rulesError);
      for (const row of rules ?? []) {
        const parsed = ruleSchema.safeParse({ ...row.definition, id: row.id });
        if (!parsed.success) continue;
        const rule = parsed.data;
        const localEvent = { ...matchEvent };
        if (rule.zip && localEvent.store_zip && resolveDistance) {
          localEvent.distance_mi = await resolveDistance(
            rule.zip,
            localEvent.store_zip,
          );
          localEvent.distance_from_zip = rule.zip;
        }
        const match = matchRule(rule, localEvent, new Date());
        if (!match.matches) continue;
        for (const channel of new Set(["in_app", ...rule.delivery_channels])) {
          const r = await db.rpc("enqueue_notification", {
            p_user: row.user_id,
            p_rule: row.id,
            p_event: event.id,
            p_channel: channel,
            p_body: {
              rule_snapshot: row.definition,
              title: `${matchEvent.is_demo ? "DEMO DATA — " : ""}${event.event_type.replaceAll("_", " ")}`,
              body: `Matched ${match.reasons.join(", ")}. Observed ${event.occurred_at}; evidence: ${matchEvent.evidence_type}.`,
              action_url: matchEvent.source_url,
            },
          });
          check(r.error);
        }
      }
      if (!rules || rules.length < 500) break;
    }
    const r = await db
      .from("alert_match_jobs")
      .update({ status: "done", lease_until: null })
      .eq("event_id", job.event_id)
      .eq("lease_token", job.lease_token);
    check(r.error);
  } catch {
    const r = await db
      .from("alert_match_jobs")
      .update({
        status: job.attempts >= 5 ? "failed" : "pending",
        lease_until: null,
      })
      .eq("event_id", job.event_id)
      .eq("lease_token", job.lease_token);
    check(r.error);
  }
  return true;
}
export async function publishLocalSighting(
  db: SupabaseClient,
  input: LocalSightingEvent,
) {
  const e = localEventSchema.parse(input);
  if (
    Date.parse(e.occurred_at) > Date.now() ||
    Date.parse(e.payload.expires_at) <= Date.now()
  )
    throw new Error("VALIDATION_ERROR");
  const r = await db.rpc("publish_local_event", { p_event: e });
  check(r.error);
  return r.data;
}
const pushHosts = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
  "wns2-par02p.notify.windows.com",
];
export async function deliverOne(db: SupabaseClient): Promise<boolean> {
  const claim = await db.rpc("claim_delivery");
  check(claim.error);
  if (!claim.data) return false;
  const job = z
    .object({
      id: z.string(),
      notification_id: z.string(),
      lease_token: z.string(),
      attempts: z.number(),
    })
    .parse(claim.data);
  let status = "suppressed",
    reason: string | null = null;
  try {
    const { data: n, error } = await db
      .from("notifications")
      .select("*")
      .eq("id", job.notification_id)
      .single();
    check(error);
    const { data: prefs, error: pe } = await db
      .from("user_preferences")
      .select("*")
      .eq("user_id", n.user_id)
      .single();
    check(pe);
    const { data: ev, error: ee } = await db
      .from("stock_events")
      .select("*")
      .eq("id", n.event_id)
      .single();
    check(ee);
    const { data: rr, error: re } = await db
      .from("alert_rules")
      .select("*")
      .eq("id", n.rule_id)
      .maybeSingle();
    check(re);
    const rule = rr
      ? ruleSchema.safeParse({ ...rr.definition, id: rr.id })
      : null;
    const event = eventForMatch(ev.id, ev.event_type, ev.snapshot);
    const { data: flag, error: fe } = await db
      .from("feature_flags")
      .select("enabled")
      .eq("name", "web_push")
      .single();
    check(fe);
    const eligibility = await db.rpc("event_is_current", {
      p_event: n.event_id,
      p_rule: n.rule_id,
    });
    check(eligibility.error);
    let sourceOK = eligibility.data === true;
    if (ev.snapshot.source_id) {
      const { data: source, error: se } = await db
        .from("source_permissions")
        .select("enabled,status")
        .eq("id", ev.snapshot.source_id)
        .single();
      check(se);
      sourceOK =
        sourceOK && source?.enabled === true && source.status === "approved";
    }
    if (ev.listing_id) {
      const { data: state, error: ce } = await db
        .from("listing_current_state")
        .select("conflicted")
        .eq("listing_id", ev.listing_id)
        .maybeSingle();
      check(ce);
      sourceOK = sourceOK && !state?.conflicted;
    }
    if (
      flag?.enabled &&
      prefs.in_app &&
      prefs.web_push &&
      sourceOK &&
      rule?.success &&
      matchRule(rule.data, event, new Date()).matches &&
      !inQuietHours(prefs.quiet_hours, new Date()) &&
      !inQuietHours(rule.data.quiet_hours, new Date())
    ) {
      if (
        !process.env.VAPID_PUBLIC_KEY ||
        !process.env.VAPID_PRIVATE_KEY ||
        !process.env.VAPID_SUBJECT
      )
        throw new Error("PUSH_UNCONFIGURED");
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY,
      );
      const { data: subscriptions, error: sue } = await db
        .from("push_subscriptions")
        .select("*")
        .eq("user_id", n.user_id);
      check(sue);
      let sent = 0;
      for (const sub of subscriptions ?? []) {
        safeSourceUrl(sub.endpoint, pushHosts);
        const reserved = await db
          .from("push_delivery_attempts")
          .insert({ notification_id: n.id, subscription_id: sub.id });
        if (reserved.error?.code === "23505") continue;
        check(reserved.error);
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify({
              id: n.id,
              title: n.title,
              body: n.body,
              url: n.action_url,
            }),
            {
              TTL: Math.max(
                0,
                Math.min(
                  300,
                  Math.floor(
                    (Date.parse(event.stale_after) - Date.now()) / 1000,
                  ),
                ),
              ),
              timeout: 5000,
            },
          );
          const marked = await db
            .from("push_delivery_attempts")
            .update({ status: "sent" })
            .eq("notification_id", n.id)
            .eq("subscription_id", sub.id);
          check(marked.error);
          sent++;
        } catch (e) {
          const code =
            typeof e === "object" && e !== null && "statusCode" in e
              ? Number(e.statusCode)
              : 0;
          if (code === 404 || code === 410) {
            const removed = await db
              .from("push_subscriptions")
              .delete()
              .eq("id", sub.id);
            check(removed.error);
          } else {
            const failed = await db
              .from("push_delivery_attempts")
              .update({ status: "failed" })
              .eq("notification_id", n.id)
              .eq("subscription_id", sub.id);
            check(failed.error);
            throw new Error("PUSH_TRANSPORT_FAILED");
          }
        }
      }
      status = sent ? "sent" : "suppressed";
    }
  } catch {
    status = "failed";
    reason = "push_delivery_failed";
  }
  const r = await db
    .from("notification_deliveries")
    .update({
      status,
      last_error_code: reason,
      lease_until: null,
      available_at: new Date(
        Date.now() + Math.min(3600, 30 * 2 ** job.attempts) * 1000,
      ).toISOString(),
    })
    .eq("id", job.id)
    .eq("lease_token", job.lease_token);
  check(r.error);
  return true;
}
export interface PrivacyParticipant {
  name: string;
  export(userId: string): Promise<unknown>;
  erase(userId: string): Promise<void>;
}
export async function privacyOne(
  db: SupabaseClient,
  participants: readonly PrivacyParticipant[] = [],
): Promise<boolean> {
  const claim = await db.rpc("claim_privacy");
  check(claim.error);
  if (!claim.data) return false;
  const job = z
    .object({
      id: z.string(),
      user_id: z.string().nullable(),
      kind: z.enum(["export", "delete"]),
      lease_token: z.string(),
    })
    .parse(claim.data);
  try {
    if (!job.user_id) throw new Error("MISSING_ACCOUNT");
    const available = await db.rpc("privacy_participants_required");
    check(available.error);
    const required = z.array(z.string()).parse(available.data);
    if (required.some((name) => !participants.some((p) => p.name === name))) {
      const r = await db
        .from("privacy_jobs")
        .update({
          status: "blocked",
          error_code: "B_PRIVACY_HOOK_REQUIRED",
          lease_until: null,
        })
        .eq("id", job.id)
        .eq("lease_token", job.lease_token);
      check(r.error);
      return true;
    }
    if (job.kind === "export") {
      const r = await db.rpc("privacy_export", { p_user: job.user_id });
      check(r.error);
      const payload: Record<string, unknown> = { ...r.data };
      for (const p of participants)
        payload[p.name] = await p.export(job.user_id);
      const saved = await db
        .from("privacy_jobs")
        .update({
          status: "completed",
          result: payload,
          completed_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          lease_until: null,
        })
        .eq("id", job.id)
        .eq("lease_token", job.lease_token);
      check(saved.error);
    } else {
      for (const p of participants) await p.erase(job.user_id);
      const { error } = await db.auth.admin.deleteUser(job.user_id);
      check(error);
      const saved = await db
        .from("privacy_jobs")
        .update({
          status: "completed",
          result: null,
          error_code: null,
          completed_at: new Date().toISOString(),
          lease_until: null,
        })
        .eq("id", job.id)
        .eq("lease_token", job.lease_token);
      check(saved.error);
    }
  } catch {
    const r = await db
      .from("privacy_jobs")
      .update({
        status: "failed",
        error_code: "PRIVACY_PROCESSING_FAILED",
        lease_until: null,
      })
      .eq("id", job.id)
      .eq("lease_token", job.lease_token);
    check(r.error);
  }
  return true;
}
export async function retention(db: SupabaseClient) {
  const r = await db.rpc("purge_expired_private_data");
  check(r.error);
}
