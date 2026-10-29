/**
 * Reader for WFDB header (.hea) files (PhysioNet WFDB documentation,
 * header(5)): the record line and one line per signal. Pure: it takes the text.
 *
 * Record line: `name[/segments] nsig [fs[/counterfreq][(base)] [nsamp [time [date]]]]`.
 * Lines starting with `#` are comments. The sampling frequency defaults to
 * 250 Hz when left out, as in WFDB.
 */
export type WfdbHeader = Readonly<{
  record: string;
  nSignals: number;
  samplingHz: number;
  /** Samples per signal, or null when left out or 0. */
  nSamples: number | null;
  baseTime: string | null;
  signals: ReadonlyArray<Readonly<{ file: string; format: string; description: string }>>;
}>;

export const DEFAULT_SAMPLING_HZ = 250;

export const parseWfdbHeader = (text: string): WfdbHeader => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const [recordLine, ...signalLines] = lines;
  if (recordLine === undefined) throw new Error("empty WFDB header");
  const fields = recordLine.split(/\s+/);
  const record = fields[0].split("/")[0];
  const nSignals = Number(fields[1] ?? "");
  if (!Number.isInteger(nSignals) || nSignals < 0) {
    throw new Error(`bad signal count in WFDB header of ${record}`);
  }
  const frequency = fields[2] === undefined ? DEFAULT_SAMPLING_HZ : parseFloat(fields[2]);
  if (!(frequency > 0))
    throw new Error(`bad sampling frequency in WFDB header of ${record}`);
  const samples = fields[3] === undefined ? null : Number(fields[3]);
  return {
    record,
    nSignals,
    samplingHz: frequency,
    nSamples:
      samples === null || !Number.isFinite(samples) || samples === 0 ? null : samples,
    baseTime: fields[4] ?? null,
    signals: signalLines.slice(0, nSignals).map((line) => {
      const parts = line.split(/\s+/);
      return {
        file: parts[0],
        format: parts[1] ?? "",
        description: parts.slice(8).join(" "),
      };
    }),
  };
};
