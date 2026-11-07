import { createHash } from "node:crypto";
import {
  observationSchema,
  providerOutcomeSchema,
  type ProviderCheckOutcome,
  type ProviderCheckQuery,
  type StockProviderAdapter,
} from "@pokepulse/contracts";
import { canCheckProvider } from "./permissions";
import { safeSourceUrl } from "./catalog";
export class FixtureAdapter implements StockProviderAdapter {
  sourceId = "demo";
  capabilities = {
    availability: true,
    price: true,
    seller: true,
    shipping: true,
    pickup: false,
    regionality: true,
  };
  constructor(private readonly sequence: readonly ProviderCheckOutcome[]) {}
  async check(query: ProviderCheckQuery): Promise<ProviderCheckOutcome> {
    const position =
      Number.parseInt(query.check_id.replaceAll("-", "").slice(-8), 16) %
      this.sequence.length;
    return providerOutcomeSchema.parse(this.sequence[position]);
  }
}
export interface ApprovedFeedConfig {
  permission: unknown;
  credential?: string;
  hosts: readonly string[];
  sourceId: string;
  timeoutMs?: number;
}
/** Transport boundary only. No retailer parser is enabled without approved source-specific semantics. */
export async function fetchApprovedObservation(
  config: ApprovedFeedConfig,
  query: ProviderCheckQuery,
  parse: (body: unknown) => unknown,
  fetcher: typeof fetch = fetch,
): Promise<ProviderCheckOutcome> {
  if (!canCheckProvider(config.permission, config.credential))
    return { kind: "not_supported", reason: "permission_disabled" };
  let url: URL;
  try {
    url = safeSourceUrl(query.source_url, config.hosts);
  } catch {
    return { kind: "not_supported", reason: "unsafe_url" };
  }
  try {
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${config.credential}` },
      redirect: "error",
      signal: AbortSignal.timeout(config.timeoutMs ?? 5000),
    });
    if (response.status === 429) {
      const h = response.headers.get("Retry-After");
      const seconds =
        h && /^\d+$/.test(h)
          ? Number(h)
          : h
            ? Math.ceil((Date.parse(h) - Date.now()) / 1000)
            : 60;
      return {
        kind: "temporary_error",
        reason_code: "rate_limited",
        retry_after_seconds: Math.min(
          86400,
          Math.max(0, Number.isFinite(seconds) ? seconds : 60),
        ),
      };
    }
    if (!response.ok)
      return { kind: "temporary_error", reason_code: "source_http_error" };
    if (Number(response.headers.get("content-length")) > 1_000_000)
      return { kind: "temporary_error", reason_code: "payload_too_large" };
    const reader = response.body?.getReader();
    if (!reader) return { kind: "not_supported", reason: "empty_body" };
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const v = await reader.read();
      if (v.done) break;
      size += v.value.byteLength;
      if (size > 1_000_000) {
        await reader.cancel();
        return { kind: "temporary_error", reason_code: "payload_too_large" };
      }
      chunks.push(v.value);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    const parsed = observationSchema.safeParse(parse(JSON.parse(raw)));
    if (!parsed.success)
      return { kind: "not_supported", reason: "missing_or_ambiguous_fields" };
    const o = parsed.data;
    if (
      o.source_id !== config.sourceId ||
      o.listing_id !== query.listing_id ||
      o.region_code !== query.region_code ||
      o.seller_type !== query.seller_type ||
      o.seller_id !== query.seller_id ||
      o.channel !== query.channel
    )
      return { kind: "not_supported", reason: "identity_mismatch" };
    return {
      kind: "observation",
      observation: {
        ...o,
        payload_hash: createHash("sha256").update(raw).digest("hex"),
      },
    };
  } catch {
    return {
      kind: "temporary_error",
      reason_code: "transport_or_schema_error",
    };
  }
}
