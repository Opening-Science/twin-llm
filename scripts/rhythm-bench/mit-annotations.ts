/**
 * Reader for WFDB annotation files in MIT format (PhysioNet WFDB
 * documentation, annot(5)). Pure: it takes the file's bytes.
 *
 * Each annotation is a 16-bit little-endian word: the top 6 bits are the
 * annotation type A, the low 10 bits the time I in samples since the previous
 * annotation. Some values of A are pseudo-annotations that modify the stream:
 *
 * - A = 59 (SKIP): the next 4 bytes are a 32-bit interval (high 16-bit word
 *   first, each word little-endian) added to the time; the annotation word
 *   that follows adds its own I.
 * - A = 60 (NUM), 61 (SUB), 62 (CHN): I sets the num, subtyp or chan field
 *   of the annotation before it.
 * - A = 63 (AUX): I is the length of an auxiliary string that follows,
 *   padded with one byte when I is odd; it belongs to the annotation before it.
 * - A = 0 and I = 0: end of file.
 */
export type Annotation = Readonly<{
  /** Absolute time, samples from the start of the record. */
  sample: number;
  /** Annotation code (1 = NORMAL, 28 = RHYTHM, ...). */
  code: number;
  subtype: number;
  chan: number;
  num: number;
  /** Auxiliary string without trailing NUL bytes, or null. */
  aux: string | null;
}>;

export const SKIP = 59;
export const NUM = 60;
export const SUB = 61;
export const CHN = 62;
export const AUX = 63;
export const RHYTHM = 28;

/**
 * Codes read as beats (QRS complexes) when building RR intervals: NORMAL 1 to
 * NESC 11, PACE 12, UNKNOWN 13, BBB 25, LEARN 30, AESC 34, SVESC 35, PFUS 38
 * and RONT 41, after the code list in WFDB's ecgcodes.h. Artefacts (16) and
 * non-beat codes are left out.
 */
export const BEAT_CODES: ReadonlySet<number> = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 25, 30, 34, 35, 38, 41,
]);

type Draft = {
  sample: number;
  code: number;
  subtype: number;
  chan: number;
  num: number;
  aux: string | null;
};

const word = (bytes: Uint8Array, at: number): number => bytes[at] | (bytes[at + 1] << 8);

const decodeAux = (bytes: Uint8Array): string =>
  String.fromCharCode(...bytes).replace(/\0+$/, "");

/** Every annotation in the file, in file order. Throws on a truncated file. */
export const parseMitAnnotations = (bytes: Uint8Array): Annotation[] => {
  const out: Draft[] = [];
  let at = 0;
  let time = 0;
  let num = 0;
  let chan = 0;
  while (at + 1 < bytes.length) {
    const value = word(bytes, at);
    const code = value >> 10;
    const interval = value & 0x3ff;
    at += 2;
    if (code === 0 && interval === 0) break;
    const last = out.at(-1);
    if (code === SKIP) {
      if (at + 4 > bytes.length) throw new Error("truncated SKIP in annotation file");
      const high = word(bytes, at);
      const low = word(bytes, at + 2);
      // Signed 32-bit, as WFDB reads it.
      time += (high << 16) | low | 0;
      at += 4;
    } else if (code === NUM) {
      num = interval;
      if (last !== undefined) last.num = interval;
    } else if (code === SUB) {
      if (last !== undefined) last.subtype = interval;
    } else if (code === CHN) {
      chan = interval;
      if (last !== undefined) last.chan = interval;
    } else if (code === AUX) {
      const padded = interval + (interval % 2);
      if (at + interval > bytes.length)
        throw new Error("truncated AUX in annotation file");
      if (last !== undefined) last.aux = decodeAux(bytes.subarray(at, at + interval));
      at += padded;
    } else {
      time += interval;
      out.push({ sample: time, code, subtype: 0, chan, num, aux: null });
    }
  }
  return out;
};

/** Sample times of beat annotations (`BEAT_CODES`). */
export const beatSamples = (annotations: readonly Annotation[]): number[] =>
  annotations.filter((each) => BEAT_CODES.has(each.code)).map((each) => each.sample);

export type RhythmChange = Readonly<{ sample: number; rhythm: string }>;

/**
 * Rhythm changes from RHYTHM annotations, the aux string without its leading
 * "(" ("(AFIB" becomes "AFIB"). Each holds until the next.
 */
export const rhythmChanges = (annotations: readonly Annotation[]): RhythmChange[] =>
  annotations
    .filter(
      (each) => each.code === RHYTHM && each.aux !== null && each.aux.startsWith("("),
    )
    .map((each) => ({ sample: each.sample, rhythm: (each.aux ?? "").slice(1) }));
