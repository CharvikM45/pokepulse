import { z } from "zod";
import { collectorRequest } from "../../collector-contracts";
export const cardRequest = collectorRequest;
export const receipt = z.object({ id: z.uuid() });
export const queryString = (data: Record<string, unknown>) =>
  new URLSearchParams(
    Object.entries(data)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();
