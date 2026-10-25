import { ConnectorCard } from "./connector-card";
import type { ConnectorSetupView } from "./connector-setup";
import { connectorBadge } from "./connector-status";
import { guidelineDetail, type GuidelineCorpusStatus } from "./guideline-status-view";
import { SetupDisclosure } from "./setup-disclosure";

type GuidelinesCardProps = Readonly<{
  status: GuidelineCorpusStatus;
  setup: ConnectorSetupView;
}>;

/** The local guideline index: counts only, read on the server. */
export const GuidelinesCard = ({ status, setup }: GuidelinesCardProps) => (
  <ConnectorCard
    name="Guidelines"
    purpose="Published guideline passages as reference material, searched on this machine. Not a statement about a person."
    badge={connectorBadge({
      configured: status.state !== "empty",
      connected: status.state === "ok",
      failed: status.state === "error",
    })}
    detail={
      status.state === "empty"
        ? "No guidelines indexed yet. See Setup."
        : guidelineDetail(status)
    }
    notice={
      status.state === "error"
        ? { text: "Couldn’t read the guideline index. Try again later.", tone: "warn" }
        : null
    }
    setup={<SetupDisclosure setup={setup} />}
  />
);
