"use client";

import Link from "next/link";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { cn } from "@/infrastructure/ui";

import {
  columnsForWidth,
  effectiveSpan,
  farthestCornerDistance,
  revealDelayMs,
  type BentoColumns,
  type BentoSpan,
} from "./bento-model";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * A grid of cards that measures its own width (4, 2 or 1 columns, see
 * `bento-model.ts`), with a pointer light, a click ring and a staggered
 * first reveal. The look lives in globals.css under "Bento grid".
 *
 * Effects never go through React state. The grid owns one set of pointer
 * listeners; a move only stores the point, and one animation frame writes
 * it to `--bento-x` and `--bento-y` on the grid. Each card knows its own
 * offset (`--bento-card-x`, `--bento-card-y`, written on resize and on
 * pointer entry), so CSS works out where the light falls in every card,
 * which is how the edges of neighbouring cards light up too. Listeners are
 * only attached while the grid is on screen and motion is allowed; a live
 * switch to reduced motion detaches them and clears any ring.
 *
 * Without script the grid is one column and every card is fully visible.
 */

const ColumnsContext = createContext<BentoColumns>(1);

const CARD_SELECTOR = ":scope > [data-bento-card]";
const RING_MS = 900;
/** Long enough for the last staggered card to finish rising in. */
const REVEAL_SETTLE_MS = 1200;

const cardsOf = (grid: HTMLElement): HTMLElement[] => [
  ...grid.querySelectorAll<HTMLElement>(CARD_SELECTOR),
];

/** Writes each card's offset and reveal delay. Layout reads only, no React. */
const placeCards = (grid: HTMLElement): void => {
  cardsOf(grid).forEach((card, index) => {
    card.style.setProperty("--bento-card-x", `${card.offsetLeft}px`);
    card.style.setProperty("--bento-card-y", `${card.offsetTop}px`);
    card.style.setProperty("--bento-delay", `${revealDelayMs(index)}ms`);
  });
};

const spawnRing = (grid: HTMLElement, layer: HTMLElement, x: number, y: number) => {
  const radius = farthestCornerDistance(
    { x, y },
    { width: grid.clientWidth, height: grid.clientHeight },
  );
  const ring = document.createElement("span");
  ring.className = "bento-ring";
  // One element made and styled outside React: it lives for one animation.
  Object.assign(ring.style, {
    left: `${x - radius}px`,
    top: `${y - radius}px`,
    width: `${radius * 2}px`,
    height: `${radius * 2}px`,
  });
  layer.append(ring);
  const animation = ring.animate(
    [
      { transform: "scale(0.02)", opacity: 0.7 },
      { transform: "scale(1)", opacity: 0 },
    ],
    { duration: RING_MS, easing: "cubic-bezier(0.2, 0.6, 0.3, 1)" },
  );
  animation.onfinish = () => ring.remove();
  animation.oncancel = () => ring.remove();
};

export type BentoGridProps = Readonly<{
  /** Names the group for screen readers. */
  label: string;
  className?: string;
  children: ReactNode;
}>;

