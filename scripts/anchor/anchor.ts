/**
 * `bun run anchor:init | anchor:write | anchor:rotate | anchor:export` (#300,
 * docs/privacy-design.md section 2.6, docs/runbook.md "Signed anchors").
 *
 * The anchor key and the anchors file live in `$TWINLLM_STATE_DIR/anchor/`.
 * Nothing here sends anything anywhere: `export` prints to the terminal, and
 * the person decides where to keep it. Prints key ids, row numbers and
 * hashes of the chains, never a row's content or the private key.
 */
import { homedir } from "node:os";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../generated/prisma/client";
import { defaultStateDir } from "../../infrastructure/storage-hardening";
import { serializeLine } from "../../packages/audit/anchor";
import { chainReaders, dueHeads, planFromFile } from "../../packages/audit/anchor-chains";
import {
  type AnchorPaths,
  anchorPaths,
  initAnchorKey,
  latestAnchors,
  readAnchorKey,
  rotateAnchorKey,
  writeAnchors,
} from "../../packages/audit/anchor-store";
import { CHAINS } from "../../packages/audit/chain";
import { parseAnchorArgs } from "./anchor-args";

const stateDir = (): string =>
  process.env.TWINLLM_STATE_DIR ||
  defaultStateDir({
    platform: process.platform === "darwin" ? "darwin" : "linux",
    home: homedir(),
    xdgDataHome: process.env.XDG_DATA_HOME,
  });

const short = (keyId: string | null): string =>
  keyId === null ? "none" : keyId.slice(0, 16);

const writeNow = async (paths: AnchorPaths): Promise<number> => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("anchor: DATABASE_URL is required");
    return 1;
  }
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const plans = await planFromFile(chainReaders(client), paths);
    const written = writeAnchors(paths, dueHeads(plans), new Date());
    for (const plan of plans) {
      const line = written.find(
        (entry) => entry.kind === "anchor" && entry.chain === plan.chain,
      );
      const what =
        line !== undefined && line.kind === "anchor"
          ? `anchored row ${line.seq}`
          : {
              write: "not written",
              unchanged: "unchanged since the latest anchor",
              empty: "no rows yet",
              truncated: "REFUSED: the chain is shorter than its latest anchor",
              removed: "REFUSED: the anchored row is missing",
              rewritten: "REFUSED: the anchored row has a different hash",
              unreadable: "could not be read",
            }[plan.plan];
      process.stdout.write(`anchor ${plan.chain}: ${what}\n`);
    }
    const refused = plans.some((plan) =>
      ["truncated", "removed", "rewritten"].includes(plan.plan),
    );
    return refused ? 1 : 0;
  } finally {
    await client.$disconnect();
  }
};

const exportNewest = (paths: AnchorPaths): number => {
  const key = readAnchorKey(paths);
  if (key.kind !== "found") {
    console.error("anchor: no usable anchor key; run bun run anchor:init");
    return 2;
  }
  const latest = latestAnchors(paths);
  process.stdout.write(
    `# TwinLLM signed anchors, key ${key.keyId}\n# Keep these lines somewhere else; they are not sent anywhere.\n`,
  );
  for (const chain of CHAINS) {
    const line = latest[chain];
    process.stdout.write(
      line === undefined ? `# ${chain}: no anchor yet\n` : serializeLine(line),
    );
  }
  process.stdout.write(`# public key (SPKI, base64)\n# ${key.publicKey}\n`);
  return 0;
};

const main = async (): Promise<number> => {
  const parsed = parseAnchorArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    return 64;
  }
  const paths = anchorPaths(stateDir());
  const now = new Date();
  switch (parsed.args.command) {
    case "init": {
      const result = initAnchorKey(paths, now);
      if (result.kind === "refused") {
        console.error(`anchor: ${result.why}`);
        return 1;
      }
      process.stdout.write(
        result.kind === "created"
          ? `anchor: created key ${short(result.keyId)} in $TWINLLM_STATE_DIR/anchor\n`
          : `anchor: key ${short(result.keyId)} already there\n`,
      );
      return 0;
    }
    case "write":
      return writeNow(paths);
    case "rotate": {
      const result = rotateAnchorKey(paths, now, {
        withoutOldKey: parsed.args.withoutOldKey,
      });
      if (result.kind === "refused") {
        console.error(`anchor: ${result.why}`);
        return 1;
      }
      process.stdout.write(
        `anchor: new key ${short(result.newKeyId)} (was ${short(result.oldKeyId)})${
          parsed.args.withoutOldKey
            ? "; not signed by the old key, so the Lab shows a break before this line"
            : ", signed over by the old key"
        }\n`,
      );
      return 0;
    }
    case "export":
      return exportNewest(paths);
  }
};

process.exitCode = await main();
