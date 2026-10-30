"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/infrastructure/ui-kit/button";
import { Field } from "@/infrastructure/ui-kit/field";
import { MAX_FILE_BYTES } from "@/packages/personal-data/limits";
import type { ImportKind } from "@/packages/personal-data/types";

import { IMPORT_FORMATS, ISSUES_URL, NEXT_FORMATS } from "./import-formats";
import { byteSizeLabel, countLabel } from "./import-labels";
import { IMPORT_MESSAGES } from "./import-messages";
import type { ReviewPayload, SavePayload } from "./import-routes";
import { ReviewView } from "./review-view";

/**
 * Import → pick a format → choose a file → the server reads it and answers
 * with a review → Save or Cancel. The file stays in this tab between review
 * and Save and is sent again on Save, where the server checks it is the same
 * file (SHA-256) before storing anything. Cancel just forgets it.
 */

type Reviewed = Extract<ReviewPayload, { ok: true }>;

type Step =
  | Readonly<{ step: "closed" }>
  | Readonly<{ step: "choose"; error: string | null }>
  | Readonly<{ step: "reading" }>
  | Readonly<{ step: "review"; reviewed: Reviewed; error: string | null }>
  | Readonly<{ step: "saving"; reviewed: Reviewed }>;

const send = async <T,>(
  url: string,
  body: FormData,
): Promise<T | { ok: false; error: string }> => {
  try {
    const response = await fetch(url, { method: "POST", body });
    return (await response.json()) as T;
  } catch {
    return { ok: false, error: IMPORT_MESSAGES.failed };
  }
};

export const ImportPanel = () => {
  const router = useRouter();
  const [state, setState] = useState<Step>({ step: "closed" });
  const [kind, setKind] = useState<ImportKind>("fhir");
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  const format = IMPORT_FORMATS.find((entry) => entry.kind === kind)!;

  const reset = () => {
    setState({ step: "closed" });
    setFile(null);
    setName("");
  };

  const review = async () => {
    if (file === null) {
      setState({ step: "choose", error: IMPORT_MESSAGES.noFile });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setState({ step: "choose", error: IMPORT_MESSAGES.tooLarge });
      return;
    }
    setState({ step: "reading" });
    const body = new FormData();
    body.set("kind", kind);
    body.set("file", file);
    const payload = await send<ReviewPayload>("/api/personal-data/review", body);
    if (!payload.ok) {
      setState({ step: "choose", error: payload.error });
      return;
    }
    const dot = file.name.lastIndexOf(".");
    setName(dot > 0 ? file.name.slice(0, dot) : file.name);
    setState({ step: "review", reviewed: payload, error: null });
  };

  const save = async (reviewed: Reviewed) => {
    if (file === null) return;
    setState({ step: "saving", reviewed });
    const body = new FormData();
    body.set("kind", kind);
    body.set("file", file);
    body.set("sha256", reviewed.review.sha256);
    body.set("name", name);
    const payload = await send<SavePayload>("/api/personal-data/datasets", body);
    if (!payload.ok) {
      setState({ step: "review", reviewed, error: payload.error });
      return;
    }
    setSaved(payload.dataset.name);
    reset();
    router.refresh();
  };

  if (state.step === "closed") {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          onClick={() => {
            setSaved(null);
            setState({ step: "choose", error: null });
          }}
        >
          Import
        </Button>
        {saved !== null && (
          <p role="status" className="text-muted-foreground text-sm">
            Saved “{saved}”.
          </p>
        )}
      </div>
    );
  }

  if (state.step === "review" || state.step === "saving") {
    const { reviewed } = state;
    const duplicate = reviewed.duplicateOf;
    const empty = reviewed.review.rowsToStore === 0;
    return (
      <section aria-labelledby="import-review" className="surface mt-4 p-4 sm:p-5">
        <h3 id="import-review" className="text-base">
          Review before saving
        </h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Nothing is stored until you press Save.
        </p>
        <div className="mt-4">
          <ReviewView review={reviewed.review} />
        </div>
        {duplicate !== null && (
          <p role="alert" className="text-destructive mt-4 text-sm">
            You already imported this file as “{duplicate.name}”. Delete that dataset
            first to import it again.
          </p>
        )}
        {empty && (
          <p role="alert" className="text-destructive mt-4 text-sm">
            {IMPORT_MESSAGES.nothingToStore}
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-end gap-3">
          <Field
            label="Dataset name"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            className="min-w-60 flex-1"
            error={state.step === "review" ? (state.error ?? undefined) : undefined}
          />
          <Button
            variant="primary"
            disabled={state.step === "saving" || duplicate !== null || empty}
            onClick={() => void save(reviewed)}
          >
            {state.step === "saving"
              ? "Saving…"
              : `Save ${countLabel(reviewed.review.rowsToStore, "row", "rows")}`}
          </Button>
          <Button disabled={state.step === "saving"} onClick={reset}>
            Cancel
          </Button>
        </div>
        {state.step === "saving" && (
          <p role="status" className="text-muted-foreground mt-3 text-sm">
            Saving. Large tables take a little while.
          </p>
        )}
      </section>
    );
  }

  const reading = state.step === "reading";
  return (
    <section aria-labelledby="import-choose" className="surface mt-4 p-4 sm:p-5">
      <h3 id="import-choose" className="text-base">
        Import a file
      </h3>
      <fieldset className="mt-3" disabled={reading}>
        <legend className="text-muted-foreground text-xs font-medium">Format</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {IMPORT_FORMATS.map((entry) => (
            <label
              key={entry.kind}
              className="has-checked:border-primary border-border grid cursor-pointer grid-cols-[auto_1fr] gap-x-2 rounded-lg border p-3 text-sm"
            >
              <input
                type="radio"
                name="import-format"
                value={entry.kind}
                checked={kind === entry.kind}
                onChange={() => setKind(entry.kind)}
                className="mt-1"
              />
              <span>{entry.label}</span>
              <span className="text-muted-foreground col-start-2 mt-1 text-xs leading-relaxed">
                {entry.detail}
              </span>
            </label>
          ))}
        </div>
        {NEXT_FORMATS.length > 0 && (
          <p className="text-muted-foreground mt-3 text-xs">
            Coming next:{" "}
            {NEXT_FORMATS.map((next, index) => (
              <span key={next.issue}>
                {index > 0 && ", "}
                {next.label} (
                <a
                  className="underline"
                  href={`${ISSUES_URL}/${next.issue}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  #{next.issue}
                </a>
                )
              </span>
            ))}
            .
          </p>
        )}
      </fieldset>
      <div className="mt-4">
        <Field
          label="File"
          type="file"
          accept={format.accept}
          disabled={reading}
          hint="Up to 50 MB. Read on this machine; nothing is stored before you review it."
          error={state.step === "choose" ? (state.error ?? undefined) : undefined}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </div>
      {reading && (
        <div role="status" className="mt-4 flex items-center gap-3 text-sm">
          <progress aria-label="Reading the file" className="h-1.5 w-40" />
          <span className="text-muted-foreground">
            Reading {file === null ? "the file" : byteSizeLabel(file.size)}…
          </span>
        </div>
      )}
      <div className="mt-4 flex gap-3">
        <Button variant="primary" disabled={reading} onClick={() => void review()}>
          Review
        </Button>
        <Button disabled={reading} onClick={reset}>
          Cancel
        </Button>
      </div>
    </section>
  );
};
