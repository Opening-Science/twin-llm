import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";

import {
  consentFromRow,
  consentWording,
  distinctRows,
  grantProblem,
  isActiveAt,
  isSyntheticRow,
  type LearningConsent,
  learningAuditEvent,
  learningManifest,
  learningRefusalLine,
  type LearningRow,
  noConsentStore,
  orderedSources,
  permitLearningUse,
  requireLearningConsent,
  subjectRowsFrom,
  wordingSha256,
} from "./learning-consent";

const AT = new Date("2026-10-31T12:00:00Z");
const OWNER = "app-user-synthetic-1";

const consent = (overrides: Partial<LearningConsent> = {}): LearningConsent => ({
  id: "consent-1",
  userId: OWNER,
  scope: "training",
  sources: ["wearables", "chat"],
  wordingVersion: "learning-consent.v1",
  wordingSha256: "0".repeat(64),
  grantedAt: new Date("2026-10-01T09:00:00Z"),
  withdrawnAt: null,
  ...overrides,
});

const SYNTHETIC: LearningRow = {
  kind: "subject",
  cohortId: "synthea-v4-seed42",
  isSynthetic: true,
};
const WEARABLES: LearningRow = { kind: "personal", ownerId: OWNER, source: "wearables" };

describe("which rows are synthetic", () => {
  test("a flagged subject of a listed cohort is synthetic", () => {
    expect(isSyntheticRow(SYNTHETIC)).toBe(true);
  });
  test("an unflagged subject of a listed cohort is not", () => {
    expect(isSyntheticRow({ ...SYNTHETIC, isSynthetic: false })).toBe(false);
  });
  test("a flagged subject of an unlisted cohort is not", () => {
    expect(isSyntheticRow({ ...SYNTHETIC, cohortId: "my-own-records" })).toBe(false);
  });
  test("a personal row never is", () => {
    expect(isSyntheticRow(WEARABLES)).toBe(false);
  });
});

describe("permitLearningUse", () => {
  const decide = (rows: readonly LearningRow[], consents: readonly LearningConsent[]) =>
    permitLearningUse({ scope: "training", rows, consents, at: AT });

  test("synthetic rows pass with no consent and name none", () => {
    expect(decide([SYNTHETIC], [])).toEqual({
      ok: true,
      scope: "training",
      consentIds: [],
    });
  });

  test("no rows pass", () => {
    expect(decide([], [])).toEqual({ ok: true, scope: "training", consentIds: [] });
  });

  test("a non-synthetic subject is refused even with every consent", () => {
    expect(decide([{ ...SYNTHETIC, isSynthetic: false }], [consent()])).toEqual({
      ok: false,
      scope: "training",
      code: "SOURCE_NOT_SYNTHETIC",
      message:
        'A subject in cohort "synthea-v4-seed42" is not marked synthetic or its cohort is not a listed synthetic cohort, and it has no owner who could consent.',
    });
  });

  test("a personal row without any consent is refused as missing", () => {
    expect(decide([SYNTHETIC, WEARABLES], [])).toEqual({
      ok: false,
      scope: "training",
      code: "LEARNING_CONSENT_MISSING",
      message:
        "No consent lets training use your wearable summaries. You can grant it on Customize · Privacy.",
    });
  });

  test("a matching active consent passes and is named", () => {
    expect(decide([SYNTHETIC, WEARABLES], [consent()])).toEqual({
      ok: true,
      scope: "training",
      consentIds: ["consent-1"],
    });
  });

  test("a withdrawn consent is refused as withdrawn, with the date", () => {
    expect(
      decide([WEARABLES], [consent({ withdrawnAt: new Date("2026-10-20T08:00:00Z") })]),
    ).toEqual({
      ok: false,
      scope: "training",
      code: "LEARNING_CONSENT_WITHDRAWN",
      message:
        "Your consent to use your wearable summaries for training was withdrawn on 20 Oct 2026.",
    });
  });

  test("a consent of another scope is refused as scope", () => {
    expect(decide([WEARABLES], [consent({ scope: "evaluation" })])).toEqual({
      ok: false,
      scope: "training",
      code: "LEARNING_CONSENT_SCOPE",
      message:
        "Your consent does not cover your wearable summaries for training; what you granted covers other uses or other data.",
    });
  });

  test("a consent of the scope that leaves out the source is refused as scope", () => {
    expect(
      decide([{ kind: "personal", ownerId: OWNER, source: "genome" }], [consent()]),
    ).toEqual({
      ok: false,
      scope: "training",
      code: "LEARNING_CONSENT_SCOPE",
      message:
        "Your consent does not cover your genome reports for training; what you granted covers other uses or other data.",
    });
  });

  test("another person's consent does not count", () => {
    expect(decide([WEARABLES], [consent({ userId: "someone-else" })])).toEqual({
      ok: false,
      scope: "training",
      code: "LEARNING_CONSENT_MISSING",
      message:
        "No consent lets training use your wearable summaries. You can grant it on Customize · Privacy.",
    });
  });

  test("a grant after a withdrawal is used, and only the active one is named", () => {
    expect(
      decide(
        [WEARABLES],
        [
          consent({ id: "old", withdrawnAt: new Date("2026-10-10T00:00:00Z") }),
          consent({ id: "new", grantedAt: new Date("2026-10-11T00:00:00Z") }),
        ],
      ),
    ).toEqual({ ok: true, scope: "training", consentIds: ["new"] });
  });

  test("a consent granted after the moment asked about does not count", () => {
    expect(
      decide([WEARABLES], [consent({ grantedAt: new Date("2026-11-01T00:00:00Z") })]),
    ).toEqual({
      ok: false,
      scope: "training",
      code: "LEARNING_CONSENT_MISSING",
      message:
        "No consent lets training use your wearable summaries. You can grant it on Customize · Privacy.",
    });
  });

  test("the first refused row decides", () => {
    const decision = decide(
      [WEARABLES, { ...SYNTHETIC, cohortId: "unknown" }],
      [consent({ scope: "answer-key" })],
    );
    expect(decision.ok ? null : decision.code).toBe("LEARNING_CONSENT_SCOPE");
  });
});

