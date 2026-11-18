/** Metadata refreshes must not undo operational artwork or simulator settings. */
export function metadataOnlyRow(
  table: string,
  row: Record<string, unknown>,
  existingSet = false,
) {
  const result = { ...row };
  if (table === "card_variants")
    for (const key of [
      "image_url",
      "image_rights_cleared",
      "eligible_for_packs",
    ])
      delete result[key];
  if (table === "tcg_sets" && existingSet)
    for (const key of [
      "rights_status",
      "enabled_for_simulation",
      "is_demo",
      "public_metadata_allowed",
    ])
      delete result[key];
  return result;
}
