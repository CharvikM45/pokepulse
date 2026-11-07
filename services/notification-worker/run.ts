import {
  serviceDatabase,
  matchOne,
  deliverOne,
  privacyOne,
  retention,
} from "../../packages/domain/src/workers";
const db = serviceDatabase();
const mode = process.argv[2] ?? "match";
let processed = 0;
if (mode === "retention") await retention(db);
else {
  const run =
    mode === "push" ? deliverOne : mode === "privacy" ? privacyOne : matchOne;
  while (processed < 25 && (await run(db))) processed++;
}
console.log(JSON.stringify({ mode, processed }));
