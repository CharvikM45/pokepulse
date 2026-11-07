"use client";
import { useEffect, useRef, useState } from "react";
import type { RadarStore } from "./local-radar";

export interface MapConfiguration {
  template: string;
  attribution: string;
  host: string;
}
export function StoreMap({
  stores,
  config,
}: {
  stores: readonly RadarStore[];
  config: MapConfiguration;
}) {
  const element = useRef<HTMLDivElement>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let map: import("maplibre-gl").Map | undefined;
    void import("maplibre-gl")
      .then((lib) => {
        if (!active || !element.current) return;
        const located = stores.filter(
          (store) => store.latitude !== null && store.longitude !== null,
        );
        const first = located[0];
        map = new lib.Map({
          container: element.current,
          center: first ? [first.longitude!, first.latitude!] : [0, 0],
          zoom: first ? 10 : 1,
          maxZoom: 18,
          fadeDuration: 0,
          attributionControl: { compact: false },
          transformRequest: (url) => {
            const parsed = new URL(url);
            if (parsed.protocol !== "https:" || parsed.hostname !== config.host)
              throw new Error("Unapproved tile host");
            return { url, credentials: "same-origin" };
          },
          style: {
            version: 8,
            sources: {
              directory: {
                type: "raster",
                tiles: [config.template],
                tileSize: 256,
                minzoom: 0,
                maxzoom: 18,
                attribution: config.attribution,
              },
            },
            layers: [{ id: "directory", type: "raster", source: "directory" }],
          },
        });
        map.on("error", () => {
          if (active) setFailed(true);
        });
        map.addControl(new lib.NavigationControl({ visualizePitch: false }));
        for (const store of located)
          new lib.Marker()
            .setLngLat([store.longitude!, store.latitude!])
            .setPopup(
              new lib.Popup().setText(
                `${store.name}${store.is_demo ? " — fictional demo" : ""}`,
              ),
            )
            .addTo(map);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      map?.remove();
    };
  }, [stores, config]);
  return (
    <section aria-label="Public store directory map">
      <p>
        Map of public store coordinates. Use the store list below for reports
        and directions. No reporter locations are shown.
      </p>
      <div ref={element} style={{ height: 360, maxWidth: "100%" }} />
      {failed && (
        <p role="status">Map tiles could not load. Use the store list.</p>
      )}
    </section>
  );
}
