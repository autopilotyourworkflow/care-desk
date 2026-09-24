import { initials } from "@/lib/format";
import { cn } from "./cn";

const TONES = [
  "bg-navy-100 text-navy-900",
  "bg-success-bg text-success-fg",
  "bg-info-bg text-info-fg",
  "bg-clinician-bg text-clinician-fg",
  "bg-hold-bg text-hold-fg",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Initials in a circle. Decorative: show the name next to it. */
export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-pill font-semibold",
        size === "sm" ? "size-6 text-2xs" : size === "md" ? "size-8 text-xs" : "size-10 text-sm",
        TONES[hash(name) % TONES.length],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
