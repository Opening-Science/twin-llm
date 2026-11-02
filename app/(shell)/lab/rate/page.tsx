import {
  loadRaterLines,
  loadRaterSalt,
  loadRaterSession,
} from "@/features/lab/load-rater";
import { type RaterScreenState, RaterScreen } from "@/features/lab/rater-screen";
import { isPseudonym, type RatedSet, ratedSetOf } from "@/features/lab/rater-rubric";
import { isAuthDisabled } from "@/infrastructure/env";

const stateFor = async (
  set: RatedSet,
  rater: string | undefined,
): Promise<RaterScreenState> => {
  if (rater === undefined || !isPseudonym(rater)) {
    return { kind: "ask", invalid: rater !== undefined && rater !== "" };
  }
  const canSave = isAuthDisabled();
  const salt = await loadRaterSalt(set, rater, canSave);
  const data = await loadRaterLines(set, salt);
  if (data.kind !== "ready") return { kind: data.kind };
  return {
    kind: "rate",
    rater,
    runs: data.runs,
    lines: await loadRaterSession(set, data.lines, rater, salt),
    canSave,
  };
};

export default async function RatePage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const { rater, set } = await searchParams;
  const rated = ratedSetOf(set);
  if (rated === null) return <RaterScreen set="hb" state={{ kind: "unknown-set" }} />;
  return (
    <RaterScreen
      set={rated}
      state={await stateFor(rated, typeof rater === "string" ? rater : undefined)}
    />
  );
}
