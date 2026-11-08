/** Render plain dates without converting them to an instant in the viewer's time zone. */
export function releaseDateLabel(
  value: string,
  precision: "day" | "month" | "unconfirmed",
  locale = "en-US",
): string {
  if (precision === "unconfirmed") return "Date unconfirmed";
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  if (!match || (precision === "day" && !match[3]))
    throw new Error("INVALID_DATE");
  const year = Number(match[1]),
    month = Number(match[2]),
    day = match[3] ? Number(match[3]) : 1;
  if (year < 1000 || year > 9999) throw new Error("INVALID_DATE");
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new Error("INVALID_DATE");
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    ...(precision === "day" ? { day: "numeric" as const } : {}),
  }).format(date);
}
