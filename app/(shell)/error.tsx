"use client";

import { ScreenError } from "@/features/app-shell/screen-error";

/** A shell page that fails to render is replaced on its own; the frame stays. */
export default function ShellScreenError(
  props: Readonly<{ error: Error & { digest?: string }; reset: () => void }>,
) {
  return <ScreenError {...props} />;
}
