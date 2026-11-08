import { Hero, HeroSkeleton } from "./kit-parts";
import type { ComparisonPairProps } from "./types";

/** C04: today in the category colour on the left, the reference in grey on the right. */
export const ComparisonPair = ({
  category,
  state = "default",
  today,
  reference,
}: ComparisonPairProps) => (
  <div className="grid grid-cols-2 gap-4" data-state={state}>
    {state === "loading" ? (
      <>
        <HeroSkeleton />
        <HeroSkeleton />
      </>
    ) : (
      <>
        <Hero
          hero={state === "empty" ? { ...today, value: "–" } : today}
          category={category}
        />
        <Hero hero={reference} category={category} reference />
      </>
    )}
  </div>
);
