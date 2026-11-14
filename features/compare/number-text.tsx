"use client";

import { Fragment, useMemo } from "react";

import type { NumberSource } from "@/infrastructure/number-sources";
import { type DecorateText, RichText } from "@/infrastructure/rich-text";

import { type NumberLink, numberLinks, splitNumbers } from "./number-links";
import { cardTitleId } from "./tool-steps";

/**
 * A finished answer's text with every number a tool call returned as a quiet
 * button (SPEC 5.4), described by the titles of the cards that hold it.
 * Pressing it (click or Enter) hands the number to the column, which opens
 * those cards.
 */
export const NumberText = ({
  text,
  sources,
  prefix,
  cardIds,
  onPress,
}: Readonly<{
  text: string;
  sources: readonly NumberSource[];
  /** The column's id prefix, as the tool steps use it. */
  prefix: string;
  /** The answer's card ids; a number links only to calls it has a card for. */
  cardIds: readonly string[];
  onPress: (link: NumberLink) => void;
}>) => {
  const links = useMemo(() => {
    const known = new Set(cardIds);
    const shown = sources.filter((source) => known.has(source.toolCallId));
    return numberLinks(shown);
  }, [sources, cardIds]);

  const decorate: DecorateText = (run, key) =>
    splitNumbers(run, links).map((piece, index) =>
      piece.kind === "text" ? (
        <Fragment key={`${key}-${String(index)}`}>{piece.text}</Fragment>
      ) : (
        <button
          key={`${key}-${String(index)}`}
          type="button"
          className="compare-number-link"
          aria-describedby={piece.link.callIds
            .map((callId) => cardTitleId(prefix, callId))
            .join(" ")}
          onClick={() => onPress(piece.link)}
        >
          {piece.text}
        </button>
      ),
    );

  return <RichText text={text} decorate={decorate} />;
};
