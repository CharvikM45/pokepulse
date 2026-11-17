/** Small, bounded RFC4180 parser for previewed copy-lot imports, including quoted commas/newlines. */
export function parseCopyCsv(text: string) {
  if (text.length > 32000)
    throw new Error("Import is limited to 32 KB and 100 rows per review.");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("CSV quote is not closed.");
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  const headers = rows.shift();
  if (
    !headers ||
    new Set(headers).size !== headers.length ||
    !headers.includes("variant_id") ||
    !headers.includes("quantity")
  )
    throw new Error("CSV needs unique variant_id and quantity columns.");
  const allowed = new Set([
    "id",
    "variant_id",
    "quantity",
    "condition",
    "grading_company",
    "grade",
    "acquired_on",
    "cost_minor",
    "currency",
    "notes",
    "binder",
    "page",
    "position",
  ]);
  if (headers.some((h) => !allowed.has(h)))
    throw new Error("Unknown CSV column.");
  if (rows.length > 100) throw new Error("Review up to 100 rows at a time.");
  return rows
    .filter((r) => r.some(Boolean))
    .map((r) => {
      if (r.length !== headers.length)
        throw new Error("CSV column count differs.");
      return Object.fromEntries(
        headers.map((h, i) => [
          h,
          ["quantity", "cost_minor", "page", "position"].includes(h)
            ? r[i] === ""
              ? null
              : Number(r[i])
            : r[i] === "" && ["acquired_on", "currency"].includes(h)
              ? null
              : r[i],
        ]),
      );
    });
}
