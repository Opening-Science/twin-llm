"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { DatasetView } from "@/infrastructure/personal-data-store";
import { Button } from "@/infrastructure/ui-kit/button";
import { Field } from "@/infrastructure/ui-kit/field";
import { isSoftHidden } from "@/infrastructure/ui-kit/soft-delete";
import { UndoButton } from "@/infrastructure/ui-kit/undo-button";
import { useSoftDelete } from "@/infrastructure/ui-kit/use-soft-delete";

import { kindLabel } from "./import-formats";
import { datasetContentsLabel, storedDateLabel } from "./import-labels";
import { IMPORT_MESSAGES } from "./import-messages";

/**
 * The person's imported datasets: rename, or delete for good.
 *
 * Delete folds the row to one line ("… deleted") with Undo for five seconds;
 * the server deletes the rows only when that time runs out, and only that
 * delete is audited. Going to another page first deletes it then; closing
 * the tab first makes the browser ask, and leaving keeps the dataset
 * (`infrastructure/ui-kit/soft-delete.ts`).
 */

type Mode =
  | Readonly<{ mode: "idle" }>
  | Readonly<{ mode: "rename"; name: string }>
  | Readonly<{ mode: "busy" }>;

const call = async (url: string, init: RequestInit): Promise<string | null> => {
  try {
    const response = await fetch(url, init);
    if (response.ok) return null;
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : IMPORT_MESSAGES.failed;
  } catch {
    return IMPORT_MESSAGES.failed;
  }
};

const DatasetRow = ({ dataset }: Readonly<{ dataset: DatasetView }>) => {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>({ mode: "idle" });
  const [error, setError] = useState<string | null>(null);
  const url = `/api/personal-data/datasets/${encodeURIComponent(dataset.id)}`;

  const finish = (failed: string | null) => {
    setError(failed);
    setMode({ mode: "idle" });
    if (failed === null) router.refresh();
  };

  const rename = async (name: string) => {
    setMode({ mode: "busy" });
    finish(
      await call(url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      }),
    );
  };

  const removal = useSoftDelete(async () => {
    const failed = await call(url, { method: "DELETE" });
    if (failed === null) router.refresh();
    return failed;
  });
  const hidden = isSoftHidden(removal.phase);

  const busy = mode.mode === "busy" || removal.phase === "deleting";
  return (
    <li className={hidden ? "surface px-4 py-2" : "surface p-4"}>
      {mode.mode === "rename" ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void rename(mode.name);
          }}
        >
          <Field
            label="Dataset name"
            value={mode.name}
            maxLength={120}
            onChange={(event) => setMode({ mode: "rename", name: event.target.value })}
            className="min-w-60 flex-1"
          />
          <Button type="submit" variant="primary">
            Save name
          </Button>
          <Button onClick={() => setMode({ mode: "idle" })}>Cancel</Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3">
          {hidden ? (
            <p className="text-muted-foreground min-w-0 self-center text-sm break-words">
              {dataset.name} deleted.
            </p>
          ) : (
            <div className="min-w-0">
              <h3 className="text-sm break-words">{dataset.name}</h3>
              <p className="text-muted-foreground mt-1 text-xs">
                {kindLabel(dataset.kind)} · {datasetContentsLabel(dataset)}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs break-all">
                From {dataset.sourceFileName}, imported{" "}
                {storedDateLabel(dataset.createdAt)}
              </p>
            </div>
          )}
          <div className="flex gap-2">
            {!hidden && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => setMode({ mode: "rename", name: dataset.name })}
              >
                Rename
              </Button>
            )}
            <UndoButton
              label="Delete"
              actedText={`${dataset.name} deleted.`}
              size="sm"
              variant="ghost"
              disabled={busy}
              onAct={removal.controls.act}
              onUndo={removal.controls.undo}
              onExpire={removal.controls.expire}
            />
          </div>
        </div>
      )}
      {(error ?? removal.error) !== null && !hidden && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {error ?? removal.error}
        </p>
      )}
    </li>
  );
};

export const DatasetList = ({
  datasets,
}: Readonly<{ datasets: readonly DatasetView[] }>) =>
  datasets.length === 0 ? (
    <p className="text-muted-foreground mt-4 text-sm">No imports yet.</p>
  ) : (
    <ul className="mt-4 grid gap-3">
      {datasets.map((dataset) => (
        <DatasetRow key={dataset.id} dataset={dataset} />
      ))}
    </ul>
  );
