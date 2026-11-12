import { ChartGroup } from "./chart-focus";
import { Hero, HeroSkeleton } from "./kit-parts";
import type { ComparisonPairProps } from "./types";

/**
 * C04: today in the category colour on the left, the reference in grey on
 * the right, as one group named after both ("Today and Average").
 */
export const ComparisonPair = ({
  category,
  state = "default",
  today,
  reference,
  label,
}: ComparisonPairProps) => (
  <ChartGroup
    label={label ?? `${today.label} and ${reference.label}`}
    className="grid grid-cols-2 gap-4"
    data-state={state}
  >
    {state === "loading" ? (
      <>
        <HeroSkeleton />
        <HeroSkeleton />
      </>
    ) : (
      <>
        <Hero pair hero={today} missing={state === "empty"} category={category} />
        <Hero pair hero={reference} category={category} reference />
      </>
    )}
  </ChartGroup>
);
