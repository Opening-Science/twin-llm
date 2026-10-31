/**
 * Every sentence the unlock screens and routes show (#142). Plain words, no
 * technical detail; the server log gets error names only.
 */
export const VAULT_COPY = {
  setupTitle: "Set a passphrase",
  setupLead:
    "Your personal data stays locked on this machine until you type this passphrase. There is no way to read it without the passphrase or the recovery code you get next.",
  unlockTitle: "Your data is locked",
  unlockLead:
    "Type your passphrase to read your personal data. It locks again when you press Lock, after a while without use, and whenever the app restarts.",
  recoverTitle: "Use your recovery code",
  recoverLead:
    "The recovery code opens your data once and then asks for a new passphrase. You get a new recovery code afterwards; the old one stops working.",
  codeTitle: "Your recovery code",
  codeLead:
    "Write this down or keep it in a password manager. It is shown only now. With it you can set a new passphrase if you forget yours.",
  codeSaved: "I have saved my recovery code",
  passphraseLabel: "Passphrase",
  newPassphraseLabel: "New passphrase",
  repeatLabel: "Type it again",
  codeLabel: "Recovery code",
  passphraseHint: "At least 12 characters. A few unrelated words work well.",
  mismatch: "The two passphrases are not the same.",
  setUp: "Set passphrase",
  unlock: "Unlock",
  recover: "Hold to replace passphrase and recovery code",
  recovering: "Replacing…",
  forgot: "Forgot your passphrase?",
  backToUnlock: "Back to unlock",
  continue: "Continue",
  lock: "Lock",
  locked: "Locked",
  lockFailed: "Could not lock just now. Try again.",
  notSetUp: "Set a passphrase first.",
  alreadySetUp: "A passphrase is already set. Unlock instead.",
  unreadable: "The key file could not be read. See the runbook, section Local unlock.",
  wrongPassphrase: "That passphrase did not unlock your data.",
  wrongCode: "That recovery code did not unlock your data.",
  codeShape: "That does not look like a recovery code. It has 32 letters and digits.",
  setupFailed: "Your passphrase could not be saved. Nothing was changed. Try again.",
  notRecorded: "The unlock could not be recorded, so your data stays locked. Try again.",
  badRequest: "That request did not look right. Try again.",
  syntheticMode: "This install holds synthetic data only, so there is nothing to unlock.",
  failed: "Something went wrong. Try again.",
  wait: (seconds: number): string =>
    `Too many tries. Wait ${seconds} ${seconds === 1 ? "second" : "seconds"} and try again.`,
} as const;
