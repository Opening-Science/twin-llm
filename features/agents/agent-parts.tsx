import {
  EMPTY_VALUE,
  formatMeasure,
  formatRelative,
} from "@/infrastructure/format-measure";
import { StatusBadge } from "@/infrastructure/ui-kit/status-badge";

import { answersText, type AgentUsage, type RosterEntry } from "./roster";

/** Pieces the roster list and an agent's own page both show. Server-rendered. */

/** Whether the chat's picker lists the agent with the active provider, in words and a tone. */
export const offerLine = (
  offered: boolean,
): Readonly<{ text: string; tone: "ok" | "off" }> =>
  offered
    ? { text: "Offered here", tone: "ok" }
    : { text: "Not offered here", tone: "off" };

export const OfferBadge = ({ entry }: Readonly<{ entry: RosterEntry }>) => {
  const { text, tone } = offerLine(entry.offered);
  return <StatusBadge tone={tone}>{text}</StatusBadge>;
};

/** "Qwen3 8B" with its id, or why there is none. */
export const BaseModelText = ({ entry }: Readonly<{ entry: RosterEntry }>) =>
  entry.baseModel === null ? (
    <span className="text-muted-foreground">
      Not offered with this provider; prefers{" "}
      <span className="font-mono">{entry.modelPreference.join(", then ")}</span>
    </span>
  ) : (
    <>
      {entry.baseModel.name}
      {entry.baseModel.name === entry.baseModel.id ? null : (
        <span className="text-muted-foreground font-mono"> {entry.baseModel.id}</span>
      )}
    </>
  );

export const SkillText = ({ entry }: Readonly<{ entry: RosterEntry }>) =>
  entry.skillName === null ? (
    <span className="text-muted-foreground">None</span>
  ) : (
    <span className="font-mono">/{entry.skillName}</span>
  );

/** "12 answers, 4 through Auto · last 3 d ago". */
export const UsageText = ({ usage }: Readonly<{ usage: AgentUsage }>) => (
  <>
    {answersText(usage)}
    {usage.lastAt === null ? null : (
      <span className="text-muted-foreground">
        {" "}
        · last {formatRelative(usage.lastAt)}
      </span>
    )}
  </>
);

/** The summed cost of the answers; a dash when there are none to sum. */
export const costText = (usage: AgentUsage): string =>
  usage.answers === 0 ? EMPTY_VALUE : formatMeasure("costUsd", usage.costUsd);
