import {
  serviceDatabase,
  schedule,
  ingestOne,
} from "../../packages/domain/src/workers";
const db = serviceDatabase();
if (process.argv.includes("--schedule"))
  console.log(JSON.stringify({ scheduled: await schedule(db) }));
else {
  const adapters = new Map(); // Register only reviewed, credentialed adapters here. No retailer integration is approved.
  let processed = 0;
  while (processed < 25 && (await ingestOne(db, adapters))) processed++;
  console.log(JSON.stringify({ processed }));
}
