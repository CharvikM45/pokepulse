export function normalizedRarity(value: string | undefined | null) {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v.includes("special illustration") || v.includes("special art"))
    return "special_illustration_rare";
  if (v.includes("illustration") || v.includes("art rare"))
    return "illustration_rare";
  if (v.includes("ultra")) return "ultra_rare";
  if (v.includes("secret")) return "secret_rare";
  if (v.includes("uncommon")) return "uncommon";
  if (v.includes("common")) return "common";
  if (v.includes("rare")) return "rare";
  return "other";
}
