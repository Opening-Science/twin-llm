import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/infrastructure/ui";

/**
 * The few line icons the ui-kit draws itself. Each is decorative
 * (`aria-hidden`): the words next to it carry the meaning. Strokes use
 * `currentColor`, so a token class on the icon or its parent colours it.
 */

type IconProps = Readonly<Omit<ComponentProps<"svg">, "children">>;

const Icon = ({ className, children, ...props }: IconProps & { children: ReactNode }) => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    className={cn("size-3.5 shrink-0", className)}
    {...props}
  >
    {children}
  </svg>
);

export const ChevronIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m8 5 5 5-5 5" />
  </Icon>
);

export const TickIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </Icon>
);

export const CrossIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m5.5 5.5 9 9m0-9-9 9" />
  </Icon>
);

export const DashIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5.5 10h9" />
  </Icon>
);

export const StarIcon = ({ filled, ...props }: IconProps & { filled: boolean }) => (
  <Icon {...props} fill={filled ? "currentColor" : "none"}>
    <path d="m10 2.8 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7Z" />
  </Icon>
);
