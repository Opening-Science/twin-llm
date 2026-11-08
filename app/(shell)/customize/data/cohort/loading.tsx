/** The Data page's shape while the warehouse is read: header, tiles, a chart. */
export default function DataLoading() {
  return (
    <div>
      <div className="bg-muted h-9 w-32 animate-pulse rounded" />
      <div className="bg-muted mt-4 h-12 max-w-xl animate-pulse rounded" />
      <div className="bg-muted mt-6 h-9 w-72 max-w-full animate-pulse rounded-full" />
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="bg-muted h-20 animate-pulse rounded-xl" />
        ))}
      </div>
      <div className="bg-muted mt-6 h-64 animate-pulse rounded-xl" />
    </div>
  );
}
