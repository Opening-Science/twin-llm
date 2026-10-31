/**
 * The flags of `scripts/anchor/anchor.ts` (#300): one command per run.
 *
 *   init                     create the anchor key and the file's first line (once)
 *   write                    anchor each chain whose head moved, now
 *   rotate [--without-old-key]  a new key, signed over by the old one (or not, when it is lost)
 *   export                   print the newest anchors and the public key, to keep elsewhere
 */

export const ANCHOR_COMMANDS = ["init", "write", "rotate", "export"] as const;

export type AnchorCommand = (typeof ANCHOR_COMMANDS)[number];

export type AnchorArgs = Readonly<{ command: AnchorCommand; withoutOldKey: boolean }>;

export const ANCHOR_USAGE =
  "Usage: bun run anchor:init | anchor:write | anchor:rotate [-- --without-old-key] | anchor:export";

export const parseAnchorArgs = (
  argv: readonly string[],
): Readonly<{ ok: true; args: AnchorArgs }> | Readonly<{ ok: false; error: string }> => {
  const words = argv.filter((arg) => arg !== "--");
  const command = ANCHOR_COMMANDS.find((name) => name === words[0]);
  if (command === undefined) return { ok: false, error: ANCHOR_USAGE };
  const flags = words.slice(1);
  const withoutOldKey = flags.includes("--without-old-key");
  const unknown = flags.filter((flag) => flag !== "--without-old-key");
  if (unknown.length > 0) {
    return { ok: false, error: `anchor: unknown flag ${unknown[0]}\n${ANCHOR_USAGE}` };
  }
  if (withoutOldKey && command !== "rotate") {
    return { ok: false, error: "anchor: --without-old-key goes with rotate only" };
  }
  return { ok: true, args: { command, withoutOldKey } };
};
