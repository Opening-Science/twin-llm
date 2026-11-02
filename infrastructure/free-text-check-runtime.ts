import "server-only";

import { database } from "./database";
import { type FieldCipher, openTexts } from "./field-cipher";
import { cipherForActor } from "./field-cipher-runtime";
import {
  type CheckFreeText,
  FREE_TEXT_KIND,
  freeTextCheckOf,
  isDistinctiveId,
  type KnownValue,
  knownValueMatches,
  lookupMatches,
  NO_STORED_VALUES,
  type StoredValues,
  storedValueMatches,
  variantCandidates,
} from "./free-text-check";

/**
 * The check of outgoing free text against one person's database (#346).
 * rsIDs and sites are looked up through the keyed hashes of their imported
 * VCFs (no variant is opened); file names, body scan labels, imported
 * readings (code, number, unit), clinical records (code, name) and twin
 * notes are opened once per checker, that is once per model call. None of
 * these stores keeps a keyed hash of a value, so they cannot be looked up
 * sealed. Rejects while the vault is locked, which the ledger records as not
 * checked.
 */

const DATASETS = "personal_datasets";
const SUBJECTS = "vitronic_subjects";
const VARIANTS = "personal_variants";
const OBSERVATIONS = "personal_observations";
const CLINICAL = "personal_clinical_records";
const NOTES = "twin_notes";

const openOrNull = (
  cipher: FieldCipher,
  table: string,
  column: string,
  rowId: string,
  stored: string | null,
): string | null =>
  stored === null ? null : cipher.openText(table, column, rowId, stored);

const storedValuesOf = async (actor: string, userId: string): Promise<StoredValues> => {
  const cipher = cipherForActor(actor);
  const [readings, records, notes] = await Promise.all([
    database().personalObservation.findMany({
      where: { userId },
      select: { id: true, code: true, value: true, unit: true },
    }),
    database().personalClinicalRecord.findMany({
      where: { userId },
      select: { id: true, code: true, display: true },
    }),
    database().twinNote.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        topics: true,
        measures: true,
        openQuestions: true,
      },
    }),
  ]);
  return {
    readings: readings.map((row) => ({
      code: openOrNull(cipher, OBSERVATIONS, "code", row.id, row.code),
      value: cipher.openText(OBSERVATIONS, "value", row.id, row.value),
      unit: cipher.openText(OBSERVATIONS, "unit", row.id, row.unit),
    })),
    records: records.map((row) => ({
      code: openOrNull(cipher, CLINICAL, "code", row.id, row.code),
      display: cipher.openText(CLINICAL, "display", row.id, row.display),
    })),
    noteLines: notes.flatMap((row) => [
      cipher.openText(NOTES, "title", row.id, row.title),
      ...openTexts(cipher, NOTES, "topics", row.id, row.topics),
      ...openTexts(cipher, NOTES, "measures", row.id, row.measures),
      ...openTexts(cipher, NOTES, "open_questions", row.id, row.openQuestions),
    ]),
  };
};

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

type Stored = Readonly<{
  userId: string | null;
  known: readonly KnownValue[];
  values: StoredValues;
}>;

/**
 * A checker for one person's requests; the stored names and values are read
 * on first use. `typed` is what the person typed in this call's messages: a
 * stored value that stands there too is theirs to send and not counted
 * (`storedValueMatches`). Names, file names and genome identifiers are
 * counted wherever they stand.
 */
export const freeTextCheckerFor = (
  actor: string,
  typed: readonly string[] = [],
): CheckFreeText => {
  const typedText = typed.join("\n");
  // One model call's requests share the stored values: read once per checker.
  const memo = new Map<"stored", Promise<Stored>>();
  const loaded = (): Promise<Stored> => {
    const known = memo.get("stored");
    if (known !== undefined) return known;
    const read = userIdOf(actor)
      .then(async (userId) => ({
        userId,
        known: await knownValuesOf(actor, userId),
        values: userId === null ? NO_STORED_VALUES : await storedValuesOf(actor, userId),
      }))
      .catch((error: unknown) => {
        // A locked vault now may be open at the next request.
        memo.delete("stored");
        throw error;
      });
    memo.set("stored", read);
    return read;
  };

  return async (text) => {
    const { userId, known, values } = await loaded();
    const named = [
      ...knownValueMatches(text, known),
      ...storedValueMatches(text, values, typedText),
    ];
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
