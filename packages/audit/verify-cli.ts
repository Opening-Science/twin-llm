import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

import { append } from "./append";
import { verifyChain } from "./verify-chain";
import { checkOutcome, EXIT, parseVerifyMode } from "./verify-cli-args";

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
  const parsed = parseVerifyMode(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(parsed.error);
    process.exit(EXIT.usage);
  }
  const client = createClient();

  try {
    if (parsed.mode === "--check") {
      // Read-only: the same walk the Lab page runs, on the real table.
      const outcome = checkOutcome(await verifyChain(client));
      if (outcome.stream === "stdout") process.stdout.write(`${outcome.line}\n`);
      else console.error(outcome.line);
      process.exitCode = outcome.code;
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
