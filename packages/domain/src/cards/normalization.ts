import { createHash } from "node:crypto";
export function providerIdentity(
  provider: string,
  language: string,
  kind: string,
  id: string,
) {
  if (
    !/^[a-z0-9_-]+$/.test(provider) ||
    !["en", "ja"].includes(language) ||
    !["card", "set", "artist", "variant"].includes(kind) ||
    !id ||
    id.length > 200
  )
    throw new Error("INVALID_PROVIDER_ID");
  const h = createHash("sha256")
    .update(JSON.stringify([provider, language, kind, id]))
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export { normalizedRarity } from "./rarity";
