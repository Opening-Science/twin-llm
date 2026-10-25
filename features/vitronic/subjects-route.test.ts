import { describe, expect, test } from "bun:test";

import {
  createVitronicSubjectsGetHandler,
  createVitronicSubjectsPostHandler,
  type VitronicSubjectsDeps,
} from "./subjects-handler";

const OWNER = "user-owner";
let actor: string | null = OWNER;
let listSubjectsFail = false;
const created: unknown[] = [];

const configured = () => ({ encryptionKey: "synthetic", dataDir: null });

const subjectsDeps = (): VitronicSubjectsDeps => ({
  vitronicEnv: configured,
  resolveActorId: async () => actor,
  findAppUserId: async (clerkId: string) => (clerkId ? clerkId : null),
  listVitronicSubjects: async () => {
    if (listSubjectsFail) {
      throw new Error("audit-down");
    }
    return [];
  },
  createVitronicSubject: async (params: { input: unknown }) => {
    created.push(params.input);
    return { id: "sub-1", label: "Self", source: "scanner", isSelf: true, probandId: 1 };
  },
});

describe("GET /api/vitronic/subjects", () => {
  test("append failure returns generic 502 without audit-down or Prisma text", async () => {
    actor = OWNER;
    listSubjectsFail = true;
    const res = await createVitronicSubjectsGetHandler(subjectsDeps())();
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "Could not list BodyLoop subjects." });
    const blob = JSON.stringify(body);
    expect(blob).not.toContain("audit-down");
    expect(blob.toLowerCase()).not.toContain("prisma");
  });
});

describe("POST /api/vitronic/subjects", () => {
  test("consent-required 400 when consent fields are missing or empty", async () => {
    actor = OWNER;
    listSubjectsFail = false;
    created.length = 0;
    const POST = createVitronicSubjectsPostHandler(subjectsDeps());
    const missing = await POST(
      new Request("http://local/api/vitronic/subjects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "Self", source: "scanner" }),
      }),
    );
    expect(missing.status).toBe(400);
    const emptyNote = await POST(
      new Request("http://local/api/vitronic/subjects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: "Self",
          source: "scanner",
          consentRecordedAt: "2026-09-29T12:00:00.000Z",
          consentBy: "operator",
          consentNote: "   ",
        }),
      }),
    );
    expect(emptyNote.status).toBe(400);
    expect(created).toHaveLength(0);
    const missingBlob = JSON.stringify(await missing.json());
    const emptyBlob = JSON.stringify(await emptyNote.json());
    expect(missingBlob).not.toContain("operator");
    expect(emptyBlob).not.toContain("operator");
    expect(emptyBlob).not.toContain("2026-09-29");
  });
});
