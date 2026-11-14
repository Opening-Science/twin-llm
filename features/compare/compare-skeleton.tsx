import type { ReactNode } from "react";

/**
 * Placeholders in the real screen's shape (SPEC 2.1), so nothing jumps when
 * it arrives. Screen readers hear one status sentence; the blocks are
 * hidden from them and the container is marked busy.
 */

const Line = ({ width }: Readonly<{ width: string }>) => (
  <div className="skeleton h-3" style={{ width }} />
);

const PromptBarPlaceholder = () => (
  <div className="bg-background/80 sticky bottom-0 mt-auto w-full px-4 pt-2 pb-3 backdrop-blur sm:px-6">
    <div className="mx-auto w-full max-w-(--page-wide)">
      <div className="surface flex h-[6.5rem] flex-col justify-end gap-2 p-3">
        <div className="flex items-center gap-2">
          <div className="skeleton h-6 w-24 rounded-full" />
          <div className="skeleton h-6 w-20 rounded-full" />
          <div className="skeleton ml-auto size-8 rounded-lg" />
        </div>
      </div>
      <div className="skeleton mx-auto mt-2 h-2.5 w-56" />
    </div>
  </div>
);

const Frame = ({
  sentence,
  children,
}: Readonly<{ sentence: string; children: ReactNode }>) => (
  <div aria-busy="true" className="flex min-h-full flex-col">
    <p role="status" className="sr-only">
      {sentence}
    </p>
    <div aria-hidden="true" className="flex flex-1 flex-col">
      {children}
      <PromptBarPlaceholder />
    </div>
  </div>
);

export const HomeSkeleton = () => (
  <Frame sentence="Loading TwinLLM">
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 px-4 pt-[12vh]">
      <div className="skeleton h-10 w-48" />
      <Line width="90%" />
      <Line width="80%" />
      <Line width="60%" />
    </div>
  </Frame>
);

const COLUMN_LINES = ["95%", "88%", "92%", "70%", "80%"] as const;

const ColumnPlaceholder = () => (
  <div className="flex flex-col gap-3 p-4 sm:p-5">
    <div className="flex items-center gap-2">
      <div className="skeleton size-6 rounded-full" />
      <div className="skeleton h-3 w-28" />
    </div>
    {COLUMN_LINES.map((width, index) => (
      <Line key={index} width={width} />
    ))}
  </div>
);

export const ThreadSkeleton = () => (
  <Frame sentence="Loading this thread">
    <div className="mx-auto flex w-full max-w-(--page-wide) flex-col gap-4 px-4 pt-6 sm:px-6">
      <div className="skeleton ml-auto h-12 w-[60%] rounded-2xl sm:w-[45%]" />
      <div className="surface divide-border grid grid-cols-1 divide-y lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        <ColumnPlaceholder />
        <ColumnPlaceholder />
        <ColumnPlaceholder />
      </div>
    </div>
  </Frame>
);
