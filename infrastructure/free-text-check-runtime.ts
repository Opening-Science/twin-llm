import "server-only";

import { database } from "./database";
import { cipherForActor } from "./field-cipher-runtime";
import {
  type CheckFreeText,
  FREE_TEXT_KIND,
  freeTextCheckOf,
  isDistinctiveId,
  type KnownValue,
  knownValueMatches,
  lookupMatches,
  variantCandidates,
} from "./free-text-check";

/**
 * The check of outgoing free text against one person's database (#346).
 * rsIDs and sites are looked up through the keyed hashes of their imported
 * VCFs (no variant is opened); file names and body scan labels are opened
 * once per checker. Rejects while the vault is locked, which the ledger
 * records as not checked.
 */

const DATASETS = "personal_datasets";
const SUBJECTS = "vitronic_subjects";
const VARIANTS = "personal_variants";

const knownValuesOf = async (
  actor: string,
  userId: string | null,
): Promise<readonly KnownValue[]> => {
  const account: readonly KnownValue[] = isDistinctiveId(actor)
    ? [{ kind: FREE_TEXT_KIND.account, value: actor }]
    : [];
  if (userId === null) return account;
  const cipher = cipherForActor(actor);
  const [datasets, subjects] = await Promise.all([
    database().personalDataset.findMany({
      where: { userId },
      select: { id: true, sourceFileName: true },
    }),
    database().vitronicSubject.findMany({
      where: { userId, isSelf: false },
      select: { id: true, label: true },
    }),
  ]);
  return [
    ...account,
    ...datasets.map((row) => ({
      kind: FREE_TEXT_KIND.file,
      value: cipher.openText(DATASETS, "source_file_name", row.id, row.sourceFileName),
    })),
    ...subjects.map((row) => ({
      kind: FREE_TEXT_KIND.label,
      value: cipher.openText(SUBJECTS, "label", row.id, row.label),
    })),
  ];
};

const userIdOf = async (actor: string): Promise<string | null> =>
  (
    await database().user.findUnique({
      where: { clerkId: actor },
      select: { id: true },
    })
  )?.id ?? null;

type Stored = Readonly<{ userId: string | null; known: readonly KnownValue[] }>;

/** A checker for one person's requests; the stored names are read on first use. */
export const freeTextCheckerFor = (actor: string): CheckFreeText => {
  // One model call's requests share the stored names: read once per checker.
  const memo = new Map<"stored", Promise<Stored>>();
  const loaded = (): Promise<Stored> => {
    const known = memo.get("stored");
    if (known !== undefined) return known;
    const read = userIdOf(actor)
      .then(async (userId) => ({ userId, known: await knownValuesOf(actor, userId) }))
      .catch((error: unknown) => {
        // A locked vault now may be open at the next request.
        memo.delete("stored");
        throw error;
      });
    memo.set("stored", read);
    return read;
  };

  return async (text) => {
    const { userId, known } = await loaded();
    const named = knownValueMatches(text, known);
    const candidates = variantCandidates(text);
    if (
      userId === null ||
      (candidates.rsids.length === 0 && candidates.sites.length === 0)
    ) {
      return freeTextCheckOf(named);
    }
    const cipher = cipherForActor(actor);
    const hashesOf = {
      rsid: (rsid: string) => cipher.indexes(VARIANTS, "variant_id", rsid),
      site: (spelling: string) => cipher.indexes(VARIANTS, "site", spelling),
    };
    const rsidHashes = candidates.rsids.flatMap(hashesOf.rsid);
    const siteHashes = candidates.sites.flatMap((site) =>
      site.spellings.flatMap(hashesOf.site),
    );
    const rows = await database().personalVariant.findMany({
      where: {
        userId,
        OR: [
          ...(rsidHashes.length > 0 ? [{ variantIdIndex: { hasSome: rsidHashes } }] : []),
          ...(siteHashes.length > 0 ? [{ siteIndex: { in: siteHashes } }] : []),
        ],
      },
      select: { variantIdIndex: true, siteIndex: true },
    });
    const found = {
      rsids: new Set(rows.flatMap((row) => row.variantIdIndex)),
      sites: new Set(
        rows.flatMap((row) => (row.siteIndex === null ? [] : [row.siteIndex])),
      ),
    };
    return freeTextCheckOf(named, lookupMatches(candidates, hashesOf, found));
  };
};
