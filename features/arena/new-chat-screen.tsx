"use client";

import { usePathname } from "next/navigation";
import { type ComponentProps, useState } from "react";

import { CompareScreen } from "./compare-screen";
import { firstGeneration, generationAt } from "./new-conversation";

/**
 * The compare screen for a new chat at `/`, remounted with empty state each
 * time the address comes back to `/` (#377, `new-conversation.ts`). A saved
 * thread at `/t/<id>` renders `CompareScreen` directly.
 */
export const NewChatScreen = (props: ComponentProps<typeof CompareScreen>) => {
  const pathname = usePathname();
  const [current, setCurrent] = useState(() => firstGeneration(pathname));
  const next = generationAt(current, pathname);
  // Adjusted during render, so the old conversation is never painted at `/`.
  if (next !== current) setCurrent(next);
  return <CompareScreen key={next.generation} {...props} />;
};
