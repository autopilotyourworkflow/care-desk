import Link from "next/link";
import { cn } from "@/components/ui/cn";

/** The product wordmark in Clash Display with the "Concept" pill. The only display type outside page titles. */
export function Wordmark({
  href = "/",
  tone = "light",
  size = "md",
  showConcept = true,
  className,
}: {
  href?: string | null;
  tone?: "light" | "navy";
  size?: "md" | "lg";
  showConcept?: boolean;
  className?: string;
}) {
  const mark = (
    <span
      className={cn(
        "font-display font-medium tracking-[-0.005em]",
        size === "lg" ? "text-3xl" : "text-xl",
        tone === "navy" ? "text-white" : "text-navy-900",
      )}
    >
      Care Desk
    </span>
  );
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {href ? (
        <Link href={href} className="-mx-1 rounded-inner px-1" aria-label="Care Desk, home">
          {mark}
        </Link>
      ) : (
        mark
      )}
      {showConcept && <ConceptPill tone={tone} />}
    </span>
  );
}

export function ConceptPill({ tone = "light" }: { tone?: "light" | "navy" }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-pill px-2 text-2xs font-semibold",
        tone === "navy" ? "bg-white/12 text-on-navy-muted ring-1 ring-white/20" : "bg-info-bg text-info-fg",
      )}
    >
      Concept
    </span>
  );
}
