import type { Variant } from "../../../../../packages/domain/src/collections/policies";

const demoScans: Readonly<Record<string, string>> = {
  "20000000-0000-4000-8000-000000000001": "/cards/base1-58.webp",
  "20000000-0000-4000-8000-000000000002": "/cards/base1-58.webp",
  "20000000-0000-4000-8000-000000000003": "/cards/base2-51.webp",
  "20000000-0000-4000-8000-000000000004": "/cards/basep-8.webp",
  "20000000-0000-4000-8000-000000000005": "/cards/basep-1.webp",
};
export function CardArtwork({
  variant,
  allowDemoScan = true,
}: {
  allowDemoScan?: boolean;
  variant: Pick<
    Variant,
    "id" | "set_id" | "card_name" | "image_url" | "image_rights_cleared"
  >;
}) {
  const sample =
    allowDemoScan &&
    variant.set_id === "10000000-0000-4000-8000-000000000001" &&
    Object.hasOwn(demoScans, variant.id)
      ? demoScans[variant.id]
      : undefined;
  const approved =
    variant.image_rights_cleared && variant.image_url?.startsWith("https://")
      ? variant.image_url
      : undefined;
  const src = approved ?? sample;
  if (!src)
    return (
      <div className="pp-card-scan-unavailable">Card scan unavailable</div>
    );
  return (
    <figure className="pp-card-scan">
      {/* Native images support approved catalog hosts and the framework-independent binder harness. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={`${variant.card_name} card artwork`}
        width={245}
        height={337}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
      />
      {sample && !approved && (
        <figcaption>Illustrative scan · demo numbering and finishes</figcaption>
      )}
    </figure>
  );
}
