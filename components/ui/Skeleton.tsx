import { cn } from "./cn";

/** Loading placeholder that keeps the final layout. Size it with width and height classes. */
export function Skeleton({ className, rounded = "inner" }: { className?: string; rounded?: "inner" | "pill" | "card" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block animate-shimmer bg-[length:200%_100%]",
        "bg-[linear-gradient(90deg,var(--color-field)_0%,var(--color-inset)_40%,var(--color-field)_80%)]",
        rounded === "pill" ? "rounded-pill" : rounded === "card" ? "rounded-card" : "rounded-inner",
        className,
      )}
    />
  );
}

/** A few text lines, the last one shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span className={cn("flex flex-col gap-2", className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3.5", i === lines - 1 ? "w-3/5" : "w-full")} />
      ))}
    </span>
  );
}

/** Screen-reader status for a loading region: pair it with skeletons. */
export function LoadingStatus({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="sr-only">
      {label}
    </span>
  );
}
