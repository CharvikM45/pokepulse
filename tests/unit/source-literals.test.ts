import { afterEach, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourceLiterals } from "../../services/ingestion/cards/source-literals";
const directories: string[] = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "pokepulse-source-"));
  directories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
it("reads source metadata, explicit TypeScript imports and literal text concatenation without executing code", () => {
  const root = fixture();
  writeFileSync(
    join(root, "set.ts"),
    'const set = {id:"base1", name:{en:"Base Set"}}; export default set',
  );
  writeFileSync(
    join(root, "card.ts"),
    'import Set from "./set.ts"; const card={set:Set,name:{en:"Char" + "izard"},hp:120,variants:[{type:"holo",subtype:"shadowless",stamp:["1st-edition"]}]}; export default card',
  );
  expect(sourceLiterals(root)(join(root, "card.ts"))).toMatchObject({
    set: { id: "base1" },
    name: { en: "Charizard" },
    variants: [{ type: "holo", subtype: "shadowless", stamp: ["1st-edition"] }],
  });
});
it("rejects executable expressions and paths outside the metadata checkout", () => {
  const root = fixture();
  writeFileSync(
    join(root, "unsafe.ts"),
    "const card={name:process.exit(9)}; export default card",
  );
  expect(() => sourceLiterals(root)(join(root, "unsafe.ts"))).toThrow(
    "NON_LITERAL_SOURCE",
  );
  expect(() => sourceLiterals(root)(join(root, "../outside.ts"))).toThrow(
    "SOURCE_PATH_ESCAPE",
  );
});
