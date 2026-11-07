/** Server-side metadata boundary. No inventory, stock, wallet or alert capability. */
export interface PermissionGrant {
  approved: boolean;
  proof_reference: string | null;
  checked_at: string | null;
  expires_at: string | null;
  source_id: string | null;
  provider_set_ids: readonly string[];
}
export interface CatalogPermissions {
  metadata: PermissionGrant;
  art: PermissionGrant;
  licensed_card_art: boolean;
  image_hosts: readonly string[];
  cleared_image_urls: ReadonlySet<string>;
}
export interface CardMetadataProvider {
  source_id: string;
  /** The implementation is server-owned and uses a fixed approved API host.
   * It receives a provider ID, never an arbitrary URL or canonical UUID inferred from a name.
   */
  loadSet: (providerSetId: string, signal: AbortSignal) => Promise<unknown>;
}
export interface MetadataVariant {
  provider_variant_id: string;
  finish: string;
  image_url: string | null;
}
export interface MetadataCard {
  provider_card_id: string;
  card_number: string;
  card_name: string;
  /** Null means unknown. Absence never becomes a blanket reverse/holo list. */
  variants: readonly MetadataVariant[] | null;
}
export interface CatalogSnapshot {
  source_id: string;
  provider_set_id: string;
  name: string;
  metadata_checked_at: string;
  cards: readonly MetadataCard[];
  curation_required: true;
}
export type CatalogOutcome =
  | { kind: "metadata"; snapshot: CatalogSnapshot }
  | {
      kind: "error";
      code: "VALIDATION_ERROR" | "RIGHTS_DISABLED" | "SOURCE_UNAVAILABLE";
      message: string;
    };
export const unreviewedGrant = (): PermissionGrant => ({
  approved: false,
  proof_reference: null,
  checked_at: null,
  expires_at: null,
  source_id: null,
  provider_set_ids: [],
});
export const disabledCatalogPermissions = (): CatalogPermissions => ({
  metadata: unreviewedGrant(),
  art: unreviewedGrant(),
  licensed_card_art: false,
  image_hosts: [],
  cleared_image_urls: new Set(),
});

function grantActive(
  grant: PermissionGrant,
  now: number,
  sourceId: string,
  setId: string,
): boolean {
  const checked =
    grant.checked_at === null ? NaN : Date.parse(grant.checked_at);
  const expires =
    grant.expires_at === null ? null : Date.parse(grant.expires_at);
  return (
    grant.approved &&
    grant.source_id === sourceId &&
    grant.provider_set_ids.includes(setId) &&
    Boolean(grant.proof_reference?.trim()) &&
    Number.isFinite(checked) &&
    checked <= now &&
    (expires === null || (Number.isFinite(expires) && expires > now))
  );
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("INVALID_METADATA");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f]/u.test(value)
  )
    throw new Error("INVALID_METADATA");
  return value;
}
function permittedImage(
  value: unknown,
  permissions: CatalogPermissions,
  now: number,
  sourceId: string,
  setId: string,
): string | null {
  if (
    typeof value !== "string" ||
    !permissions.licensed_card_art ||
    !grantActive(permissions.art, now, sourceId, setId)
  )
    return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !/[a-z]/i.test(url.hostname) ||
      !url.hostname.includes(".") ||
      !permissions.image_hosts.some(
        (host) => host.toLowerCase() === url.hostname.toLowerCase(),
      ) ||
      !permissions.cleared_image_urls.has(url.href)
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
function project(
  raw: unknown,
  sourceId: string,
  setId: string,
  permissions: CatalogPermissions,
  now: number,
): CatalogSnapshot {
  const root = record(raw);
  if (
    root.provider_set_id !== setId ||
    !Array.isArray(root.cards) ||
    root.cards.length > 10000
  )
    throw new Error("INVALID_METADATA");
  const seen = new Set<string>();
  const cards = root.cards.map((value) => {
    const card = record(value);
    const cardId = text(card.provider_card_id, 120);
    if (seen.has(cardId)) throw new Error("INVALID_METADATA");
    seen.add(cardId);
    let variants: MetadataVariant[] | null = null;
    if (card.variant_status === "explicit") {
      if (
        !Array.isArray(card.variants) ||
        !card.variants.length ||
        card.variants.length > 64
      )
        throw new Error("INVALID_METADATA");
      const seenFinishes = new Set<string>(),
        seenIds = new Set<string>();
      variants = card.variants.map((value) => {
        const item = record(value);
        const variantId = text(item.provider_variant_id, 120),
          finish = text(item.finish, 64);
        if (seenIds.has(variantId) || seenFinishes.has(finish))
          throw new Error("INVALID_METADATA");
        seenIds.add(variantId);
        seenFinishes.add(finish);
        return {
          provider_variant_id: variantId,
          finish,
          image_url: permittedImage(
            item.image_url,
            permissions,
            now,
            sourceId,
            setId,
          ),
        };
      });
    } else if (card.variant_status !== "unknown")
      throw new Error("INVALID_METADATA");
    return {
      provider_card_id: cardId,
      card_number: text(card.card_number, 32),
      card_name: text(card.card_name, 160),
      variants,
    };
  });
  return {
    source_id: sourceId,
    provider_set_id: setId,
    name: text(root.name, 160),
    metadata_checked_at: new Date(now).toISOString(),
    cards,
    curation_required: true,
  };
}

/** A live adapter must normalize into the private provider projection above.
 * Shared Zod/API DTO adapters are pending joint contracts review. Provider outputs
 * never publish a validated manifest or grant artwork rights by themselves.
 */
export async function loadPermittedCatalog(
  provider: CardMetadataProvider,
  providerSetId: string,
  permissions: () => CatalogPermissions,
  clock: () => number = Date.now,
  timeoutMs = 8000,
): Promise<CatalogOutcome> {
  if (
    !/^[A-Za-z0-9_.-]{1,80}$/.test(providerSetId) ||
    providerSetId.includes("..")
  )
    return {
      kind: "error",
      code: "VALIDATION_ERROR",
      message: "Invalid metadata set identifier.",
    };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const start = clock(),
      sourceId = text(provider.source_id, 80);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
      throw new Error("INVALID_TIMEOUT");
    if (
      !Number.isFinite(start) ||
      !grantActive(permissions().metadata, start, sourceId, providerSetId)
    )
      return {
        kind: "error",
        code: "RIGHTS_DISABLED",
        message: "Metadata access has not been approved.",
      };
    const controller = new AbortController();
    const raw = await Promise.race([
      provider.loadSet(providerSetId, controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("METADATA_TIMEOUT"));
        }, timeoutMs);
      }),
    ]);
    const end = clock(),
      current = permissions();
    // Recheck after the network await: revocation/expiry must not leak a result.
    if (
      !Number.isFinite(end) ||
      !grantActive(current.metadata, end, sourceId, providerSetId)
    )
      return {
        kind: "error",
        code: "RIGHTS_DISABLED",
        message: "Metadata access is disabled.",
      };
    return {
      kind: "metadata",
      snapshot: project(raw, sourceId, providerSetId, current, end),
    };
  } catch {
    return {
      kind: "error",
      code: "SOURCE_UNAVAILABLE",
      message: "Card metadata is temporarily unavailable.",
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
