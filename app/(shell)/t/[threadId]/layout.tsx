import type { ReactNode } from "react";

import { ownedThread } from "@/features/arena/thread-reads";
import { lockedScreen } from "@/features/vault/page-gate";

/**
 * Settles whether the thread exists and is the viewer's before the segment's
 * loading boundary can stream. A layout renders outside that boundary, so the
 * 404 thrown here still sets the response status; thrown from the page it
 * would arrive after the skeleton and leave a 200 (#1). The page reads the
 * same cached result, so the thread is loaded once.
 */
export default async function ThreadLayout({
  params,
  children,
}: Readonly<{ params: Promise<{ threadId: string }>; children: ReactNode }>) {
  // Locked (#142): the page shows the unlock screen; the thread is not read here.
  if (await lockedScreen()) return children;
  const { threadId } = await params;
  await ownedThread(threadId);
  return children;
}
