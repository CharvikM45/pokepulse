import {
  serviceDatabase,
  matchOne,
  deliverOne,
  privacyOne,
  retention,
} from "../../packages/domain/src/workers";
import { collectorPrivacy } from "../../packages/domain/src/collections/privacy";
const db = serviceDatabase();
const mode = process.argv[2] ?? "match";
let processed = 0;
if (mode === "retention") await retention(db);
else {
  if (mode === "match") {
    const result = await db.rpc("b_dispatch_sighting_outbox", { p_limit: 100 });
    if (result.error) throw new Error("B_OUTBOX_DISPATCH_FAILED");
  }
  const run =
    mode === "push"
      ? deliverOne
      : mode === "privacy"
        ? () => privacyOne(db, collectorPrivacy(db))
        : () =>
            matchOne(db, async (from, to) => {
              const result = await db.rpc("b_zip_distance", {
                p_from: from,
                p_to: to,
              });
              if (result.error) throw new Error("ZIP_DISTANCE_UNAVAILABLE");
              return typeof result.data === "number" ? result.data : null;
            });
  while (processed < 25 && (await run(db))) processed++;
}
console.log(JSON.stringify({ mode, processed }));
