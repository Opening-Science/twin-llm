import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

import { append } from "./append";
import { verifyChain } from "./verify-chain";

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
  const client = createClient();
  const expectBroken = process.argv.includes("--expect-broken");
  const seedOk = process.argv.includes("--seed-ok");
  const checkOnly = process.argv.includes("--check");

  try {
    if (checkOnly) {
      // Read-only: the same walk the Lab page runs, on the real table.
      const result = await verifyChain(client);
      const latest = result.latestHash ?? "none";
      if (!result.ok) {
        console.error(
          `verify-audit FAIL: ${result.checked} of ${result.total} rows checked, broken at seq ${result.brokenAtSeq}, latest hash ${latest}`,
        );
        process.exit(1);
      }
      process.stdout.write(
        `verify-audit OK: ${result.total} rows checked, latest hash ${latest}\n`,
      );
      return;
    }

    if (seedOk) {
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

    if (expectBroken) {
      const result = await verifyChain(client);
      if (result.ok || result.brokenAtSeq !== 1) {
        console.error(
          `verify-audit FAIL: expected brokenAtSeq=1 after tamper, got ${JSON.stringify(result)}`,
        );
        process.exit(1);
      }
      process.stdout.write("verify-audit OK: chain broken at seq 1\n");
      return;
    }

    console.error("verify-cli: pass --check, --seed-ok or --expect-broken");
    process.exit(1);
  } finally {
    await client.$disconnect();
  }
};

await main();
