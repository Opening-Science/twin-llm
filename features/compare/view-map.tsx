"use client";

import { Choropleth } from "@/infrastructure/charts/choropleth";
import type { ChoroplethSpec } from "@/infrastructure/chat-view";

/**
 * A population estimate by place (SPEC 5.5), drawn by the shared choropleth
 * with its own legend, top-10 list, tooltip, screen-reader table and
 * keyboard listbox. Places that matched no boundary are listed by it.
 */
export const MapView = ({
  title,
  spec,
}: Readonly<{ title: string; spec: ChoroplethSpec }>) => (
  <Choropleth
    title={title}
    unit={spec.unit}
    measure={spec.measure}
    level={spec.level}
    country={spec.country}
    layer={spec.layer ?? null}
    regions={spec.regions}
    unmatched={spec.unmatched}
  />
);
