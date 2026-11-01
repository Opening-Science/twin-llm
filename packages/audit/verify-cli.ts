import { homedir } from "node:os";
import { dirname } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { stateDirFrom } from "@/infrastructure/storage-hardening";

import { chainReaders, databaseIdentity, verifyAgainstAnchor } from "./anchor-chains";
import { type AnchorPaths, anchorPaths, anchorPathsIn } from "./anchor-store";
import { append } from "./append";
import { verifyDisclosureChain } from "./disclosure-chain";
import { verifyChain } from "./verify-chain";
import {
  type AnchorOption,
  anchorOutcome,
  type CheckOutcome,
  checkOutcome,
  EXIT,
  parseAnchorOption,
  parseChain,
  parseVerifyMode,
  worstExit,
} from "./verify-cli-args";

const databaseUrl = (): string => {
  // CLI is outside Next. serverEnv() pulls server-only.
  // eslint-disable-next-line no-restricted-syntax -- verify-cli owns DATABASE_URL
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("verify-cli FAIL: DATABASE_URL is required");
    process.exit(1);
  }
  return url;
};

/** The state folder as the app resolves it (docs/privacy-design.md, "State directory"). */
const stateDir = (): string => {
  const dir = stateDirFrom({
    // eslint-disable-next-line no-restricted-syntax -- verify-cli runs outside the app
    value: process.env.TWINLLM_STATE_DIR,
    platform: process.platform === "darwin" ? "darwin" : "linux",
    home: homedir(),
    // eslint-disable-next-line no-restricted-syntax -- verify-cli runs outside the app
    xdgDataHome: process.env.XDG_DATA_HOME,
  });
  if (!dir.ok) {
    console.error(`verify-cli: ${dir.error}`);
    process.exit(EXIT.usage);
  }
  return dir.dir;
};

const pathsFor = (option: AnchorOption): AnchorPaths | null => {
  if (option.anchors === "off") return null;
  if (option.anchors === "default") return anchorPaths(stateDir());
  return { ...anchorPathsIn(dirname(option.path)), log: option.path };
};

const print = (outcome: CheckOutcome): void => {
  if (outcome.stream === "stdout") process.stdout.write(`${outcome.line}\n`);
  else console.error(outcome.line);
};

const createClient = (): PrismaClient =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl() }),
  });

const seedTwo = async (client: PrismaClient): Promise<void> => {
  await append(client, {
    actor: "verify",
    sessionId: "verify",
    subjectRef: null,
    tool: "list_subjects",
    args: { cohort_id: "verify-seed" },
    result: { subjects: [] },
    rowCount: 0,
  });
  await append(client, {
    actor: "verify",
    sessionId: "verify",
    subjectRef: null,
    tool: "list_subjects",
    args: { cohort_id: "verify-seed-2" },
    result: { subjects: [] },
    rowCount: 0,
  });
};

const main = async (): Promise<void> => {
  const parsed = parseVerifyMode(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(parsed.error);
    process.exit(EXIT.usage);
  }
  const chain = parseChain(process.argv.slice(2), parsed.mode);
  if ("error" in chain) {
    console.error(chain.error);
    process.exit(EXIT.usage);
  }
  const anchors = parseAnchorOption(process.argv.slice(2), parsed.mode);
  if ("error" in anchors) {
    console.error(anchors.error);
    process.exit(EXIT.usage);
  }
  const client = createClient();

  try {
    if (parsed.mode === "--check") {
      // Read-only: the same walk the Lab page runs, on the real table.
      // `--chain disclosures` walks the disclosure ledger (#140) instead.
      const outcome =
        chain.chain === "disclosures"
          ? checkOutcome(await verifyDisclosureChain(client), "disclosures")
          : checkOutcome(await verifyChain(client));
      print(outcome);
      // Then the chain against its latest signed anchor (#300), unless --no-anchors.
      const paths = pathsFor(anchors);
      if (paths === null) {
        process.exitCode = outcome.code;
        return;
      }
      const anchored = anchorOutcome(
        await verifyAgainstAnchor(
          chainReaders(client)[chain.chain],
          databaseIdentity(client),
          paths,
          chain.chain,
        ),
        chain.chain,
      );
      print(anchored);
      process.exitCode = worstExit(outcome.code, anchored.code);
      return;
    }

    if (parsed.mode === "--seed-ok") {
      await seedTwo(client);
      const result = await verifyChain(client);
      if (!result.ok) {
        console.error(
          `verify-audit FAIL: seeded chain broken at seq ${result.brokenAtSeq}`,
        );
        process.exit(1);
      }
      process.stdout.write("verify-audit OK: seeded chain verifies\n");
      return;
    }

    const result = await verifyChain(client);
    if (result.ok || result.brokenAtSeq !== 1) {
      console.error(
        `verify-audit FAIL: expected brokenAtSeq=1 after tamper, got ${JSON.stringify(result)}`,
      );
      process.exit(1);
    }
    process.stdout.write("verify-audit OK: chain broken at seq 1\n");
  } finally {
    await client.$disconnect();
  }
};

await main();