export const BentoGrid = ({ label, className, children }: BentoGridProps) => {
  const gridRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<BentoColumns>(1);
  const reduced = useReducedMotion();

  // Measure before paint so the first client frame has the right columns.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      setColumns(columnsForWidth(grid.clientWidth));
      placeCards(grid);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (gridRef.current) placeCards(gridRef.current);
  }, [columns]);

  // Reveal: hide the cards only once script runs, then let them rise in the
  // first time the grid is on screen.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    if (reduced) {
      grid.dataset.bentoReveal = "done";
      return;
    }
    if (grid.dataset.bentoReveal === "done") return;
    grid.dataset.bentoReveal = "pending";
    let settle = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        grid.dataset.bentoReveal = "shown";
        settle = window.setTimeout(() => {
          grid.dataset.bentoReveal = "done";
        }, REVEAL_SETTLE_MS);
      },
      { threshold: 0.1 },
    );
    observer.observe(grid);
    return () => {
      observer.disconnect();
      window.clearTimeout(settle);
    };
  }, [reduced]);

  // Pointer light and click ring, only while on screen and motion is allowed.
  useEffect(() => {
    const grid = gridRef.current;
    const layer = layerRef.current;
    if (!grid || !layer || reduced) return;

    let frame = 0;
    let client: { x: number; y: number } | null = null;

    const flush = () => {
      frame = 0;
      if (!client) return;
      const rect = grid.getBoundingClientRect();
      grid.style.setProperty("--bento-x", `${client.x - rect.left}px`);
      grid.style.setProperty("--bento-y", `${client.y - rect.top}px`);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      client = { x: event.clientX, y: event.clientY };
      if (frame === 0) frame = requestAnimationFrame(flush);
    };
    const onEnter = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      placeCards(grid);
      grid.dataset.bentoLit = "";
      onMove(event);
    };
    const onLeave = () => {
      delete grid.dataset.bentoLit;
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const card = target?.closest<HTMLElement>("[data-bento-action]");
      if (!card || card.parentElement !== grid) return;
      const rect = grid.getBoundingClientRect();
      // A keyboard press has no pointer position: start from the card's centre.
      const fromKeyboard = event.detail === 0;
      const cardRect = card.getBoundingClientRect();
      const x = fromKeyboard ? cardRect.left + cardRect.width / 2 : event.clientX;
      const y = fromKeyboard ? cardRect.top + cardRect.height / 2 : event.clientY;
      spawnRing(grid, layer, x - rect.left, y - rect.top);
    };

    let attached = false;
    const attach = () => {
      if (attached) return;
      attached = true;
      grid.addEventListener("pointerenter", onEnter);
      grid.addEventListener("pointermove", onMove);
      grid.addEventListener("pointerleave", onLeave);
      grid.addEventListener("click", onClick);
    };
    const detach = () => {
      if (!attached) return;
      attached = false;
      grid.removeEventListener("pointerenter", onEnter);
      grid.removeEventListener("pointermove", onMove);
      grid.removeEventListener("pointerleave", onLeave);
      grid.removeEventListener("click", onClick);
      cancelAnimationFrame(frame);
      frame = 0;
      onLeave();
    };

    const visibility = new IntersectionObserver((entries) => {
      const onScreen = entries.some((entry) => entry.isIntersecting);
      if (onScreen) attach();
      else detach();
    });
    visibility.observe(grid);

    return () => {
      visibility.disconnect();
      detach();
      grid.style.removeProperty("--bento-x");
      grid.style.removeProperty("--bento-y");
      for (const animation of layer.getAnimations({ subtree: true })) {
        animation.cancel();
      }
      layer.replaceChildren();
    };
  }, [reduced]);

  return (
    <ColumnsContext.Provider value={columns}>
      <div
        ref={gridRef}
        role="group"
        aria-label={label}
        data-columns={columns}
        className={cn("bento", className)}
        style={{ "--bento-columns": columns } as CSSProperties}
      >
        {children}
        <div ref={layerRef} className="bento-ripples" aria-hidden />
      </div>
    </ColumnsContext.Provider>
  );
};

type CardAction =
  | Readonly<{ href: string; onClick?: never }>
  | Readonly<{ onClick: () => void; href?: never }>
  | Readonly<{ href?: never; onClick?: never }>;

export type BentoCardProps = Readonly<{
  /** Columns and rows on a wide grid; clamped on two columns, ignored on one. */
  span?: BentoSpan;
  className?: string;
  /** Accessible name for a card that is a link or button, when its text is long. */
  "aria-label"?: string;
  children: ReactNode;
}> &
  CardAction;

/**
 * One card. It is a link with `href`, a button with `onClick` (phrasing
 * content only, as inside any button) and a plain block otherwise; only
 * the first two send the click ring.
 */
export const BentoCard = ({
  span = { cols: 1, rows: 1 },
  className,
  children,
  href,
  onClick,
  "aria-label": ariaLabel,
}: BentoCardProps) => {
  const columns = useContext(ColumnsContext);
  const placed = effectiveSpan(span, columns);
  const style: CSSProperties = {
    gridColumn: `span ${placed.cols}`,
    gridRow: `span ${placed.rows}`,
  };
  const shared = {
    "data-bento-card": "",
    className: cn("bento-card", className),
    style,
  };
  if (href !== undefined) {
    return (
      <Link href={href} {...shared} data-bento-action="" aria-label={ariaLabel}>
        {children}
      </Link>
    );
  }
  if (onClick !== undefined) {
    return (
      <button
        type="button"
        {...shared}
        data-bento-action=""
        aria-label={ariaLabel}
        onClick={onClick}
      >
        {children}
      </button>
    );
  }
  return <div {...shared}>{children}</div>;
};
