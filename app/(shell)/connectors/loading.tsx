// Mirrors the Connectors layout (cards, then timeline and dashboard) at the
// same widths and heights, so the page does not jump when the data arrives.
export default function ConnectorsLoading() {
  return (
    <div
      className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading connectors</span>
      <div className="bg-muted h-9 w-48 animate-pulse rounded" />
      <div className="bg-muted mt-4 h-12 max-w-xl animate-pulse rounded" />
      <div className="bg-muted mt-8 h-4 w-24 animate-pulse rounded" />
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="bg-muted h-36 animate-pulse rounded-xl" />
        ))}
      </div>
      <div className="bg-muted mt-8 h-24 animate-pulse rounded-xl" />
      <div className="bg-muted mt-8 h-72 animate-pulse rounded-2xl" />
    </div>
  );
}
