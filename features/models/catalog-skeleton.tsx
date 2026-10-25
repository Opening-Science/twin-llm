/**
 * `/models` while the provider's list is on its way. The heading and the
 * column names are known without the network, so they are real; the rest is
 * blocks in the shape of the table.
 */

const Block = ({ className }: Readonly<{ className: string }>) => (
  <span className={`skeleton block ${className}`} />
);

const ROWS = 5;

export const CatalogSkeleton = () => (
  <div
    aria-busy="true"
    className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6"
  >
    <h1 className="text-display">Models</h1>
    <p role="status" className="sr-only">
      Loading the model list
    </p>
    <div aria-hidden="true" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Block className="h-4 w-full max-w-prose" />
        <Block className="h-4 w-11/12 max-w-prose" />
        <Block className="h-4 w-3/5 max-w-prose" />
      </div>
      <Block className="h-3 w-56" />
      <div className="surface overflow-hidden">
        <div className="text-eyebrow border-border flex border-b px-4 py-2.5">
          <span className="flex-1">Model</span>
          <span className="hidden w-28 text-right sm:block">Per call</span>
          <span className="w-32 text-right sm:w-44">Context</span>
        </div>
        {Array.from({ length: ROWS }, (_, row) => (
          <div
            key={row}
            className="border-border flex items-center border-t px-4 py-3 first:border-t-0"
          >
            <div className="flex flex-1 items-center gap-3">
              <Block className="size-8 rounded-full" />
              <div className="flex flex-col gap-1.5">
                <Block className="h-4 w-36" />
                <Block className="h-3 w-48" />
              </div>
            </div>
            <div className="hidden w-28 justify-end sm:flex">
              <Block className="h-3.5 w-14" />
            </div>
            <div className="flex w-32 flex-col items-end gap-1.5 sm:w-44">
              <Block className="h-3.5 w-10" />
              <Block className="h-1 w-full rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);
