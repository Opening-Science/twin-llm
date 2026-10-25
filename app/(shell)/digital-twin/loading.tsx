/**
 * Skeleton of /digital-twin in its final layout: the body twin card with its
 * pickers, toolbar, 3D view and rail, then the two sections below. Sizes match
 * digital-twin-screen.tsx and bodyloop-avatar.tsx so nothing jumps on load.
 */
export default function DigitalTwinLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <div className="bg-muted h-12 w-64 animate-pulse rounded" />
      <div className="bg-muted mt-6 h-8 w-40 animate-pulse rounded" />
      <div className="bg-muted mt-2 h-5 max-w-xl animate-pulse rounded" />
      <div className="surface mt-4 px-4 py-5">
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="bg-muted h-14 animate-pulse rounded-md" />
          <div className="bg-muted h-14 animate-pulse rounded-md" />
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
          <div className="min-w-0">
            <div className="bg-muted h-7 w-80 max-w-full animate-pulse rounded-md" />
            <div className="bg-muted mt-2 h-[min(70vh,640px)] min-h-[360px] animate-pulse rounded-xl" />
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <div className="bg-muted h-28 animate-pulse rounded-xl" />
            <div className="bg-muted h-72 animate-pulse rounded-xl" />
          </div>
        </div>
      </div>
      <div className="bg-muted mt-12 h-8 w-32 animate-pulse rounded" />
      <div className="bg-muted mt-4 h-24 animate-pulse rounded-xl" />
      <div className="bg-muted mt-12 h-8 w-40 animate-pulse rounded" />
      <div className="bg-muted mt-2 h-5 w-72 max-w-full animate-pulse rounded" />
    </div>
  );
}
