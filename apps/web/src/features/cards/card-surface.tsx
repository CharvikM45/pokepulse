"use client";
import { useRef } from "react";
import type { Variant } from "../../../../../packages/domain/src/collections/policies";
import { CardArtwork } from "../binder/card-artwork";
export function CardSurface({
  variant,
  rarity,
}: {
  variant: Variant;
  rarity?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className="pp-foil-surface"
      data-rarity={rarity ?? "unknown"}
      onPointerMove={(event) => {
        if (
          event.pointerType !== "mouse" ||
          matchMedia("(prefers-reduced-motion: reduce)").matches
        )
          return;
        const box = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - box.left) / box.width - 0.5,
          y = (event.clientY - box.top) / box.height - 0.5;
        event.currentTarget.style.setProperty("--tilt-x", `${-y * 8}deg`);
        event.currentTarget.style.setProperty("--tilt-y", `${x * 8}deg`);
        event.currentTarget.style.setProperty(
          "--shine-x",
          `${(x + 0.5) * 100}%`,
        );
      }}
      onPointerLeave={() => {
        ref.current?.style.setProperty("--tilt-x", "0deg");
        ref.current?.style.setProperty("--tilt-y", "0deg");
      }}
    >
      <CardArtwork variant={variant} allowDemoScan={false} />
      <span className="pp-foil-shine" aria-hidden="true" />
    </div>
  );
}
