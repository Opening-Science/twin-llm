import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { RIGGED_RELEASE_HOSTS } from "../../packages/anatomy/rigged-bodies";
import { EVAL_COHORT, EVAL_RELEASE } from "./cohort-pins";
import {
  type ArchiveDeps,
  archName,
  fallbackNotice,
  fetchEvalArchive,
  generatedMismatchMessage,
  type ReleasePin,
  unpackedProblem,
} from "./eval-cohort-download";

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** A tiny stand-in archive with an honest pin, so no real download is needed. */
const BYTES = new Uint8Array([40, 41, 42, 43, 44]);
const PIN: ReleasePin = {
  ...EVAL_RELEASE,
  archiveBytes: BYTES.byteLength,
  archiveSha256: sha256(BYTES),
};
const ASSET =
  "https://release-assets.githubusercontent.com/github-production-release-asset/1/eval";
const PATH = "/x/.synthea/downloads/eval.tar.zst";

const redirect = (location: string): Response =>
  new Response(null, { status: 302, headers: { location } });

const harness = (
  serve: (url: string) => Response,
  onDisk: Uint8Array | null = null,
): Readonly<{
  deps: ArchiveDeps;
  written: Map<string, Uint8Array>;
  requests: string[];
}> => {
  const written = new Map<string, Uint8Array>();
  const requests: string[] = [];
  return {
    written,
    requests,
    deps: {
      fetch: (url, init) => {
        requests.push(`${String(init.redirect)} ${url}`);
        return Promise.resolve(serve(url));
      },
      readFile: () => Promise.resolve(onDisk),
      writeFileAtomic: (path, bytes) => {
        written.set(path, bytes);
        return Promise.resolve();
      },
      sha256,
    },
  };
};

/** GitHub's answer: a redirect from the release URL to the asset host. */
const github = (body: Uint8Array) => (url: string) =>
  url === PIN.url ? redirect(ASSET) : new Response(body);

