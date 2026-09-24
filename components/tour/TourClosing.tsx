import { ArrowUpRight, Mail } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { BUILDER } from "@/components/welcome/BuilderContact";

// The kit's Button shapes (small primary and secondary), as plain links so LinkedIn can open in a new tab.
const LINK =
  "inline-flex h-9 shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-inner px-3.5 text-sm font-medium " +
  "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out-expo active:scale-[0.98]";

/**
 * The closing card's contact row: email (the one main action here) and LinkedIn, with the address written out for
 * anyone whose email link does nothing. The thanks itself is the stop's title and body in steps.ts.
 */
export function TourClosing() {
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={BUILDER.mailto}
          className={cn(LINK, "bg-navy-900 text-white shadow-[0_1px_2px_rgb(1_3_55/0.18)] hover:bg-navy-700 active:bg-navy-950")}
        >
          <Mail aria-hidden size={15} />
          Email me
        </a>
        <a
          href={BUILDER.linkedin}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(LINK, "border border-line-strong bg-surface text-heading hover:border-navy-300 hover:bg-field active:bg-field-hover")}
        >
          LinkedIn
          <ArrowUpRight aria-hidden size={15} />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
      <p className="mt-2 break-words text-xs text-muted">
        Or write to <span className="font-medium text-heading">{BUILDER.email}</span>
      </p>
    </div>
  );
}
