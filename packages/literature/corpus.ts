import { type LiteratureRecord, parseLiteratureRecord } from "./article";
import { SPECIALTY_IDS, type SpecialtyId } from "./specialties";

/** A record plus its text, as the ingest reads them from data/literature. */
export type LiteratureArticle = Readonly<{
  record: LiteratureRecord;
  text: string;
}>;

export type LiteratureCorpusPorts = Readonly<{
  /** File names in one specialty folder; empty when the folder is missing. */
  listFiles: (specialty: SpecialtyId) => Promise<readonly string[]>;
  readFile: (specialty: SpecialtyId, file: string) => Promise<string>;
}>;

/**
 * Every `<pmcid>.<version>.json` record in the given specialty folders, with
 * its text. A record filed under the wrong specialty is refused, so a moved
 * file cannot end up under another agent's source.
 */
export const readLiteratureCorpus = async (
  ports: LiteratureCorpusPorts,
  specialties: readonly SpecialtyId[] = SPECIALTY_IDS,
): Promise<LiteratureArticle[]> => {
  const articles: LiteratureArticle[] = [];
  for (const specialty of specialties) {
    const files = [...(await ports.listFiles(specialty))]
      .filter((file) => /^PMC\d+\.\d+\.json$/.test(file))
      .sort();
    for (const file of files) {
      const record = parseLiteratureRecord(await ports.readFile(specialty, file));
      if (record.specialty !== specialty) {
        throw new Error(`LITERATURE_RECORD_MISFILED: ${specialty}/${file}`);
      }
      articles.push({ record, text: await ports.readFile(specialty, record.textFile) });
    }
  }
  return articles;
};
