// Mirrors the Dashboard layout (title, then Wearables, Digital Twin and Chat)
// at the same widths, so the frame shows at once and does not jump when the
// sections arrive.
export default function DashboardLoading() {
  return (
    <div className="page-wide page-stack" role="status" aria-busy="true">
      <span className="sr-only">Loading the dashboard</span>
      <div className="flex flex-col gap-2">
        <div className="bg-muted h-10 w-48 animate-pulse rounded" />
        <div className="bg-muted h-4 max-w-prose animate-pulse rounded" />
      </div>
      {["h-72", "h-40", "h-24"].map((height) => (
        <div key={height} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <div className="bg-muted h-7 w-40 animate-pulse rounded" />
            <div className="bg-muted h-4 max-w-md animate-pulse rounded" />
          </div>
          <div className={`bg-muted ${height} animate-pulse rounded-xl`} />
        </div>
      ))}
    </div>
  );
}
