"use client";

import { type FormEvent, useEffect, useState } from "react";

import { Button } from "@/infrastructure/ui-kit/button";
import { Card } from "@/infrastructure/ui-kit/card";
import { Field } from "@/infrastructure/ui-kit/field";
import { HoldToSubmit } from "@/infrastructure/ui-kit/hold-to-submit";

import { VAULT_COPY } from "./vault-copy";
import {
  errorFrom,
  newPassphraseProblem,
  recoveryCodeIn,
  VAULT_ROUTE,
  type VaultStep,
} from "./vault-screen-model";

/**
 * Shown in place of a personal page while the data is locked (#142): set a
 * passphrase (first run), unlock, or use the recovery code; after setup or
 * recovery, the new recovery code once. On load it asks the server whether
 * this browser is already unlocked, because the unlock cookie is
 * SameSite=Strict and is not sent when the page was reached from another
 * site (an OAuth return); a reload from here sends it.
 *
 * Using the recovery code replaces the passphrase and the recovery code for
 * good, so that form submits only through a completed press and hold (#350).
 */

const reload = () => window.location.replace(window.location.href);

const LockGlyph = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="text-muted-foreground size-6"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

const post = async (
  url: string,
  body: Readonly<Record<string, string>>,
): Promise<Readonly<{ ok: boolean; body: unknown }>> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  return { ok: response.ok, body: await response.json().catch(() => null) };
};

const CodeStep = ({ code }: Readonly<{ code: string }>) => {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <>
      <h1 className="text-xl">{VAULT_COPY.codeTitle}</h1>
      <p className="text-muted-foreground text-sm leading-relaxed">
        {VAULT_COPY.codeLead}
      </p>
      <p
        className="bg-muted grid grid-cols-4 justify-items-center gap-x-2 gap-y-1 rounded-md px-3 py-3 font-mono text-base tracking-wider"
        aria-label={VAULT_COPY.codeLabel}
      >
        {code.split("-").map((group, index) => (
          <span key={`${index}-${group}`} className="whitespace-nowrap">
            {group}
          </span>
        ))}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(code)
              .then(() => setCopied(true))
              .catch(() => undefined);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
        />
        {VAULT_COPY.codeSaved}
      </label>
      <Button variant="primary" type="button" disabled={!saved} onClick={reload}>
        {VAULT_COPY.continue}
      </Button>
    </>
  );
};

export const VaultScreen = ({ initialStep }: Readonly<{ initialStep: VaultStep }>) => {
  const [step, setStep] = useState<VaultStep>(initialStep);
  const [passphrase, setPassphrase] = useState("");
  const [repeat, setRepeat] = useState("");
  const [code, setCode] = useState("");
  const [shownCode, setShownCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A refused try gives the hold button a fresh start, even one refused here.
  const [tries, setTries] = useState(0);

  useEffect(() => {
    void fetch("/api/vault/status", { credentials: "same-origin" })
      .then((response) => response.json())
      .then((body: unknown) => {
        if (typeof body === "object" && body !== null) {
          if (Reflect.get(body, "status") === "unlocked") reload();
        }
      })
      .catch(() => undefined);
  }, []);

  const goTo = (next: VaultStep) => {
    setStep(next);
    setPassphrase("");
    setRepeat("");
    setCode("");
    setError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step === "code") return;
    const problem = step === "unlock" ? null : newPassphraseProblem(passphrase, repeat);
    if (problem !== null) {
      setError(problem);
      setTries((value) => value + 1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await post(
        VAULT_ROUTE[step],
        step === "recover" ? { code, passphrase } : { passphrase },
      );
      setPassphrase("");
      setRepeat("");
      if (!result.ok) {
        setError(errorFrom(result.body));
        return;
      }
      const recoveryCode = recoveryCodeIn(result.body);
      if (recoveryCode !== null) {
        setShownCode(recoveryCode);
        setCode("");
        setStep("code");
        return;
      }
      reload();
    } catch {
      setError(VAULT_COPY.failed);
    } finally {
      setBusy(false);
    }
  };

  const title =
    step === "setup"
      ? VAULT_COPY.setupTitle
      : step === "recover"
        ? VAULT_COPY.recoverTitle
        : VAULT_COPY.unlockTitle;
  const lead =
    step === "setup"
      ? VAULT_COPY.setupLead
      : step === "recover"
        ? VAULT_COPY.recoverLead
        : VAULT_COPY.unlockLead;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col px-4 py-8">
      <Card padding="lg" className="flex flex-col gap-4">
        <LockGlyph />
        {step === "code" && shownCode !== null ? (
          <CodeStep code={shownCode} />
        ) : (
          <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
            <h1 className="text-xl">{title}</h1>
            <p className="text-muted-foreground text-sm leading-relaxed">{lead}</p>
            {step === "recover" ? (
              <Field
                label={VAULT_COPY.codeLabel}
                name="code"
                autoComplete="off"
                spellCheck={false}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
            ) : null}
            <Field
              label={
                step === "unlock"
                  ? VAULT_COPY.passphraseLabel
                  : VAULT_COPY.newPassphraseLabel
              }
              type="password"
              name="passphrase"
              autoComplete={step === "unlock" ? "current-password" : "new-password"}
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              hint={step === "unlock" ? undefined : VAULT_COPY.passphraseHint}
              required
            />
            {step === "unlock" ? null : (
              <Field
                label={VAULT_COPY.repeatLabel}
                type="password"
                name="repeat"
                autoComplete="new-password"
                value={repeat}
                onChange={(event) => setRepeat(event.target.value)}
                required
              />
            )}
            <p role="alert" className="text-destructive min-h-5 text-sm">
              {error}
            </p>
            {step === "recover" ? (
              <HoldToSubmit
                key={tries}
                variant="primary"
                label={VAULT_COPY.recover}
                pendingLabel={VAULT_COPY.recovering}
                pending={busy}
              />
            ) : (
              <Button variant="primary" type="submit" disabled={busy}>
                {step === "setup" ? VAULT_COPY.setUp : VAULT_COPY.unlock}
              </Button>
            )}
            {step === "unlock" ? (
              <Button variant="ghost" type="button" onClick={() => goTo("recover")}>
                {VAULT_COPY.forgot}
              </Button>
            ) : null}
            {step === "recover" ? (
              <Button variant="ghost" type="button" onClick={() => goTo("unlock")}>
                {VAULT_COPY.backToUnlock}
              </Button>
            ) : null}
          </form>
        )}
      </Card>
    </div>
  );
};
