import { DashboardScreen } from "@/features/dashboard/dashboard-screen";
import { lockedScreen } from "@/features/vault/page-gate";

/**
 * The dashboard reads the person's own wearables and threads, so while the
 * data is locked (#142) it shows the unlock screen like every other personal
 * page.
 */
export default async function DashboardPage() {
  const locked = await lockedScreen();
  if (locked) return locked;
  return <DashboardScreen slots={{}} />;
}