describe("isActiveAt", () => {
  test("withdrawn exactly at the moment is no longer active", () => {
    expect(isActiveAt(consent({ withdrawnAt: AT }), AT)).toBe(false);
  });
  test("withdrawn later is still active now", () => {
    expect(
      isActiveAt(consent({ withdrawnAt: new Date("2026-12-01T00:00:00Z") }), AT),
    ).toBe(true);
  });
});

describe("requireLearningConsent", () => {
  test("synthetic rows never read the consent store", async () => {
    const asked: string[][] = [];
    const decision = await requireLearningConsent("evaluation", [SYNTHETIC], {
      loadConsents: async (owners) => {
        asked.push([...owners]);
        return [];
      },
      now: () => AT,
    });
    expect([decision, asked]).toEqual([
      { ok: true, scope: "evaluation", consentIds: [] },
      [],
    ]);
  });

  test("reads the consents of each owner once", async () => {
    const asked: string[][] = [];
    const decision = await requireLearningConsent(
      "training",
      [WEARABLES, { kind: "personal", ownerId: OWNER, source: "chat" }],
      {
        loadConsents: async (owners) => {
          asked.push([...owners]);
          return [consent()];
        },
        now: () => AT,
      },
    );
    expect([decision, asked]).toEqual([
      { ok: true, scope: "training", consentIds: ["consent-1"] },
      [[OWNER]],
    ]);
  });

  test("a consent store that fails counts as no consent", async () => {
    const decision = await requireLearningConsent("training", [WEARABLES], {
      loadConsents: () => Promise.reject(new Error("down")),
      now: () => AT,
    });
    expect(decision.ok ? null : decision.code).toBe("LEARNING_CONSENT_MISSING");
  });

  test("noConsentStore lets synthetic rows through and refuses personal ones", async () => {
    const store = noConsentStore(() => AT);
    const synthetic = await requireLearningConsent("training", [SYNTHETIC], store);
    const personal = await requireLearningConsent("training", [WEARABLES], store);
    expect([synthetic.ok, personal.ok ? null : personal.code]).toEqual([
      true,
      "LEARNING_CONSENT_MISSING",
    ]);
  });
});

