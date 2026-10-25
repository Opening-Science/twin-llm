import { CITE_ONLY_LICENCES, FULL_TEXT_LICENCES } from "./constants";
import type { GuidelineManifestEntry } from "./manifest";

export const FULL_TEXT_REFUSED = "GUIDELINE_FULL_TEXT_REFUSED" as const;

export class GuidelineLicenceError extends Error {
  readonly code = FULL_TEXT_REFUSED;

  constructor(message: string) {
    super(message);
    this.name = "GuidelineLicenceError";
  }
}

const isFullTextLicence = (licence: string): boolean =>
  (FULL_TEXT_LICENCES as readonly string[]).includes(licence);

const isCiteOnlyLicence = (licence: string): boolean =>
  (CITE_ONLY_LICENCES as readonly string[]).includes(licence);

export const assertIngestAllowed = (entry: GuidelineManifestEntry): void => {
  if (entry.ingestMode === "full_text") {
    if (!isFullTextLicence(entry.licence)) {
      throw new GuidelineLicenceError(
        `full_text ingest refused for ${entry.id}: licence ${entry.licence} is not an allowed CC class`,
      );
    }
    return;
  }
  if (entry.ingestMode === "cite_only") {
    if (!isCiteOnlyLicence(entry.licence) && !isFullTextLicence(entry.licence)) {
      throw new GuidelineLicenceError(
        `cite_only ingest refused for ${entry.id}: unknown licence ${entry.licence}`,
      );
    }
    return;
  }
  throw new GuidelineLicenceError(`unknown ingestMode for ${entry.id}`);
};
