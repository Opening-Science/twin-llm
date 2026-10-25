import type { ReactNode } from "react";

/**
 * Loading states with the compare screen's shape, so nothing jumps when the
 * real screen replaces them. The prompt bar placeholder matches the real bar's
 * height and stickiness. Screen readers get one status sentence; the blocks
 * themselves are hidden from them.
 */

const Block = ({ className }: Readonly<{ className: string }>) => (
  <div className={`skeleton ${className}`} />
);

const PromptBarShape = () => (
  <div className="sticky bottom-0 px-4 pt-2 pb-3 sm:px-6">
    <div className="surface mx-auto flex h-[7.5rem] max-w-5xl flex-col justify-between p-4">
      <Block className="h-4 w-1/3" />
      <div className="flex items-center gap-2">
        <Block className="h-6 w-20 rounded-full" />
        <Block className="h-6 w-24 rounded-full" />
        <div className="flex-1" />
        <Block className="size-9 rounded-lg" />
      </div>
    </div>
    <Block className="mx-auto mt-2 h-3 w-56" />
  </div>
);

const Loading = ({
  label,
  children,
}: Readonly<{ label: string; children: ReactNode }>) => (
  <div aria-busy="true" className="flex flex-1 flex-col">
    <p role="status" className="sr-only">
      {label}
    </p>
    <div aria-hidden="true" className="flex flex-1 flex-col">
      <div className="flex-1 px-4 py-6 sm:px-6">{children}</div>
      <PromptBarShape />
    </div>
  </div>
);

export const HomeSkeleton = () => (
  <Loading label="Loading TwinLLM">
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 pt-[12vh]">
      <Block className="mb-2 h-9 w-48" />
      <Block className="h-4 w-full" />
      <Block className="h-4 w-11/12" />
      <Block className="h-4 w-2/3" />
    </div>
  </Loading>
);

const ColumnShape = () => (
  <div className="flex flex-col gap-3 p-5">
    <div className="flex items-center gap-2">
      <Block className="size-6 rounded-full" />
      <Block className="h-4 w-28" />
    </div>
    {["w-full", "w-11/12", "w-full", "w-4/5", "w-3/5"].map((width, line) => (
      <Block key={line} className={`h-3.5 ${width}`} />
    ))}
  </div>
);

export const ThreadSkeleton = () => (
  <Loading label="Loading this thread">
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <Block className="ml-auto h-16 w-2/3 rounded-2xl sm:w-1/2" />
      <div className="surface divide-border grid grid-cols-1 divide-y lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        <ColumnShape />
        <ColumnShape />
        <ColumnShape />
      </div>
    </div>
  </Loading>
);
