import { z } from "zod";
export const permissionSchema = z.object({
  status: z.enum([
    "not_evaluated",
    "candidate",
    "approved",
    "denied",
    "suspended",
  ]),
  enabled: z.boolean(),
  reviewer: z.string().min(1).nullable(),
  evidence_url: z.url().nullable(),
});
/** Credentials alone cannot grant permission. Invalid config always fails closed. */
export function canCheckProvider(
  config: unknown,
  credential: string | undefined,
): boolean {
  const parsed = permissionSchema.safeParse(config);
  return (
    parsed.success &&
    parsed.data.status === "approved" &&
    parsed.data.enabled &&
    !!parsed.data.reviewer &&
    !!parsed.data.evidence_url &&
    !!credential?.trim()
  );
}
export const featureFlags = Object.freeze({
  retailer_verification: false,
  local_radar: false,
  web_push: false,
  calendar: false,
  pack_lab: false,
  licensed_card_art: false,
});
