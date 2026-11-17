/**
 * The models page while the provider is asked: the real heading, a status
 * for screen readers said once, and placeholder blocks in the shape of the
 * intro, the summary and a five-row table, hidden from assistive tech.
 */

const ROWS = [0, 1, 2, 3, 4] as const;

export const ModelsSkeleton = () => (
  <div className="page-wide page-stack" aria-busy="true">
    <h1 className="text-display">Models</h1>
    <p role="status" className="sr-only">
      Loading the model list
    </p>
    <div aria-hidden="true" className="flex max-w-prose flex-col gap-2">
      <span className="skeleton block h-4 w-full" />
      <span className="skeleton block h-4 w-11/12" />
      <span className="skeleton block h-4 w-2/3" />
    </div>
    <div aria-hidden="true" className="flex flex-col gap-2">
      <span className="skeleton block h-3 w-56" />
    </div>
    <div aria-hidden="true" className="surface overflow-hidden">
      <div className="border-border text-muted-foreground flex border-b px-4 py-2 text-xs font-medium">
        <span className="flex-1">Model</span>
        <span className="hidden w-28 sm:block">Per call</span>
        <span className="w-32 sm:w-44">Context</span>
      </div>
      {ROWS.map((row) => (
        <div
          key={row}
          className="border-border flex items-center border-b px-4 py-3 last:border-b-0"
        >
          <span className="flex flex-1 items-center gap-3">
            <span className="skeleton block size-7 rounded-full" />
            <span className="flex flex-col gap-1.5">
              <span className="skeleton block h-4 w-40" />
              <span className="skeleton block h-3 w-28" />
            </span>
          </span>
          <span className="hidden w-28 sm:block">
            <span className="skeleton block h-3 w-14" />
          </span>
          <span className="flex w-32 flex-col gap-1.5 sm:w-44">
            <span className="skeleton block h-4 w-12" />
            <span className="skeleton block h-1 w-full" />
          </span>
        </div>
      ))}
    </div>
  </div>
);