describe("wording", () => {
  test("lists the sources in a fixed order and states what withdrawal does", () => {
    expect(consentWording("training", ["chat", "wearables"])).toBe(
      "I agree that TwinLLM's pipelines on this machine may read my wearable summaries and chat threads to make training sets, the conversations a model is fine-tuned on. Removing names or dates does not replace this consent. It holds until I withdraw it, and withdrawing stops future use only.",
    );
  });

  test("one source and three sources", () => {
    expect([
      consentWording("evaluation", ["genome"]),
      consentWording("answer-key", ["notes", "imports", "body-scans"]),
    ]).toEqual([
      "I agree that TwinLLM's pipelines on this machine may read my genome reports to make evaluation runs, where a model answers questions and its answers are scored. Removing names or dates does not replace this consent. It holds until I withdraw it, and withdrawing stops future use only.",
      "I agree that TwinLLM's pipelines on this machine may read my imported records, twin notes and body scans to make answer keys, the expected answers a model is checked against. Removing names or dates does not replace this consent. It holds until I withdraw it, and withdrawing stops future use only.",
    ]);
  });

  test("orderedSources drops repeats", () => {
    expect(orderedSources(["chat", "wearables", "chat"])).toEqual(["wearables", "chat"]);
  });

  test("the SHA-256 of the wording, as lowercase hex", () => {
    const sentence = consentWording("training", ["chat"]);
    expect([
      wordingSha256(sentence),
      /^[0-9a-f]{64}$/.test(wordingSha256(sentence)),
    ]).toEqual([createHash("sha256").update(sentence, "utf8").digest("hex"), true]);
  });
});

describe("lines, manifests and audit rows", () => {
  test("a refusal line carries the code", () => {
    expect(
      learningRefusalLine({
        ok: false,
        scope: "training",
        code: "LEARNING_CONSENT_MISSING",
        message: "No consent.",
      }),
    ).toBe("Refused (LEARNING_CONSENT_MISSING): No consent. Nothing was read.");
  });

  test("a refusal before writing says nothing was kept", () => {
    expect(
      learningRefusalLine(
        {
          ok: false,
          scope: "training",
          code: "LEARNING_CONSENT_WITHDRAWN",
          message: "Gone.",
        },
        "before-write",
      ),
    ).toBe("Refused (LEARNING_CONSENT_WITHDRAWN): Gone. Nothing was kept.");
  });

  test("a manifest names the scope and the consent ids", () => {
    expect(
      learningManifest({ ok: true, scope: "evaluation", consentIds: ["a", "b"] }),
    ).toEqual({ scope: "evaluation", consent_ids: ["a", "b"] });
  });

  test("subject groups become subject rows", () => {
    expect(
      subjectRowsFrom([{ cohortId: "synthea-v4-seed42", isSynthetic: true }]),
    ).toEqual([SYNTHETIC]);
  });

  test("distinctRows drops repeats and keeps order", () => {
    expect(distinctRows([WEARABLES, SYNTHETIC, WEARABLES, SYNTHETIC])).toEqual([
      WEARABLES,
      SYNTHETIC,
    ]);
  });

  test("an audit row holds the consent id and a source count only", () => {
    expect(learningAuditEvent("local-user", "withdraw", "consent-1", 2)).toEqual({
      actor: "local-user",
      sessionId: "consent-1",
      subjectRef: null,
      tool: "learning.consent.withdraw",
      args: { event: "withdraw", consentId: "consent-1" },
      result: { sources: 2 },
      rowCount: 2,
    });
  });
});

describe("stored rows and grants", () => {
  const row = {
    id: "consent-1",
    userId: OWNER,
    scope: "training",
    sources: ["wearables", "telepathy", "chat"],
    wordingVersion: "learning-consent.v1",
    wordingSha256: "0".repeat(64),
    grantedAt: new Date("2026-10-01T09:00:00Z"),
    withdrawnAt: null,
  };

  test("a row keeps known sources only", () => {
    expect(consentFromRow(row)).toEqual(consent());
  });

  test("a row of an unknown scope is dropped", () => {
    expect(consentFromRow({ ...row, scope: "marketing" })).toBe(null);
  });

  test("a grant needs a source", () => {
    expect(grantProblem("training", [], [], AT)).toBe("no-sources");
  });

  test("one active grant per scope", () => {
    expect([
      grantProblem("training", ["chat"], [consent()], AT),
      grantProblem("evaluation", ["chat"], [consent()], AT),
      grantProblem(
        "training",
        ["chat"],
        [consent({ withdrawnAt: new Date("2026-10-02T00:00:00Z") })],
        AT,
      ),
    ]).toEqual(["already-granted", null, null]);
  });
});
