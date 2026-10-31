import {
  loadRaterLines,
  loadRaterSalt,
  loadRaterSession,
} from "@/features/lab/load-rater";
import { type RaterScreenState, RaterScreen } from "@/features/lab/rater-screen";
import { isPseudonym } from "@/features/lab/rater-rubric";
import { isAuthDisabled } from "@/infrastructure/env";

const stateFor = async (rater: string | undefined): Promise<RaterScreenState> => {
  if (rater === undefined || !isPseudonym(rater)) {
    return { kind: "ask", invalid: rater !== undefined && rater !== "" };
  }
  const canSave = isAuthDisabled();
  const salt = await loadRaterSalt(rater, canSave);
  const data = await loadRaterLines(salt);
  if (data.kind !== "ready") return { kind: data.kind };
  return {
    kind: "rate",
    rater,
    runs: data.runs,
    lines: await loadRaterSession(data.lines, rater, salt),
    canSave,
  };
};

export default async function RatePage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const { rater } = await searchParams;
  return (
    <RaterScreen state={await stateFor(typeof rater === "string" ? rater : undefined)} />
  );
}
