export default function WearablesLoading() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
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
