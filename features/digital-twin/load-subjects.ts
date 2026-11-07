import { isSubjectsPayload } from "./body-twin-payloads";
import { type BodyTwinSubject } from "./body-twin-types";

/**
 * The body viewer's BodyLoop subjects. With BodyLoop off (the server page
 * knows from the environment) nothing is asked, so the page makes no call
 * that can only answer 503; the demo subject still works. A refused or
 * unexpected answer (null or another shape) is no subjects too.
 */
export type LoadSubjectsDeps = Readonly<{
  bodyLoopConfigured: boolean;
  /** The subjects route's JSON body, or null when it refused. */
  fetchSubjects: () => Promise<unknown>;
}>;

export const loadSubjects = async (
  deps: LoadSubjectsDeps,
): Promise<readonly BodyTwinSubject[]> => {
  if (!deps.bodyLoopConfigured) return [];
  const body = await deps.fetchSubjects();
  return isSubjectsPayload(body) ? (body.subjects ?? []) : [];
};
