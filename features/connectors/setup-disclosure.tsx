import type { ReactNode } from "react";

import type { ConnectorSetupView, EnvCheck } from "./connector-setup";

/**
 * The "Setup" disclosure on every connector card: env names with set / missing,
 * the redirect URI to register, the commands, and a link to the guide. It gets
 * names and booleans from the server, never a value.
 */

const checkWord = (check: EnvCheck): string => {
  if (check.looksEmpty) return "looks empty, check .env.local";
  if (check.set) return "set";
  return check.optional ? "optional" : "missing";
};

const summaryCount = (checks: readonly EnvCheck[]): string | null => {
  const required = checks.filter((check) => !check.optional);
  if (required.length === 0) return null;
  const set = required.filter((check) => check.set).length;
  return `${set} of ${required.length} set`;
};

type SetupDisclosureProps = Readonly<{
  setup: ConnectorSetupView;
  /** Open by default, e.g. when the connector is not configured. */
  open?: boolean;
  /** Connector-specific words above the env list. */
  note?: ReactNode;
}>;

export const SetupDisclosure = ({ setup, open = false, note }: SetupDisclosureProps) => {
  const count = summaryCount(setup.checks);
  const redirectName = setup.checks.find((check) =>
    check.name.endsWith("_REDIRECT_URI"),
  )?.name;

  return (
    <details className="setup-disclosure" open={open}>
      <summary>
        Setup
        {count && <span className="text-muted-foreground font-normal"> · {count}</span>}
      </summary>
      <div className="mt-3 space-y-3 text-xs leading-relaxed">
        {note}
        {setup.checks.length > 0 && (
          <ul className="space-y-1" aria-label="Environment variables">
            {setup.checks.map((check) => (
              <li key={check.name} className="flex flex-wrap items-baseline gap-x-2">
                <code className="setup-code">{check.name}</code>
                <span
                  data-state={check.looksEmpty ? "empty" : check.set ? "set" : "missing"}
                  className={
                    check.set ? "text-muted-foreground" : "text-foreground font-medium"
                  }
                >
                  {checkWord(check)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {setup.redirectUri && (
          <div>
            <p className="text-muted-foreground">Register this redirect URI:</p>
            <code className="setup-code mt-1 block">{setup.redirectUri}</code>
            {setup.redirectMatches === false && redirectName && (
              <p className="mt-1 font-medium">
                {redirectName} is set to a different URI. It must match the one the vendor
                app lists.
              </p>
            )}
          </div>
        )}
        {setup.steps.length > 0 && (
          <ol className="list-decimal space-y-2 pl-4">
            {setup.steps.map((step) => (
              <li key={step.text}>
                {step.text}
                {step.command && (
                  <code className="setup-code mt-1 block">{step.command}</code>
                )}
              </li>
            ))}
          </ol>
        )}
        <a href={setup.doc} target="_blank" rel="noreferrer" className="setup-link">
          Setup guide
        </a>
      </div>
    </details>
  );
};