describe("EVAL_RELEASE pin", () => {
  test("is an asset of this repository's eval-cohort-v1 release with a full SHA-256", () => {
    expect(EVAL_RELEASE.url).toBe(
      "https://github.com/Opening-Science/twin-llm/releases/download/eval-cohort-v1/eval-cohort-synthea-v4-seed42-20260101.tar.zst",
    );
    expect(EVAL_RELEASE.archiveSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(EVAL_RELEASE.archiveBytes).toBe(4_911_581);
  });

  test("follows redirects only to the hosts anatomy:fetch allows", () => {
    expect(EVAL_RELEASE.redirectHosts).toEqual(RIGGED_RELEASE_HOSTS);
  });
});

describe("fetchEvalArchive", () => {
  test("downloads through GitHub's redirect and writes the archive once it matches", async () => {
    const { deps, written, requests } = harness(github(BYTES));
    expect(await fetchEvalArchive(PATH, PIN, deps)).toEqual({
      kind: "downloaded",
      bytes: 5,
    });
    expect(requests).toEqual([`manual ${PIN.url}`, `manual ${ASSET}`]);
    expect([...written.keys()]).toEqual([PATH]);
    expect(written.get(PATH)).toEqual(BYTES);
  });

  test("keeps an archive already on disk when its SHA-256 matches", async () => {
    const { deps, written, requests } = harness(github(BYTES), BYTES);
    expect(await fetchEvalArchive(PATH, PIN, deps)).toEqual({ kind: "cached" });
    expect(requests).toEqual([]);
    expect(written.size).toBe(0);
  });

  test("downloads again over a damaged copy on disk", async () => {
    const { deps, written } = harness(github(BYTES), new Uint8Array([1]));
    expect((await fetchEvalArchive(PATH, PIN, deps)).kind).toBe("downloaded");
    expect(written.get(PATH)).toEqual(BYTES);
  });

  test("a release that does not exist yet is reported as not published", async () => {
    const { deps, written } = harness(() => new Response("Not Found", { status: 404 }));
    expect(await fetchEvalArchive(PATH, PIN, deps)).toEqual({
      kind: "not-published",
      message:
        "release eval-cohort-v1 with eval-cohort-synthea-v4-seed42-20260101.tar.zst is not published yet",
    });
    expect(written.size).toBe(0);
  });

  test("a redirect to another host is refused and nothing is written", async () => {
    const { deps, written } = harness((url) =>
      url === PIN.url
        ? redirect("https://example.com/eval.tar.zst")
        : new Response(BYTES),
    );
    expect(await fetchEvalArchive(PATH, PIN, deps)).toEqual({
      kind: "failed",
      message:
        "the download of eval-cohort-synthea-v4-seed42-20260101.tar.zst was redirected somewhere unexpected; nothing written",
    });
    expect(written.size).toBe(0);
  });

  test("a server error, a wrong file and an oversized file write nothing", async () => {
    const error = harness(() => new Response("", { status: 503 }));
    expect(await fetchEvalArchive(PATH, PIN, error.deps)).toEqual({
      kind: "failed",
      message:
        "could not download eval-cohort-synthea-v4-seed42-20260101.tar.zst (HTTP 503)",
    });
    const wrong = harness(github(new Uint8Array([9, 9, 9, 9, 9])));
    expect(await fetchEvalArchive(PATH, PIN, wrong.deps)).toEqual({
      kind: "failed",
      message:
        "eval-cohort-synthea-v4-seed42-20260101.tar.zst does not match its pinned SHA-256; nothing written",
    });
    const large = harness(github(new Uint8Array(6)));
    expect(await fetchEvalArchive(PATH, PIN, large.deps)).toEqual({
      kind: "failed",
      message:
        "eval-cohort-synthea-v4-seed42-20260101.tar.zst is larger than its pin; nothing written",
    });
    expect([error, wrong, large].map((run) => run.written.size)).toEqual([0, 0, 0]);
  });

  test("no connection is a plain message", async () => {
    const { deps } = harness(() => {
      throw new TypeError("fetch failed");
    });
    expect(await fetchEvalArchive(PATH, PIN, deps)).toEqual({
      kind: "failed",
      message:
        "could not download eval-cohort-synthea-v4-seed42-20260101.tar.zst (no connection to github.com?)",
    });
  });
});

describe("unpackedProblem", () => {
  const pinned = {
    files: 37,
    contentSha256: EVAL_COHORT.contentSha256,
    manifestCohortId: "synthea-v4-seed42",
  };

  test("the pinned files pass", () => {
    expect(unpackedProblem(pinned)).toBeNull();
  });

  test("another count, checksum or cohort id is named", () => {
    expect(unpackedProblem({ ...pinned, files: 36 })).toBe(
      "the archive holds 36 patient files, the pin has 37",
    );
    expect(unpackedProblem({ ...pinned, contentSha256: "a".repeat(64) })).toBe(
      `the archive's patient files have contentSha256 ${"a".repeat(64)}, the pin is f4941fab7a56e17f9dd66b6b6e0fbed379dab8c564c6024831c5fd4aa0ba09eb`,
    );
    expect(unpackedProblem({ ...pinned, manifestCohortId: null })).toBe(
      "the archive's manifest names cohort none, not synthea-v4-seed42",
    );
  });
});

describe("messages when the cohort is generated", () => {
  /** What Peter's Mac generated: the same 37 people, another checksum. */
  const MAC = {
    files: 37,
    contentSha256: "825aa5fc17dbabe77bc4fe71dc20d5d249c3027d7266352c933b0ec5d484db5a",
  };
  const MISMATCH =
    "the cohort generated here does not match the pin (37 files, contentSha256 825aa5fc17dbabe77bc4fe71dc20d5d249c3027d7266352c933b0ec5d484db5a; expected 37 files, f4941fab7a56e17f9dd66b6b6e0fbed379dab8c564c6024831c5fd4aa0ba09eb). Nothing ingested.";
  const PLATFORM =
    "This is a platform difference (arm64 vs x86_64 floating point): Synthea's java.lang.Math gives a few last digits differently on this CPU than on Linux x86_64, where the pin was made. Nothing is wrong with this machine.";

  test("on arm64 with --generate-cohort: a platform difference, use the download", () => {
    expect(
      generatedMismatchMessage(MAC, "arm64", { kind: "asked" }, "bun run setup:local"),
    ).toBe(
      `${MISMATCH} ${PLATFORM} Use the download: bun run setup:local (without --generate-cohort) fetches the pinned files from release eval-cohort-v1.`,
    );
  });

  test("on arm64 after the download failed: says why and to run again once it works", () => {
    expect(
      generatedMismatchMessage(
        MAC,
        "arm64",
        {
          kind: "download-unavailable",
          message:
            "release eval-cohort-v1 with eval-cohort-synthea-v4-seed42-20260101.tar.zst is not published yet",
        },
        "bun run setup:local -- --reload-cohort",
      ),
    ).toBe(
      `${MISMATCH} ${PLATFORM} Use the download: release eval-cohort-v1 with eval-cohort-synthea-v4-seed42-20260101.tar.zst is not published yet; run bun run setup:local -- --reload-cohort again once release eval-cohort-v1 can be downloaded.`,
    );
  });

  test("on x86_64, or with other patients, it is unexpected and asks for a report", () => {
    const report = `${MISMATCH} Please report this with .synthea/manifest.json`;
    expect(generatedMismatchMessage(MAC, "x64", { kind: "asked" }, "x")).toBe(report);
    expect(
      generatedMismatchMessage({ ...MAC, files: 35 }, "arm64", { kind: "asked" }, "x"),
    ).toBe(
      "the cohort generated here does not match the pin (35 files, contentSha256 825aa5fc17dbabe77bc4fe71dc20d5d249c3027d7266352c933b0ec5d484db5a; expected 37 files, f4941fab7a56e17f9dd66b6b6e0fbed379dab8c564c6024831c5fd4aa0ba09eb). Nothing ingested. Please report this with .synthea/manifest.json",
    );
  });

  test("the fallback notice names the reason and what happens next", () => {
    expect(
      fallbackNotice(
        "release eval-cohort-v1 with eval-cohort-synthea-v4-seed42-20260101.tar.zst is not published yet",
      ),
    ).toBe(
      "release eval-cohort-v1 with eval-cohort-synthea-v4-seed42-20260101.tar.zst is not published yet; generating synthea-v4-seed42 locally with Synthea instead.",
    );
  });

  test("architecture names", () => {
    expect([archName("x64"), archName("arm64")]).toEqual(["x86_64", "arm64"]);
  });
});
