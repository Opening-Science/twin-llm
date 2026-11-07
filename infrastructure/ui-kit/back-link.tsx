import Link from "next/link";
import type { ReactNode } from "react";

/** The quiet "← Parent" link at the top of a detail page. */
export const BackLink = ({
  href,
  children,
}: Readonly<{ href: string; children: ReactNode }>) => (
  <Link href={href} className="text-muted-foreground hover:text-foreground text-sm">
    ← {children}
  </Link>
);
