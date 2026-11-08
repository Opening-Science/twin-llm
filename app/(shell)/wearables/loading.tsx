export default function WearablesLoading() {
  return (
    <div className="page-wide">
      <div className="bg-muted h-9 w-48 animate-pulse rounded" />
      <div className="bg-muted mt-4 h-12 max-w-xl animate-pulse rounded" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <div className="bg-muted h-28 animate-pulse rounded-xl" />
        <div className="bg-muted h-28 animate-pulse rounded-xl" />
      </div>
      <div className="bg-muted mt-10 h-8 w-32 animate-pulse rounded" />
      <div className="bg-muted mt-4 h-40 animate-pulse rounded-xl" />
    </div>
  );
}
