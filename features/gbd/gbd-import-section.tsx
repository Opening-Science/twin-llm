"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/infrastructure/ui-kit/button";
import { Field } from "@/infrastructure/ui-kit/field";
import { isSoftHidden } from "@/infrastructure/ui-kit/soft-delete";
import { StatusLattice } from "@/infrastructure/ui-kit/status-lattice";
import { UndoButton } from "@/infrastructure/ui-kit/undo-button";
import { useSoftDelete } from "@/infrastructure/ui-kit/use-soft-delete";
import type { GbdImportView } from "@/packages/gbd-local/store-types";

import {
  GBD_CITATION_HEADER,
  GBD_FILE_NAME_HEADER,
  type GbdImportEvent,
  readEvents,
} from "./gbd-import-events";
import {
  gbdImportCountsLabel,
  gbdImportedOn,
  gbdLatticeState,
  gbdStatusText,
  type GbdUploadStatus,
  splitGbdSelection,
} from "./gbd-import-labels";
import { GBD_IMPORT_MESSAGES } from "./gbd-import-messages";
import type { GbdImportsState } from "./gbd-import-routes";

/**
 * Customize · Data, "Population data": import CSV files from IHME's GBD
 * Results Tool and the download's citation.txt, and delete imported files
 * (#426). Each CSV is sent on its own, one after the other; the lattice
 * shows sending, then reading as the server reports rows, then the outcome.
 * Delete folds the row with Undo for five seconds before the server deletes.
 */

type Upload = Readonly<{ id: number; name: string; status: GbdUploadStatus }>;

const statusOf = (event: GbdImportEvent): GbdUploadStatus => {
  switch (event.type) {
    case "progress":
      return { phase: "reading", rows: event.rows };
    case "imported":
      return { phase: "imported", rowCount: event.rowCount, newRows: event.newRows };
    case "already-imported":
      return { phase: "skipped" };
    case "refused":
      return { phase: "refused", error: event.error };
    case "failed":
      return { phase: "failed", message: event.message };
  }
};

/** Sends one file; `update` gets each status as it changes. */
const sendFile = (
  file: File,
  citation: string | null,
  update: (status: GbdUploadStatus) => void,
): Promise<void> =>
  new Promise((resolve) => {
    const request = new XMLHttpRequest();
    // Mutable on purpose: how much of the streamed answer has been read.
    const read = { at: 0, rest: "", last: null as GbdUploadStatus | null };
    const take = () => {
      const text = request.responseText.slice(read.at);
      read.at = request.responseText.length;
      const { events, rest } = readEvents(read.rest + text);
      read.rest = rest;
      events.forEach((event) => {
        read.last = statusOf(event);
        update(read.last);
      });
    };
    request.open("POST", "/api/gbd/imports");
    request.setRequestHeader("content-type", "text/csv");
    request.setRequestHeader(GBD_FILE_NAME_HEADER, encodeURIComponent(file.name));
    if (citation !== null) {
      request.setRequestHeader(GBD_CITATION_HEADER, encodeURIComponent(citation));
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        update({ phase: "sending", percent: (event.loaded / event.total) * 100 });
      }
    };
    request.upload.onload = () => update({ phase: "reading", rows: 0 });
    request.onprogress = take;
    request.onload = () => {
      if (request.status >= 400) {
        const body = ((): unknown => {
          try {
            return JSON.parse(request.responseText);
          } catch {
            return null;
          }
        })();
        const error =
          typeof body === "object" && body !== null ? Reflect.get(body, "error") : null;
        update({
          phase: "failed",
          message: typeof error === "string" ? error : GBD_IMPORT_MESSAGES.failed,
        });
        resolve();
        return;
      }
      take();
      if (read.last === null || read.last.phase === "reading") {
        update({ phase: "failed", message: GBD_IMPORT_MESSAGES.failed });
      }
      resolve();
    };
    request.onerror = () => {
      update({ phase: "failed", message: GBD_IMPORT_MESSAGES.failed });
      resolve();
    };
    request.send(file);
  });

