"use client";

import { cn } from "@/lib/utils";

interface BrandLogoProps {
  className?: string;
  /** Size shorthand mapped to width/height. Use `lg` on the landing screen, `md` in the sidebar. */
  size?: "sm" | "md" | "lg";
}

const SIZE_PX: Record<NonNullable<BrandLogoProps["size"]>, number> = {
  sm: 24,
  md: 32,
  lg: 64,
};

/**
 * Trading IQ brand mark — a multi-spoke network of nodes around a central
 * agent disc carrying a dollar sign. The mark uses `currentColor` for the
 * lines and node fills so it inherits whatever text color the parent sets;
 * the central disc and "$" stay solid for contrast.
 */
export function BrandLogo({ className, size = "md" }: BrandLogoProps) {
  const px = SIZE_PX[size];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={px}
      height={px}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <g stroke="currentColor" strokeWidth={2.5} fill="currentColor">
        <line x1="32" y1="32" x2="10" y2="14" />
        <line x1="32" y1="32" x2="54" y2="14" />
        <line x1="32" y1="32" x2="8" y2="34" />
        <line x1="32" y1="32" x2="56" y2="36" />
        <line x1="32" y1="32" x2="14" y2="54" />
        <line x1="32" y1="32" x2="50" y2="56" />
        <circle cx="10" cy="14" r="3.2" />
        <circle cx="54" cy="14" r="3.2" />
        <circle cx="8" cy="34" r="3.2" />
        <circle cx="56" cy="36" r="3.2" />
        <circle cx="14" cy="54" r="3.2" />
        <circle cx="50" cy="56" r="3.2" />
      </g>
      <circle cx="32" cy="32" r="14" fill="currentColor" />
      <text
        x="32"
        y="38.5"
        textAnchor="middle"
        fontFamily="Inter, system-ui, sans-serif"
        fontSize="18"
        fontWeight={700}
        fill="white"
      >
        $
      </text>
    </svg>
  );
}
