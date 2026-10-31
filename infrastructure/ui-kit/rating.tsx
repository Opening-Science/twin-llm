"use client";

import { useRef, useState } from "react";

import { cn } from "@/infrastructure/ui";

import { StarIcon } from "./icons";
import { DEFAULT_RATING_LABELS, ratingKey, ratingText } from "./rating-model";

/**
 * A 1 to 5 rating as a radio group (for blinded review of answers). Each
 * star is a radio named by its number and label; one of them is in the Tab
 * order (the chosen one, else the first). Arrows move, Home and End jump,
 * Backspace or Delete clears. A mouse previews a value before it is pressed.
 * `readOnly` shows a value that cannot be changed.
 *
 * Controlled: the caller owns `value` (null for not rated yet).
 */

export type RatingProps = Readonly<{
  /** The group's accessible name: "Accuracy". */
  label: string;
  value: number | null;
  onChange?: (value: number | null) => void;
  labels?: readonly string[];
  readOnly?: boolean;
  className?: string;
}>;

export const Rating = ({
  label,
  value,
  onChange,
  labels = DEFAULT_RATING_LABELS,
  readOnly = false,
  className,
}: RatingProps) => {
  const max = labels.length;
  const [preview, setPreview] = useState<number | null>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const shown = readOnly ? value : (preview ?? value);
  const tabStop = value ?? 1;

  const choose = (next: number | null) => {
    if (readOnly) return;
    onChange?.(next);
    if (next !== null) items.current[next - 1]?.focus();
  };

  return (
    <div className={cn("rating", className)} data-readonly={readOnly ? "" : undefined}>
      <div
        role="radiogroup"
        aria-label={label}
        aria-readonly={readOnly || undefined}
        className="rating-items"
        onPointerLeave={() => setPreview(null)}
      >
        {labels.map((text, index) => {
          const n = index + 1;
          return (
            <button
              key={text}
              ref={(element) => {
                items.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n} of ${max}: ${text}`}
              tabIndex={n === tabStop ? 0 : -1}
              data-on={shown !== null && n <= shown ? "" : undefined}
              className="rating-item"
              onClick={() => choose(n)}
              onKeyDown={(event) => {
                const next = ratingKey(event.key, value, max);
                if (next === undefined) return;
                event.preventDefault();
                choose(next);
              }}
              onPointerEnter={(event) => {
                if (!readOnly && event.pointerType === "mouse") setPreview(n);
              }}
            >
              <StarIcon filled={shown !== null && n <= shown} className="size-5" />
            </button>
          );
        })}
      </div>
      <span className="rating-text" aria-hidden="true">
        {ratingText(shown, labels)}
      </span>
    </div>
  );
};
