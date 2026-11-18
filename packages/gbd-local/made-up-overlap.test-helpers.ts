import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

import { MADE_UP_HEADER } from "./made-up-results.test-helpers";

/**
 * Two MADE-UP Results Tool files that share one estimate (#428), and a client
 * for the live tests that run them against a throwaway database. Every value
 * is invented for tests and is NOT an IHME estimate.
 *   RUN_LIVE=1 DATABASE_URL=<throwaway, migrated> bun test <file>.live.test.ts
 */

const row = (location: string, year: number, val: string): string =>
  `1,Deaths,${location},3,Both,27,Age-standardized,491,"Cardiovascular diseases",3,Rate,${year},${val},${val}1,${val}0`;

const SWISS_2021 = row(`94,"Switzerland"`, 2021, "1.5");
const SHARED = row(`94,"Switzerland"`, 2023, "2.5");
const GERMANY_2023 = row(`81,"Germany"`, 2023, "3.5");

/** Switzerland 2021 and 2023. */
export const OVERLAP_FILE_A = [MADE_UP_HEADER, SWISS_2021, SHARED, ""].join("\n");
/** Switzerland 2023 (also in A) and Germany 2023. */
export const OVERLAP_FILE_B = [MADE_UP_HEADER, SHARED, GERMANY_2023, ""].join("\n");
/** Switzerland 2015 only: the year of the eval's S4 probe (#273). */
export const PROBE_YEAR_FILE = [
  MADE_UP_HEADER,
  row(`94,"Switzerland"`, 2015, "4.5"),
  "",
].join("\n");

export const runLive = Reflect.get(process.env, "RUN_LIVE") === "1";

export const liveDatabase = (): PrismaClient =>
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: String(Reflect.get(process.env, "DATABASE_URL") ?? ""),
    }),
  });

/** "Switzerland 2021" for each stored estimate, sorted. */
export const storedEstimates = async (db: PrismaClient): Promise<readonly string[]> =>
  (
    await db.gbdEstimate.findMany({
      select: { locationName: true, year: true },
    })
  )
    .map((estimate) => `${estimate.locationName} ${estimate.year}`)
    .sort();

/** Refuses to run on a database that already holds GBD imports. */
export const requireEmptyGbdStore = async (db: PrismaClient): Promise<void> => {
  const existing = await db.gbdImport.count();
  if (existing > 0) {
    throw new Error(`${existing} GBD imports already stored; use a throwaway database`);
  }
};

export const clearGbdStore = async (db: PrismaClient): Promise<void> => {
  await db.gbdImport.deleteMany();
  await db.gbdEstimate.deleteMany();
};
