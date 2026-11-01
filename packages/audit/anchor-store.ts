import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  type AnchorLine,
  type AnchorLogCheck,
  anchorBody,
  type ChainHead,
  checkAnchorLog,
  databaseBody,
  databaseMismatchMessage,
  type DiskKey,
  keyBody,
  keyIdOf,
  type KnownKeys,
  lineHash,
  type LogRead,
  publicKeyText,
  rotationBody,
  scanAnchorLog,
  serializeLine,
  signLine,
  splitLines,
} from "./anchor";
import type { ChainName } from "./chain";

/**
 * The anchor key and the anchors file in the state folder (#300):
 *
 *   $TWINLLM_STATE_DIR/anchor/            0700
 *     anchor-key.pem                      0600, the private key (PKCS#8)
 *     anchor-key.pub                      0600, its public key (SPKI)
 *     retired/<key id>.pub                0600, earlier public keys
 *     anchors.jsonl                       0600, append-only
 *
 * The #144 owner-only check walks the whole state folder, so it covers these
 * files too. Writes are synchronous so that the server can write a last
 * anchor while it shuts down; a lock file keeps two writers (the server and
 * a command) from linking to the same line.
 */

export const ANCHOR_DIR_NAME = "anchor";

export type AnchorPaths = Readonly<{
  dir: string;
  privateKey: string;
  publicKey: string;
  retired: string;
  log: string;
  lock: string;
}>;

export const anchorPaths = (stateDir: string): AnchorPaths => {
  const dir = join(/* turbopackIgnore: true */ stateDir, ANCHOR_DIR_NAME);
  return anchorPathsIn(dir);
};

/** The same layout around a given folder (`verify-cli --anchors <file>`). */
export const anchorPathsIn = (dir: string): AnchorPaths => ({
  dir,
  privateKey: join(/* turbopackIgnore: true */ dir, "anchor-key.pem"),
  publicKey: join(/* turbopackIgnore: true */ dir, "anchor-key.pub"),
  retired: join(/* turbopackIgnore: true */ dir, "retired"),
  log: join(/* turbopackIgnore: true */ dir, "anchors.jsonl"),
  lock: join(/* turbopackIgnore: true */ dir, "anchors.lock"),
});

const errorCode = (error: unknown): string | undefined =>
  error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;

const readOrMissing = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type LoadedKey =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "unreadable" }>
  | Readonly<{ kind: "found"; keyId: string; publicKey: string; privateKey: KeyObject }>;

export const readAnchorKey = (paths: AnchorPaths): LoadedKey => {
  try {
    const pem = readOrMissing(paths.privateKey);
    if (pem === null) return { kind: "missing" };
    const privateKey = createPrivateKey(pem);
    if (privateKey.asymmetricKeyType !== "ed25519") return { kind: "unreadable" };
    const publicKey = publicKeyText(createPublicKey(privateKey));
    return { kind: "found", keyId: keyIdOf(publicKey), publicKey, privateKey };
  } catch {
    return { kind: "unreadable" };
  }
};

/** The key as the verdict sees it, without holding the private key. */
export const diskKeyOf = (key: LoadedKey): DiskKey =>
  key.kind === "found" ? { kind: "found", keyId: key.keyId } : key;

const publicFromPem = (pem: string): string | null => {
  try {
    const key = createPublicKey(pem);
    return key.asymmetricKeyType === "ed25519" ? publicKeyText(key) : null;
  } catch {
    return null;
  }
};

/** The current public key and every retired one, by key id. Unreadable files are left out. */
export const readKnownKeys = (paths: AnchorPaths): KnownKeys => {
  const retired = existsSync(paths.retired)
    ? readdirSync(paths.retired)
        .filter((name) => name.endsWith(".pub"))
        .map((name) => join(/* turbopackIgnore: true */ paths.retired, name))
    : [];
  const texts = [paths.publicKey, ...retired]
    .map((path) => {
      try {
        return readOrMissing(path);
      } catch {
        return null;
      }
    })
    .filter((pem): pem is string => pem !== null)
    .map(publicFromPem)
    .filter((text): text is string => text !== null);
  return new Map(texts.map((text) => [keyIdOf(text), text]));
};

export const readLogLines = (
  paths: AnchorPaths,
):
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "unreadable" }>
  | Readonly<{ kind: "found"; lines: readonly string[] }> => {
  try {
    const text = readOrMissing(paths.log);
    return text === null
      ? { kind: "missing" }
      : { kind: "found", lines: splitLines(text) };
  } catch {
    return { kind: "unreadable" };
  }
};

/** The whole file checked, signatures and links. */
export const readAnchorLog = (paths: AnchorPaths): LogRead => {
  const read = readLogLines(paths);
  if (read.kind !== "found") return read;
  const check: AnchorLogCheck = checkAnchorLog(read.lines, readKnownKeys(paths));
  return { kind: "found", check };
};

