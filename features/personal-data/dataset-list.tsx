"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { DatasetView } from "@/infrastructure/personal-data-store";
import { Button } from "@/infrastructure/ui-kit/button";
import { Field } from "@/infrastructure/ui-kit/field";

import { kindLabel } from "./import-formats";
import { countLabel, dateRangeLabel, storedDateLabel } from "./import-labels";
import { IMPORT_MESSAGES } from "./import-messages";

/**
 * The person's imported datasets: rename, or delete for good. Delete asks
 * once more, saying how many rows go, because it cannot be undone.
 */

type Mode =
  | Readonly<{ mode: "idle" }>
  | Readonly<{ mode: "rename"; name: string }>
  | Readonly<{ mode: "confirm-delete" }>
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

  const remove = async () => {
    setMode({ mode: "busy" });
    finish(await call(url, { method: "DELETE" }));
  };

  const busy = mode.mode === "busy";
  return (
    <li className="surface p-4">
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
          <div className="min-w-0">
            <h3 className="text-sm break-words">{dataset.name}</h3>
            <p className="text-muted-foreground mt-1 text-xs">
              {kindLabel(dataset.kind)} · {countLabel(dataset.rowCount, "row", "rows")} ·{" "}
              {dateRangeLabel(dataset.firstAt, dataset.lastAt)}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs break-all">
              From {dataset.sourceFileName}, imported {storedDateLabel(dataset.createdAt)}
            </p>
          </div>
          {mode.mode === "confirm-delete" ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">
                Delete {countLabel(dataset.rowCount, "row", "rows")} for good?
              </span>
              <Button size="sm" variant="primary" onClick={() => void remove()}>
                Delete
              </Button>
              <Button size="sm" onClick={() => setMode({ mode: "idle" })}>
                Keep
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy}
                onClick={() => setMode({ mode: "rename", name: dataset.name })}
              >
                Rename
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setMode({ mode: "confirm-delete" })}
              >
                Delete
              </Button>
            </div>
          )}
        </div>
      )}
      {error !== null && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {error}
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
