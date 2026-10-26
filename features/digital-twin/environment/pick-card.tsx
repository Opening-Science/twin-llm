"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Vector3 } from "three";

import { Button } from "@/infrastructure/ui-kit/button";
import { type OrganStatus } from "@/packages/biomarkers/organ-map";

import { LAYER_LABEL, SYSTEM_LABEL } from "../anatomy/anatomy-copy";
import { PanelRowButton } from "../body-panel";
import { organStatusLine } from "../biomarkers/biomarker-copy";
import { type BiomarkerRow } from "../biomarkers/biomarker-rows";
import { type AnchorStore, cardPlacement } from "./card-anchor";
import {
  BODY_CARD_NOTE,
  BODY_CARD_TITLE,
  CARD_ATLAS_NOTE,
  CLOSE_CARD,
  LINKED_BIOMARKERS,
  NO_LINKED_BIOMARKERS,
} from "./environment-copy";
import { type Picked } from "./pick-part";

/**
 * Inside the canvas: projects the picked point every drawn frame into the
 * anchor store. Nothing draws just for this; it follows the camera only on
 * frames something else asked for.
 */
export const ProjectAnchor = ({
  point,
  store,
}: Readonly<{ point: Picked["point"] | null; store: AnchorStore }>) => {
  const invalidate = useThree((state) => state.invalidate);
  const world = useMemo(() => (point ? new Vector3(...point) : null), [point]);
  // A new pick needs one frame to be placed, even when nothing else changed.
  useEffect(() => {
    if (!world) store.set(null);
    invalidate();
  }, [world, store, invalidate]);
  useFrame(({ camera, size }) => {
    if (!world) return;
    // A walk moves the camera this frame; without this the dot trails a frame behind.
    camera.updateMatrixWorld();
    const ndc = world.clone().project(camera);
    store.set({
      x: ((ndc.x + 1) / 2) * size.width,
      y: ((1 - ndc.y) / 2) * size.height,
      width: size.width,
      height: size.height,
      behind: ndc.z > 1,
    });
  });
  return null;
};

export type PickCardProps = Readonly<{
  picked: Picked;
  /** Biomarker rows whose own highlight lights this part. */
  linked: readonly BiomarkerRow[];
  /** This organ's marker furthest from its published range, when the map has one. */
  organ: OrganStatus | null;
  selectedId: string | null;
  store: AnchorStore;
  /** null when the selected row is clicked again, as in the Biomarkers tab. */
  onSelectRow: (id: string | null) => void;
  onClose: () => void;
}>;

/** The lines under the title: system, layer and the ontology id, when there is one. */
export const cardFacts = (picked: Picked): readonly string[] => {
  const { target } = picked;
  if (target.kind !== "part") return [];
  return [
    SYSTEM_LABEL[target.system],
    LAYER_LABEL[target.layer],
    ...(target.ontologyId ? [target.ontologyId] : []),
  ];
};

/**
 * The card beside a picked part: what it is, where it comes from, and the
 * biomarkers linked to it (each selects its Biomarkers row, which lights the
 * row's own regions). Below 640 px it docks at the bottom (globals.css). It is
 * rendered beside the 3D view, not inside its `role="application"`, so screen
 * readers read it as text.
 */
export const PickCard = ({
  picked,
  linked,
  organ,
  selectedId,
  store,
  onSelectRow,
  onClose,
}: PickCardProps) => {
  const titleId = useId();
  const cardRef = useRef<HTMLElement | null>(null);
  const [cardHeight, setCardHeight] = useState(0);
  const anchor = useSyncExternalStore(store.subscribe, store.get, () => null);
  const place = cardPlacement(anchor, cardHeight);

  // The real height, so a tall card near the bottom edge is placed whole.
  useEffect(() => {
    const card = cardRef.current;
    if (!card || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setCardHeight(entry.borderBoxSize[0]?.blockSize ?? card.offsetHeight);
    });
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  // Escape closes the card first; the environment's own Escape skips a handled key.
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    card.addEventListener("keydown", onKey);
    return () => card.removeEventListener("keydown", onKey);
  }, [onClose]);
  const part = picked.target.kind === "part" ? picked.target : null;
  const facts = cardFacts(picked);
  return (
    <>
      {anchor && !anchor.behind ? (
        <span
          aria-hidden="true"
          className="twin-pick-dot"
          style={{ left: anchor.x, top: anchor.y }}
        />
      ) : null}
      <section
        ref={cardRef}
        role="group"
        aria-labelledby={titleId}
        className="twin-pick-card"
        style={{ left: place.left, top: place.top }}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 id={titleId} aria-live="polite" className="text-sm font-medium">
            {part ? part.label : BODY_CARD_TITLE}
          </h3>
          <Button size="sm" variant="ghost" aria-label={CLOSE_CARD} onClick={onClose}>
            ×
          </Button>
        </div>
        {facts.length > 0 ? (
          <p className="text-muted-foreground text-xs">{facts.join(" · ")}</p>
        ) : null}
        <p className="text-muted-foreground text-[11px] leading-snug">
          {part ? CARD_ATLAS_NOTE : BODY_CARD_NOTE}
        </p>
        {part ? (
          <>
            {organ ? <p className="text-xs">{organStatusLine(organ)}</p> : null}
            <h4 className="mt-1 text-xs font-medium">{LINKED_BIOMARKERS}</h4>
            {linked.length === 0 ? (
              <p className="text-muted-foreground text-xs">{NO_LINKED_BIOMARKERS}</p>
            ) : (
              <ul className="max-h-48 overflow-y-auto overscroll-contain">
                {linked.map((row) => (
                  <li key={row.id}>
                    <PanelRowButton
                      row={row}
                      selected={row.id === selectedId}
                      onSelect={onSelectRow}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </section>
    </>
  );
};
