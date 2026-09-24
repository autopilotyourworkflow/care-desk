import type { ReactNode } from "react";
import { cn } from "./cn";

/** A single key, e.g. <Kbd>J</Kbd>. Use tone="onDark" inside navy buttons and toasts. */
export function Kbd({
  children,
  className,
  tone = "light",
}: {
  children: ReactNode;
  className?: string;
  tone?: "light" | "onDark";
}) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 font-sans text-2xs font-semibold tnum",
        tone === "light"
          ? "border border-line-strong bg-surface text-heading shadow-[0_1px_0_rgb(1_3_55/0.12)]"
          : "border border-white/25 bg-white/10 text-white",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** A key combination: <KeyCombo keys={["Ctrl", "Enter"]} />. Screen readers hear "Ctrl plus Enter". */
export function KeyCombo({
  keys,
  tone = "light",
  className,
}: {
  keys: string[];
  tone?: "light" | "onDark";
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={keys.join(" plus ")} role="img">
      {keys.map((k) => (
        <Kbd key={k} tone={tone}>
          {k}
        </Kbd>
      ))}
    </span>
  );
}
