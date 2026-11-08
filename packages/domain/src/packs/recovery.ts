import { uuidValue } from "../radar/policies";
/** Private browser recovery reference, not a wire contract or a saved card result. */
export interface PendingOpening {
  version: 1;
  key: string;
  body: { set_id: string; use_free_open: boolean };
}
export function recoveryKeys(verifiedUserId: string) {
  if (!uuidValue(verifiedUserId)) throw new Error("INVALID_USER_SCOPE");
  const prefix = `pokepulse:lab:v1:${verifiedUserId.toLowerCase()}`;
  return { pending: `${prefix}:pending`, opening: `${prefix}:opening` };
}
export function parsePendingOpening(raw: string | null): PendingOpening | null {
  if (raw === null || raw.length > 2048) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return null;
    const object = value as Record<string, unknown>;
    if (
      Object.keys(object).some(
        (key) => !["version", "key", "body"].includes(key),
      ) ||
      object.version !== 1 ||
      !uuidValue(object.key) ||
      typeof object.body !== "object" ||
      object.body === null ||
      Array.isArray(object.body)
    )
      return null;
    const body = object.body as Record<string, unknown>;
    if (
      Object.keys(body).some(
        (key) => !["set_id", "use_free_open"].includes(key),
      ) ||
      !uuidValue(body.set_id) ||
      typeof body.use_free_open !== "boolean"
    )
      return null;
    return {
      version: 1,
      key: object.key,
      body: { set_id: body.set_id, use_free_open: body.use_free_open },
    };
  } catch {
    return null;
  }
}
export function savedOpeningId(raw: string | null): string | null {
  return uuidValue(raw) ? raw : null;
}
