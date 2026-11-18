import { badgeLetter, fineTuneId } from "./column-lines";

/**
 * Who answered (SPEC 4): a decorative badge, the display name as the
 * column's heading, the raw id only for a fine-tune, then the Auto and
 * effort lines when they apply.
 */
export const ColumnHeader = ({
  headingId,
  modelId,
  modelName,
  autoLine,
  effortLine,
}: Readonly<{
  headingId: string;
  modelId: string;
  modelName: string;
  autoLine: string | null;
  effortLine: string | null;
}>) => {
  const rawId = fineTuneId(modelId);
  return (
    <header className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="bg-muted text-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium"
        >
          {badgeLetter(modelName)}
        </span>
        <div className="flex min-w-0 flex-col">
          <h3 id={headingId} className="truncate text-sm font-medium">
            {modelName}
          </h3>
          {rawId === null ? null : (
            <span className="text-muted-foreground truncate font-mono text-[11px]">
              {rawId}
            </span>
          )}
        </div>
      </div>
      {autoLine === null ? null : (
        <p className="text-muted-foreground text-xs">{autoLine}</p>
      )}
      {effortLine === null ? null : (
        <p className="text-muted-foreground text-xs">{effortLine}</p>
      )}
    </header>
  );
};
