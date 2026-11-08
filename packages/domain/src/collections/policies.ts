/** B-private policy types. Proposed wire schemas must go through contracts review. */
export type Goal = "base" | "master" | "extended";
export type Mode = "real" | "virtual";
export interface Variant {
  id: string;
  set_id: string;
  card_number: string;
  card_name: string;
  finish: string;
  rarity?: string | null;
  eligible_for_packs: boolean;
}
export interface Requirement {
  variant_id: string;
  /** Base alternatives share the same numbered-card key; master is exact variant. */
  collectible_key: string;
  scope: Goal;
  rationale: string;
}
export interface Manifest {
  set_id: string;
  version: string;
  validated: boolean;
  /** Unsupported scopes are null/incomplete, never an invented 100%. */
  supported_goals: readonly Goal[];
  requirements: readonly Requirement[];
}
export interface InventoryEntry {
  variant_id: string;
  quantity: number;
}

export function validateManifest(
  manifest: Manifest,
  variants: readonly Variant[],
): void {
  if (!manifest.version.trim() || !manifest.set_id || !manifest.validated) {
    throw new Error("INCOMPLETE_MANIFEST");
  }
  const indexed = new Map(variants.map((v) => [v.id, v]));
  if (indexed.size !== variants.length) throw new Error("DUPLICATE_VARIANT");
  if (
    new Set(manifest.supported_goals).size !== manifest.supported_goals.length
  )
    throw new Error("DUPLICATE_GOAL");
  const seen = new Set<string>();
  const baseGroups = new Map<string, string>();
  const baseNumbers = new Map<string, string>();
  for (const requirement of manifest.requirements) {
    const variant = indexed.get(requirement.variant_id);
    if (!variant || variant.set_id !== manifest.set_id)
      throw new Error("INVALID_VARIANT");
    if (!manifest.supported_goals.includes(requirement.scope))
      throw new Error("UNSUPPORTED_GOAL");
    if (!requirement.rationale.trim() || !requirement.collectible_key.trim())
      throw new Error("INVALID_REQUIREMENT");
    const key = `${requirement.scope}:${requirement.variant_id}`;
    if (seen.has(key)) throw new Error("DUPLICATE_REQUIREMENT");
    seen.add(key);
    if (requirement.scope === "base") {
      const number = `${variant.set_id}:${variant.card_number}`;
      if (
        (baseGroups.has(requirement.collectible_key) &&
          baseGroups.get(requirement.collectible_key) !== number) ||
        (baseNumbers.has(number) &&
          baseNumbers.get(number) !== requirement.collectible_key)
      )
        throw new Error("INVALID_BASE_GROUP");
      baseGroups.set(requirement.collectible_key, number);
      baseNumbers.set(number, requirement.collectible_key);
    }
  }
  // A supported empty scope must not become a vacuous completion claim.
  for (const goal of manifest.supported_goals) {
    if (!manifest.requirements.some((r) => r.scope === goal))
      throw new Error("EMPTY_GOAL");
  }
  // An exact variant is one master/extended requirement. Grouped alternatives are Base-only.
  for (const goal of ["master", "extended"] as const) {
    const required = manifest.requirements.filter((r) => r.scope === goal);
    if (
      new Set(required.map((r) => r.collectible_key)).size !== required.length
    ) {
      throw new Error("VARIANT_GOAL_MUST_BE_EXACT");
    }
  }
}

export function inventoryQuantities(
  entries: readonly InventoryEntry[],
  variants: readonly Variant[],
): Map<string, number> {
  const known = new Set(variants.map((v) => v.id));
  const quantities = new Map<string, number>();
  for (const entry of entries) {
    if (!known.has(entry.variant_id)) throw new Error("INVALID_VARIANT");
    if (!Number.isSafeInteger(entry.quantity) || entry.quantity < 0)
      throw new Error("INVALID_QUANTITY");
    const next = (quantities.get(entry.variant_id) ?? 0) + entry.quantity;
    if (!Number.isSafeInteger(next)) throw new Error("INVALID_QUANTITY");
    quantities.set(entry.variant_id, next);
  }
  return quantities;
}