const ImportForm = () => {
  const router = useRouter();
  const [files, setFiles] = useState<readonly File[]>([]);
  const [uploads, setUploads] = useState<readonly Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const busy = uploads.some((upload) => gbdLatticeState(upload.status) === "working");

  const start = async () => {
    const { csv, citation } = splitGbdSelection(files);
    if (csv.length === 0) {
      setError(
        citation === null ? GBD_IMPORT_MESSAGES.notCsv : GBD_IMPORT_MESSAGES.citationOnly,
      );
      return;
    }
    setError(null);
    const citationText =
      citation === null ? null : await citation.text().catch(() => null);
    setUploads(
      csv.map((file, id) => ({ id, name: file.name, status: { phase: "waiting" } })),
    );
    for (const [id, file] of csv.entries()) {
      await sendFile(file, citationText, (status) =>
        setUploads((current) =>
          current.map((upload) => (upload.id === id ? { ...upload, status } : upload)),
        ),
      );
    }
    router.refresh();
  };

  const { other } = splitGbdSelection(files);
  return (
    <div className="surface mt-4 p-4 sm:p-5">
      <Field
        label="GBD files"
        type="file"
        multiple
        accept=".csv,.txt,text/csv,text/plain"
        disabled={busy}
        hint="The CSV files of one Results Tool download (Both IDs and names), and its citation.txt. Up to 50 MB each."
        error={error ?? undefined}
        onChange={(event) => {
          setError(null);
          setFiles(Array.from(event.target.files ?? []));
        }}
      />
      {other.length > 0 && (
        <p className="text-muted-foreground mt-2 text-xs">
          Left out: {other.map((file) => file.name).join(", ")}.
        </p>
      )}
      <div className="mt-4">
        <Button
          variant="primary"
          disabled={busy || files.length === 0}
          onClick={() => void start()}
        >
          Import
        </Button>
      </div>
      {uploads.length > 0 && (
        <ul className="mt-4 grid gap-3" aria-label="GBD imports in progress">
          {uploads.map((upload) => (
            <li key={upload.id} className="min-w-0">
              <StatusLattice
                state={gbdLatticeState(upload.status)}
                label={upload.name}
                className="font-mono text-xs"
              />
              <p
                className={
                  gbdLatticeState(upload.status) === "error"
                    ? "text-destructive mt-1 text-sm break-words"
                    : "text-muted-foreground mt-1 text-sm"
                }
              >
                {gbdStatusText(upload.status)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const ImportRow = ({ view }: Readonly<{ view: GbdImportView }>) => {
  const router = useRouter();
  const removal = useSoftDelete(async () => {
    try {
      const response = await fetch(`/api/gbd/imports/${view.sha256}`, {
        method: "DELETE",
      });
      if (response.ok) {
        router.refresh();
        return null;
      }
      const body = (await response.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      return typeof body?.error === "string"
        ? body.error
        : GBD_IMPORT_MESSAGES.deleteFailed;
    } catch {
      return GBD_IMPORT_MESSAGES.deleteFailed;
    }
  });
  const hidden = isSoftHidden(removal.phase);
  return (
    <li className={hidden ? "surface px-4 py-2" : "surface p-4"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        {hidden ? (
          <p className="text-muted-foreground min-w-0 self-center text-sm break-all">
            {view.fileName} deleted.
          </p>
        ) : (
          <div className="min-w-0 flex-1">
            <h3 className="text-sm break-all">{view.fileName}</h3>
            <p className="text-muted-foreground mt-1 text-xs">
              GBD {view.release} · {gbdImportCountsLabel(view)} · imported{" "}
              {gbdImportedOn(view)}
            </p>
            <p className="mt-2 text-xs leading-relaxed break-words">
              {view.citation ?? "No citation.txt came with this file."}
            </p>
            <p className="text-muted-foreground mt-1 font-mono text-[11px] break-all">
              SHA-256 {view.sha256}
            </p>
          </div>
        )}
        <UndoButton
          label="Delete"
          actedText={`${view.fileName} deleted.`}
          size="sm"
          variant="ghost"
          disabled={removal.phase === "deleting"}
          onAct={removal.controls.act}
          onUndo={removal.controls.undo}
          onExpire={removal.controls.expire}
        />
      </div>
      {removal.error !== null && !hidden && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {removal.error}
        </p>
      )}
    </li>
  );
};

export const GbdImportSection = ({ data }: Readonly<{ data: GbdImportsState }>) => (
  <section aria-labelledby="gbd-data" className="mt-10">
    <h2 id="gbd-data" className="text-lg">
      Population data (IHME GBD)
    </h2>
    <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-relaxed">
      Estimates you downloaded from IHME&apos;s Global Burden of Disease Results Tool, for
      the chat&apos;s population questions. They describe populations, never a person.
      Files are read on this machine and stored in TwinLLM&apos;s database; a file already
      imported is skipped. See{" "}
      <Link className="underline" href="/docs/gbd">
        how to export them
      </Link>
      .
    </p>
    {data.state === "not-local" ? (
      <p className="surface text-muted-foreground mt-4 p-4 text-sm">
        {GBD_IMPORT_MESSAGES.notLocal}
      </p>
    ) : (
      <>
        <ImportForm />
        {data.imports.length === 0 ? (
          <p className="text-muted-foreground mt-4 text-sm">No GBD files imported yet.</p>
        ) : (
          <ul className="mt-4 grid gap-3" aria-label="Imported GBD files">
            {data.imports.map((view) => (
              <ImportRow key={view.sha256} view={view} />
            ))}
          </ul>
        )}
      </>
    )}
  </section>
);