/** Size and change time of the anchors file, so a reader can tell it has not changed. */
export const logStamp = (paths: AnchorPaths): string | null => {
  try {
    const info = statSync(paths.log);
    return `${info.size}:${info.mtimeMs}`;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const LOCK_TRIES = 40;
const LOCK_WAIT_MS = 50;
const STALE_LOCK_MS = 30_000;

const pause = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const removeStaleLock = (path: string, now: number): void => {
  try {
    if (now - statSync(path).mtimeMs > STALE_LOCK_MS) rmSync(path, { force: true });
  } catch {
    // Gone meanwhile.
  }
};

export class AnchorLockBusy extends Error {
  override name = "AnchorLockBusy";
}

export class AnchorLogDamaged extends Error {
  override name = "AnchorLogDamaged";
}

export class AnchorKeyMissing extends Error {
  override name = "AnchorKeyMissing";
}

/** The anchors file names another database (#382); nothing was written. */
export class AnchorDatabaseMismatch extends Error {
  override name = "AnchorDatabaseMismatch";
  readonly code = "ANCHOR_DATABASE_MISMATCH";
  readonly logDatabaseId: string;
  readonly databaseId: string;
  constructor(input: Readonly<{ logDatabaseId: string; databaseId: string }>) {
    super(databaseMismatchMessage(input));
    this.logDatabaseId = input.logDatabaseId;
    this.databaseId = input.databaseId;
  }
}

const withLock = <T>(paths: AnchorPaths, run: () => T): T => {
  for (let attempt = 0; attempt < LOCK_TRIES; attempt += 1) {
    try {
      closeSync(openSync(paths.lock, "wx", 0o600));
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      removeStaleLock(paths.lock, Date.now());
      pause(LOCK_WAIT_MS);
      continue;
    }
    try {
      return run();
    } finally {
      rmSync(paths.lock, { force: true });
    }
  }
  throw new AnchorLockBusy("the anchors file is locked by another writer");
};

const ensureDirs = (paths: AnchorPaths): void => {
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  mkdirSync(paths.retired, { recursive: true, mode: 0o700 });
};

type Scan = NonNullable<ReturnType<typeof scanAnchorLog>>;

const scanLog = (paths: AnchorPaths): Scan => {
  const read = readLogLines(paths);
  if (read.kind === "unreadable") throw new AnchorLogDamaged("cannot read anchors file");
  const scan = scanAnchorLog(read.kind === "missing" ? [] : read.lines);
  if (scan === null) throw new AnchorLogDamaged("a line of the anchors file is damaged");
  return scan;
};

/** Signs and appends lines, each linked to the one before; returns what was written. */
const appendLines = (
  paths: AnchorPaths,
  prev: string,
  bodies: readonly ((prev: string) => AnchorLine)[],
): readonly AnchorLine[] => {
  const lines = bodies.reduce<{ prev: string; out: AnchorLine[] }>(
    (acc, make) => {
      const line = make(acc.prev);
      return { prev: lineHash(line), out: [...acc.out, line] };
    },
    { prev, out: [] },
  ).out;
  if (lines.length > 0) {
    appendFileSync(paths.log, lines.map(serializeLine).join(""), {
      mode: 0o600,
      flag: "a",
    });
  }
  return lines;
};

const writePem = (path: string, pem: string): void => {
  writeFileSync(path, pem, { mode: 0o600, flag: "wx" });
};

const newKeyPair = (): Readonly<{
  privatePem: string;
  publicPem: string;
  publicKey: string;
  privateKey: KeyObject;
}> => {
  const pair = generateKeyPairSync("ed25519");
  return {
    privatePem: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    publicKey: publicKeyText(pair.publicKey),
    privateKey: pair.privateKey,
  };
};

export type InitResult =
  | Readonly<{ kind: "created"; keyId: string }>
  | Readonly<{ kind: "exists"; keyId: string }>
  | Readonly<{ kind: "refused"; why: string }>;

/**
 * Creates the anchor key and the file's first line, once. Refuses when the
 * file exists without a key: that is a lost key, which `anchor:rotate
 * --without-old-key` handles so the break stays visible.
 */
export const initAnchorKey = (paths: AnchorPaths, now: Date): InitResult => {
  const current = readAnchorKey(paths);
  if (current.kind === "found") return { kind: "exists", keyId: current.keyId };
  if (current.kind === "unreadable") {
    return { kind: "refused", why: "the anchor key file exists but could not be read" };
  }
  ensureDirs(paths);
  return withLock(paths, () => {
    const read = readLogLines(paths);
    if (read.kind !== "missing" && !(read.kind === "found" && read.lines.length === 0)) {
      return {
        kind: "refused",
        why: "the anchors file exists but the key is gone; run `bun run anchor:rotate -- --without-old-key`",
      };
    }
    const pair = newKeyPair();
    writePem(paths.privateKey, pair.privatePem);
    writePem(paths.publicKey, pair.publicPem);
    const [line] = appendLines(paths, scanLog(paths).prev, [
      (prev) =>
        signLine(
          keyBody({ publicKey: pair.publicKey, at: now.toISOString(), prev }),
          pair.privateKey,
        ),
    ]);
    return { kind: "created", keyId: line.keyId };
  });
};

export type DueHead = Readonly<{ chain: ChainName; head: ChainHead }>;

/**
 * Signs and appends one anchor per head, under the lock, for the database
 * `databaseId` (`databaseIdOf`, #382). A file that names no database yet
 * first gets a line naming this one; a file that names another database is
 * left as it is and `AnchorDatabaseMismatch` is thrown.
 */
export const writeAnchors = (
  paths: AnchorPaths,
  heads: readonly DueHead[],
  now: Date,
  databaseId: string,
): readonly AnchorLine[] => {
  if (heads.length === 0) return [];
  const key = readAnchorKey(paths);
  if (key.kind !== "found") throw new AnchorKeyMissing("no usable anchor key");
  return withLock(paths, () => {
    const scan = scanLog(paths);
    if (scan.keyId !== key.keyId) {
      throw new AnchorLogDamaged("the anchors file does not end with this key");
    }
    if (scan.databaseId !== null && scan.databaseId !== databaseId) {
      throw new AnchorDatabaseMismatch({ logDatabaseId: scan.databaseId, databaseId });
    }
    const at = now.toISOString();
    const naming =
      scan.databaseId === null
        ? [
            (prev: string) =>
              signLine(
                databaseBody({ databaseId, at, keyId: key.keyId, prev }),
                key.privateKey,
              ),
          ]
        : [];
    return appendLines(paths, scan.prev, [
      ...naming,
      ...heads.map(
        ({ chain, head }) =>
          (prev: string) =>
            signLine(
              anchorBody({ chain, head, at, keyId: key.keyId, prev }),
              key.privateKey,
            ),
      ),
    ]);
  });
};

/** The database the anchors file names, or null (a file from before #382, or none yet). */
export const anchoredDatabase = (paths: AnchorPaths): string | null =>
  scanLog(paths).databaseId;

/** The newest anchor per chain, without checking signatures (the writer's view). */
export const latestAnchors = (paths: AnchorPaths): Scan["latest"] =>
  scanLog(paths).latest;

export type RotateResult =
  | Readonly<{ kind: "rotated"; oldKeyId: string | null; newKeyId: string }>
  | Readonly<{ kind: "refused"; why: string }>;

const retire = (paths: AnchorPaths, keyId: string): void => {
  const target = join(/* turbopackIgnore: true */ paths.retired, `${keyId}.pub`);
  if (!existsSync(target)) copyFileSync(paths.publicKey, target);
};

const publicIdOf = (paths: AnchorPaths): string | null => {
  try {
    const text = publicFromPem(readFileSync(paths.publicKey, "utf8"));
    return text === null ? null : keyIdOf(text);
  } catch {
    return null;
  }
};

/**
 * A new anchor key. Normally the old key signs a rotation line naming the
 * new one, and the old public key moves to `retired/` so old anchors still
 * verify. With `withoutOldKey` (the old key is lost or exposed) the new key
 * signs the line itself, the old private key is removed, and the Lab shows a
 * break in continuity.
 */
export const rotateAnchorKey = (
  paths: AnchorPaths,
  now: Date,
  options: Readonly<{ withoutOldKey: boolean }>,
): RotateResult => {
  const old = readAnchorKey(paths);
  if (!options.withoutOldKey && old.kind !== "found") {
    return {
      kind: "refused",
      why: "there is no usable anchor key to sign the rotation; use --without-old-key",
    };
  }
  ensureDirs(paths);
  return withLock(paths, () => {
    const scan = scanLog(paths);
    const pair = newKeyPair();
    const at = now.toISOString();
    const staged = `${paths.privateKey}.next`;
    rmSync(staged, { force: true });
    writePem(staged, pair.privatePem);
    if (old.kind === "found" && !options.withoutOldKey) {
      if (scan.keyId !== old.keyId) {
        rmSync(staged, { force: true });
        return {
          kind: "refused",
          why: "the anchors file does not end with the current key",
        };
      }
      appendLines(paths, scan.prev, [
        (prev) =>
          signLine(
            rotationBody({ oldKeyId: old.keyId, newPublicKey: pair.publicKey, at, prev }),
            old.privateKey,
          ),
      ]);
      retire(paths, old.keyId);
    } else {
      // Keep the old public key, if any, so earlier anchors still verify.
      const oldId = publicIdOf(paths);
      if (oldId !== null) retire(paths, oldId);
      rmSync(paths.privateKey, { force: true });
      appendLines(paths, scan.prev, [
        (prev) =>
          signLine(
            rotationBody({ oldKeyId: null, newPublicKey: pair.publicKey, at, prev }),
            pair.privateKey,
          ),
      ]);
    }
    renameSync(staged, paths.privateKey);
    rmSync(paths.publicKey, { force: true });
    writePem(paths.publicKey, pair.publicPem);
    return {
      kind: "rotated",
      oldKeyId: old.kind === "found" ? old.keyId : null,
      newKeyId: keyIdOf(pair.publicKey),
    };
  });
};
