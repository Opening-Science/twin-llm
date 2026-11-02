import Link from "next/link";

import { StatusBadge } from "@/infrastructure/ui-kit/status-badge";

import type { LedgerView } from "./disclosure-view";

/**
 * Customize · Privacy, "What left this machine" (#140): running totals per
 * recipient, then the latest events with what each carried. Behind the
 * unlock like the rest of the page. Server-rendered.
 */

const RECIPIENT_COLUMNS = [
  "Recipient",
  "Direction",
  "Events",
  "Values",
  "Size",
  "First",
  "Last",
] as const;

export const DisclosureSection = ({ view }: Readonly<{ view: LedgerView }>) => (
  <section aria-labelledby="ledger-heading" className="mt-10">
    <h2 id="ledger-heading" className="text-lg">
      What left this machine
    </h2>
    <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
      Every request to a model that does not run on this machine, every wearable sync,
      every exported thread, every analytics event and every report your Ark released is
      written here before it happens. If it cannot be written, it does not happen. Each
      entry lists who received it, why, what kind of data it carried and how much, never
      the data itself. Values are counted as references to what is stored here, such as a
      metric and its day.
    </p>
    <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
      Before a request to a model goes out, its text (your own words, answers and tool
      results) is checked for values stored here: rsIDs and genome sites of your imported
      files, their file names, body scan labels and your account id; lab values with their
      unit, measure codes next to your own value, clinical record codes and long names,
      and lines of your twin notes. A value you typed yourself is not counted. Each entry
      says what kinds were found and how many, never the values. The check is approximate:
      a value written another way is missed, and wearable numbers are not checked. A
      request that holds rsIDs or genome sites from your imported files is not sent, and
      its entry says Blocked. So is one with rsID- or site-shaped text when the check
      itself fails. Other matches are recorded and the request still goes. Entries from
      before the check say not checked. A model on this machine (Ollama on loopback) is
      not a recipient.
    </p>
    {view.recipients.length === 0 ? (
      <p className="mt-4 text-sm">
        Nothing has left this machine since the ledger began.
      </p>
    ) : (
      <>
        <div className="lab-table-wrap mt-4">
          <table className="lab-table">
            <caption className="sr-only">Running totals per recipient</caption>
            <thead>
              <tr>
                {RECIPIENT_COLUMNS.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.recipients.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.recipient}</th>
                  <td>{row.direction}</td>
                  <td>{row.events}</td>
                  <td>{row.values}</td>
                  <td>{row.size}</td>
                  <td>{row.since}</td>
                  <td>{row.last}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 className="mt-6 font-medium">Events</h3>
        {view.shownOf === null ? null : (
          <p className="text-muted-foreground mt-1 text-sm">{view.shownOf}</p>
        )}
        <ol className="mt-3 flex flex-col gap-3">
          {view.entries.map((entry) => (
            <li key={entry.key} className="surface flex flex-col gap-1.5 p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium break-all">{entry.recipient}</span>
                <span className="flex items-center gap-2">
                  {entry.synthetic ? (
                    <StatusBadge tone="neutral">Synthetic</StatusBadge>
                  ) : null}
                  <span className="text-muted-foreground font-mono text-xs">
                    {entry.when}
                  </span>
                </span>
              </div>
              <p>
                {entry.direction} · {entry.what}
              </p>
              <p className="text-muted-foreground">
                Carried: {entry.categories}. Values: {entry.values}. Size: {entry.size}.
                {entry.threadHref === null ? null : (
                  <>
                    {" "}
                    <Link className="setup-link" href={entry.threadHref}>
                      Open the thread
                    </Link>
                  </>
                )}
              </p>
              <p className="text-muted-foreground">
                Free text:{" "}
                {entry.freeTextFound ? (
                  <StatusBadge tone="warn">{entry.freeText}</StatusBadge>
                ) : (
                  entry.freeText
                )}
                .
              </p>
              {entry.refs.length === 0 ? null : (
                <details className="setup-disclosure">
                  <summary>Which stored values ({entry.refs.length})</summary>
                  <ul className="mt-2 flex flex-col gap-1">
                    {entry.refs.map((ref) => (
                      <li key={ref} className="font-mono text-xs break-all">
                        {ref}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ol>
      </>
    )}
  </section>
);
