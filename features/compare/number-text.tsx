"use client";

import { Fragment, type ReactElement, useMemo } from "react";

import {
  type CiteToken,
  type ReferenceSource,
  sourcesByLabel,
  splitCites,
} from "@/infrastructure/claim-sources";
import type { NumberSource } from "@/infrastructure/number-sources";
import { type DecorateText, RichText } from "@/infrastructure/rich-text";

import { citeHref, citeTitle, INVENTED_CITE_LINE } from "./cite-links";
import { type NumberLink, numberLinks, splitNumbers } from "./number-links";
import { cardTitleId } from "./tool-steps";

/** One cited id: a link to its source, a label without one, or an id no search gave. */
const Cite = ({ token }: Readonly<{ token: CiteToken }>) => {
  if (token.kind === "unsupported") return <>{token.label}</>;
  if (token.kind === "invented") {
    return (
      <span className="compare-cite-missing" title={INVENTED_CITE_LINE}>
        {token.label}
        <span className="sr-only"> ({INVENTED_CITE_LINE})</span>
      </span>
    );
  }
  const title = citeTitle(token.source);
  const href = citeHref(token.source);
  return href === null ? (
    <span className="compare-cite-link" title={title}>
      {token.label}
      <span className="sr-only"> ({title})</span>
    </span>
  ) : (
    <a
      className="compare-cite-link"
      href={href}
      title={title}
      target="_blank"
      rel="noopener noreferrer"
    >
      {token.label}
      <span className="sr-only"> ({title}, opens in a new tab)</span>
    </a>
  );
};

/**
 * A finished answer's text with every number a tool call returned as a quiet
 * button (SPEC 5.4), described by the titles of the cards that hold it.
 * Pressing it (click or Enter) hands the number to the column, which opens
 * those cards. A bracketed source id the turn's searches returned links to
 * that source (#612).
 */
export const NumberText = ({
  text,
  sources,
  citeSources,
  prefix,
  cardIds,
  onPress,
}: Readonly<{
  text: string;
  sources: readonly NumberSource[];
  /** What the turn's literature searches returned (`referenceSources`). */
  citeSources: readonly ReferenceSource[];
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
  const cites = useMemo(() => sourcesByLabel(citeSources), [citeSources]);

  const numbers = (run: string, key: string): ReactElement[] =>
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

  const decorate: DecorateText = (run, key) =>
    splitCites(run, cites).flatMap((piece, index) =>
      piece.kind === "text"
        ? numbers(piece.text, `${key}-${String(index)}`)
        : [
            <Fragment key={`${key}-${String(index)}`}>
              [
              {piece.tokens.map((token, tokenIndex) => (
                <Fragment key={`${token.label}-${String(tokenIndex)}`}>
                  {tokenIndex > 0 ? ", " : null}
                  <Cite token={token} />
                </Fragment>
              ))}
              ]
            </Fragment>,
          ],
    );

  return <RichText text={text} decorate={decorate} />;
};
