import { globSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { sourceLiterals } from "./source-literals";
import {
  providerIdentity,
  normalizedRarity,
} from "../../../packages/domain/src/cards/normalization";
import { supportedCardLanguages } from "../../../packages/contracts/src/cards";
// A source checkout and its pinned git revision are explicit inputs. No downloaded code is run.
const [input, output, revision] = process.argv.slice(2);
if (!input || !output || !/^[a-f0-9]{40}$/.test(revision ?? ""))
  throw new Error("SOURCE_CHECKOUT_OUTPUT_AND_REVISION_REQUIRED");
const root = resolve(input),
  read = sourceLiterals(root),
  now = new Date().toISOString();
if (
  execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim() !== revision ||
  execFileSync(
    "git",
    ["-C", root, "status", "--porcelain", "--untracked-files=no"],
    { encoding: "utf8" },
  ).trim()
)
  throw new Error("SOURCE_REVISION_MISMATCH_OR_DIRTY_CHECKOUT");
const licence = readFileSync(resolve(root, "LICENSE"), "utf8");
if (!licence.includes("MIT License") || !licence.includes("TCGdex"))
  throw new Error("SOURCE_LICENSE_REVIEW_REQUIRED");
type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {};
const local = (v: unknown, l: string): string | null =>
  typeof v === "string"
    ? v
    : typeof obj(v)[l] === "string"
      ? (obj(v)[l] as string)
      : null;
const sets = new Map<string, Raw>(),
  cards: Raw[] = [],
  variants: Raw[] = [],
  artists = new Map<string, Raw>(),
  credits: Raw[] = [],
  errors: Raw[] = [],
  counts: Record<string, number> = {};
const localized = (v: unknown, l: string): unknown =>
  Array.isArray(v)
    ? v.map((x) => localized(x, l))
    : v && typeof v === "object"
      ? Object.keys(obj(v)).some((k) =>
          supportedCardLanguages.includes(
            k as (typeof supportedCardLanguages)[number],
          ),
        )
        ? local(v, l)
        : Object.fromEntries(
            Object.entries(obj(v)).map(([k, x]) => [k, localized(x, l)]),
          )
      : v;
for (const file of globSync(["data/**/*.ts", "data-asia/**/*.ts"], {
  cwd: root,
}).sort()) {
  try {
    const c = obj(read(resolve(root, file))),
      set = obj(c.set),
      serie = obj(set.serie);
    if (!c.set || serie.id === "tcgp") continue;
    const localId = basename(file, ".ts"),
      external = `${set.id}-${localId}`;
    for (const language of supportedCardLanguages) {
      const name = local(c.name, language),
        setName = local(set.name, language);
      if (!name || !setName) continue;
      const set_id = providerIdentity(
          "tcgdex",
          language,
          "set",
          String(set.id),
        ),
        id = providerIdentity("tcgdex", language, "card", external);
      const date = local(set.releaseDate, language);
      sets.set(set_id, {
        id: set_id,
        name: setName,
        provider_id: "tcgdex",
        provider_set_id: set.id,
        language,
        region: null,
        series: local(serie.name, language),
        release_date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
        release_precision:
          date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? "day" : "unknown",
        metadata_source: `TCGdex metadata source ${revision}`,
        metadata_permission_evidence_url: `https://github.com/tcgdex/cards-database/blob/${revision}/LICENSE`,
        metadata_permission_checked_at: now,
        source_url: `https://api.tcgdex.net/v2/${language}/sets/${set.id}`,
        synchronized_at: now,
        rights_status: "metadata_only",
        enabled_for_simulation: false,
        is_demo: false,
        public_metadata_allowed: false,
      });
      const illustrator =
        typeof c.illustrator === "string" ? c.illustrator.trim() : null;
      const rarity = typeof c.rarity === "string" ? c.rarity : null;
      const card = {
        id,
        set_id,
        provider_id: "tcgdex",
        provider_card_id: external,
        language,
        card_name: name,
        card_number: localId,
        category: local(c.category, language),
        stage: local(c.stage, language),
        hp:
          typeof c.hp === "number" && Number.isInteger(c.hp) && c.hp >= 0
            ? c.hp
            : null,
        types: Array.isArray(c.types) ? c.types : [],
        pokedex_numbers: Array.isArray(c.dexId)
          ? c.dexId.filter(
              (n) =>
                typeof n === "number" &&
                Number.isInteger(n) &&
                n > 0 &&
                n < 10000,
            )
          : [],
        artists: illustrator ? [illustrator] : [],
        rarity_original: rarity,
        rarity_normalized: normalizedRarity(rarity),
        source_url: `https://api.tcgdex.net/v2/${language}/cards/${external}`,
        synchronized_at: now,
        metadata: {
          source_revision: revision,
          provider_pokedex_ids: c.dexId ?? [],
          source_file: file,
          regulation: local(c.regulationMark, language),
          variant_availability: Array.isArray(c.variants)
            ? null
            : (c.variants ?? null),
          attacks: localized(c.attacks ?? [], language),
          abilities: localized(c.abilities ?? [], language),
        },
      };
      cards.push(card);
      counts[language] = (counts[language] ?? 0) + 1;
      if (illustrator) {
        const artist_id = providerIdentity(
          "tcgdex",
          "en",
          "artist",
          illustrator,
        );
        artists.set(illustrator, { id: artist_id, name: illustrator });
        credits.push({ card_id: id, artist_id });
      }
      let rawVariants: Raw[] = Array.isArray(c.variants)
        ? c.variants.map(obj)
        : Object.entries(obj(c.variants))
            .filter(
              ([finish, on]) =>
                on === true && ["normal", "holo", "reverse"].includes(finish),
            )
            .map(([type]) => ({ type }));
      rawVariants = rawVariants.filter(
        (raw) =>
          !Array.isArray(raw.languages) || raw.languages.includes(language),
      );
      if (!rawVariants.length) rawVariants.push({ type: "unspecified" });
      const seen = new Set<string>();
      for (const raw of rawVariants) {
        const { thirdParty: ignored, ...markers } = raw;
        void ignored;
        const finish = String(raw.type ?? "unspecified");
        const editionLabel = [
          raw.subtype,
          ...(Array.isArray(raw.stamp) ? [...raw.stamp].sort() : []),
          raw.foil,
          raw.size && raw.size !== "standard" ? raw.size : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const identity = JSON.stringify([finish, editionLabel]);
        const labelHash = createHash("sha256")
          .update(identity)
          .digest("hex")
          .slice(0, 12);
        const edition =
          editionLabel.length <= 80
            ? editionLabel
            : editionLabel.slice(0, 64) + " · " + labelHash;
        if (seen.has(identity)) continue;
        seen.add(identity);
        const hash = createHash("sha256").update(identity).digest("hex");
        variants.push({
          id: providerIdentity(
            "tcgdex",
            language,
            "variant",
            edition ? `${external}:${hash}` : `${external}:${finish}`,
          ),
          card_id: id,
          set_id,
          finish,
          edition,
          print_markers: markers,
          rarity,
          eligible_for_packs: false,
          image_url: null,
          image_rights_cleared: false,
        });
      }
    }
  } catch (e) {
    errors.push({
      file,
      error: e instanceof Error ? e.message : "SOURCE_ERROR",
    });
  }
}
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, "LICENSE.tcgdex.txt"), licence);
writeFileSync(
  resolve(output, "summary.json"),
  JSON.stringify(
    {
      revision,
      generated_at: now,
      counts,
      sets: sets.size,
      cards: cards.length,
      variants: variants.length,
      artists: artists.size,
      errors,
    },
    null,
    2,
  ),
);
if (errors.length) throw new Error(`SOURCE_ERRORS:${errors.length}`);
const tables: { name: string; rows: Raw[] }[] = [
  { name: "tcg_sets", rows: [...sets.values()] },
  { name: "card_artists", rows: [...artists.values()] },
  { name: "cards", rows: cards },
  { name: "card_variants", rows: variants },
  { name: "card_artist_credits", rows: credits },
];
for (const { name, rows } of tables)
  writeFileSync(
    resolve(output, `${name}.jsonl`),
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
console.log(
  JSON.stringify({
    cards: cards.length,
    sets: sets.size,
    variants: variants.length,
    counts,
  }),
);