export function collectionProgress(
  mode: Mode,
  manifest: Manifest,
  variants: readonly Variant[],
  entries: readonly InventoryEntry[],
) {
  validateManifest(manifest, variants);
  const quantities = inventoryQuantities(entries, variants);
  const goalProgress = (goal: Goal) => {
    if (!manifest.supported_goals.includes(goal)) return null;
    const groups = new Map<string, boolean>();
    for (const requirement of manifest.requirements.filter(
      (r) => r.scope === goal,
    )) {
      groups.set(
        requirement.collectible_key,
        (groups.get(requirement.collectible_key) ?? false) ||
          (quantities.get(requirement.variant_id) ?? 0) > 0,
      );
    }
    return {
      collected: [...groups.values()].filter(Boolean).length,
      required: groups.size,
    };
  };
  return {
    set_id: manifest.set_id,
    mode,
    manifest_version: manifest.version,
    base: goalProgress("base"),
    master: goalProgress("master"),
    extended: goalProgress("extended"),
  };
}

/** Base exports one row per missing numbered card, with eligible alternatives listed. */
export function missingChecklist(
  goal: Goal,
  manifest: Manifest,
  variants: readonly Variant[],
  entries: readonly InventoryEntry[],
) {
  validateManifest(manifest, variants);
  if (!manifest.supported_goals.includes(goal))
    throw new Error("INCOMPLETE_GOAL");
  const quantities = inventoryQuantities(entries, variants);
  const groups = new Map<string, string[]>();
  for (const requirement of manifest.requirements.filter(
    (r) => r.scope === goal,
  )) {
    const group = groups.get(requirement.collectible_key) ?? [];
    group.push(requirement.variant_id);
    groups.set(requirement.collectible_key, group);
  }
  return [...groups.entries()]
    .filter(([, ids]) => ids.every((id) => !(quantities.get(id) ?? 0)))
    .map(([collectible_key, variant_ids]) => ({
      collectible_key,
      variant_ids: [...variant_ids].sort(),
    }))
    .sort((a, b) =>
      a.collectible_key.localeCompare(b.collectible_key, "en", {
        numeric: true,
      }),
    );
}

/** Quoting plus formula neutralization for spreadsheet applications, including leading controls. */
export function csvCell(value: string | number): string {
  const raw = String(value);
  const safe = /^[\s\u0000-\u001f]*[=+@-]/u.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function missingCsv(
  goal: Goal,
  manifest: Manifest,
  variants: readonly Variant[],
  entries: readonly InventoryEntry[],
  mode?: Mode,
): string {
  const missing = missingChecklist(goal, manifest, variants, entries);
  const indexed = new Map(variants.map((v) => [v.id, v]));
  const rows: (string | number)[][] = [
    [
      "set_id",
      "manifest_version",
      "goal",
      "collectible_key",
      "eligible_variant_ids",
      "names",
      "finishes",
    ],
  ];
  for (const item of missing) {
    const eligible = item.variant_ids.map((id) => indexed.get(id)!);
    rows.push([
      manifest.set_id,
      manifest.version,
      goal,
      item.collectible_key,
      item.variant_ids.join(" | "),
      eligible.map((v) => v.card_name).join(" | "),
      eligible.map((v) => v.finish).join(" | "),
    ]);
  }
  return (
    rows
      .map((row, index) =>
        (mode ? [index === 0 ? "mode" : mode, ...row] : row)
          .map(csvCell)
          .join(","),
      )
      .join("\r\n") + "\r\n"
  );
}

export function validateRealEdit(
  variantId: string,
  quantity: number,
  notes: string,
  variants: readonly Variant[],
) {
  if (!variants.some((v) => v.id === variantId))
    throw new Error("INVALID_VARIANT");
  if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 9999)
    throw new Error("INVALID_QUANTITY");
  if (
    typeof notes !== "string" ||
    notes.length > 500 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(notes)
  ) {
    throw new Error("INVALID_NOTES");
  }
  return { card_variant_id: variantId, quantity, notes: notes.trim() };
}
