import { ArrowUpRight, Mail } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Photo } from "@/components/ui/Photo";

/** The builder, and how to reach him. Every rendered line about him is first person. */
export const BUILDER = {
  name: "Chanon Poovaviranon (Beam)",
  linkedin: "https://www.linkedin.com/in/chanon-poovaviranon/",
  linkedinLabel: "linkedin.com/in/chanon-poovaviranon",
  email: "chanonbcp@gmail.com",
  mailto: `mailto:chanonbcp@gmail.com?subject=${encodeURIComponent("Care Desk")}`,
} as const;

/** What running it for real would take, in three plain stages, one line each. A proposal, not a result. */
export const PLAN_STAGES = [
  {
    when: "Weeks 1 to 2",
    what: "Connect your helpdesk and order records, and agree the safety rules with your clinicians.",
  },
  {
    when: "Weeks 3 to 4",
    what: "Order-status drafts go live for one agent. A person still sends every reply.",
  },
  {
    when: "Days 31 to 90",
    what: "Add more routine message types and compare the weekly numbers with before.",
  },
] as const;

// The same shapes as the kit's Button (secondary and primary), as plain links so LinkedIn opens in a new tab.
const LINK_BASE =
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-medium " +
  "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out-expo active:scale-[0.98]";
const LINK_SIZE = { sm: "h-8 rounded-inner px-3 text-xs", md: "h-10 rounded-control px-4 text-sm" } as const;
const LINK_PRIMARY = "bg-navy-900 text-white shadow-[0_1px_2px_rgb(1_3_55/0.18)] hover:bg-navy-700 active:bg-navy-950";
const LINK_SECONDARY = "border border-line-strong bg-surface text-heading hover:border-navy-300 hover:bg-field active:bg-field-hover";

/** Email and LinkedIn buttons, with the address written out for anyone whose email link does nothing. */
export function ContactLinks({ size = "md", className }: { size?: "sm" | "md"; className?: string }) {
  const icon = size === "sm" ? 14 : 16;
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <a href={BUILDER.mailto} className={cn(LINK_BASE, LINK_SIZE[size], LINK_PRIMARY)}>
          <Mail aria-hidden size={icon} />
          Email me
        </a>
        <a
          href={BUILDER.linkedin}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(LINK_BASE, LINK_SIZE[size], LINK_SECONDARY)}
        >
          LinkedIn
          <ArrowUpRight aria-hidden size={icon} />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
      <p className="mt-2.5 break-words text-xs text-muted">
        Or write to <span className="font-medium text-heading">{BUILDER.email}</span>
      </p>
    </div>
  );
}

/** The three stages as a list. */
function Plan({ compact = false }: { compact?: boolean }) {
  return (
    <ol className={cn("flex flex-col", compact ? "gap-2" : "gap-0")}>
      {PLAN_STAGES.map((s, i) => (
        <li
          key={s.when}
          className={cn(
            "grid gap-x-4",
            compact
              ? "gap-y-0.5"
              : cn("gap-y-1 py-4 sm:grid-cols-[7.5rem_minmax(0,1fr)]", i > 0 && "border-t border-line-cool"),
          )}
        >
          <span className={cn("font-semibold text-heading tnum", compact ? "text-xs" : "text-sm")}>{s.when}</span>
          <span className={cn("text-ink", compact ? "text-xs leading-relaxed" : "text-sm")}>{s.what}</span>
        </li>
      ))}
    </ol>
  );
}

/** A compact version (the plan and the contact buttons), for a small card such as the tour's closing card. */
export function BuilderContactCompact() {
  return (
    <div className="mt-4">
      <Plan compact />
      <p className="mt-4 border-t border-line-cool pt-3 text-sm font-semibold text-heading">Talk to me</p>
      <ContactLinks size="sm" className="mt-2" />
    </div>
  );
}

/**
 * On the welcome: who built it (in the first person, the one place the page names him) and how the first 90 days
 * would go. The heading id is the target of Help > About me (components/shell/ConceptFooter.tsx BUILDER_ABOUT_HREF).
 */
export function BuilderContact({ className }: { className?: string }) {
  return (
    <section aria-labelledby="welcome-team-title" className={cn("rounded-card bg-surface p-6 shadow-card sm:p-10", className)}>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-16">
        <div className="min-w-0">
          <div className="flex items-center gap-4 sm:gap-5">
            <div className="size-16 shrink-0 overflow-hidden rounded-pill bg-field ring-4 ring-canvas sm:size-20">
              {/* The name is written out right beside the photo, so the photo itself stays silent. */}
              <Photo name="beam" alt="" sizes="80px" />
            </div>
            <h2 id="welcome-team-title" className="text-2xl font-semibold text-heading sm:text-3xl">
              Talk to me
            </h2>
          </div>
          <p className="mt-6 max-w-[42ch] text-base text-ink sm:text-lg sm:leading-8">
            I&apos;m {BUILDER.name}. I designed and built Care Desk, from the safety rules to the test set, and I can set
            it up with your team.
          </p>
          <ContactLinks className="mt-6" />
        </div>
        <div className="min-w-0 border-t border-line-cool pt-8 lg:border-l lg:border-t-0 lg:pl-16 lg:pt-0">
          <h3 className="text-base font-semibold text-heading">How I would set it up with your team</h3>
          <div className="mt-2">
            <Plan />
          </div>
        </div>
      </div>
    </section>
  );
}
