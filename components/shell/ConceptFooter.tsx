import { cn } from "@/components/ui/cn";
import { BUILDER } from "@/components/welcome/BuilderContact";

/** The fixed concept notice. The builder's name is not in it: the footer's byline says it once. */
export const CONCEPT_NOTICE =
  "Concept for Dispensed. Not affiliated with Dispensed. All patients, orders and messages are fictional.";

/** The welcome page's contact section (components/welcome/BuilderContact.tsx), for Help > About me. */
export const BUILDER_ABOUT_HREF = "/#welcome-team-title";

/**
 * Required on every screen: one line with the fixed concept notice, then the byline (the builder's name, once) and how
 * to reach him. On a wide screen it all sits on one line; on a phone it wraps into two short centred lines.
 *
 * `slim`: on the full-height screens (the desk and the clinician view) from 1024px up, the same words sit in one slim
 * bar at the foot of the frame, inside the screen's height, so the window never has to scroll to show them.
 *
 * `hideByline`: drops the name (keeps Email and LinkedIn and the notice). The welcome passes it because its contact
 * card already names me on the same screen, and the name appears at most once per screen.
 */
export function ConceptFooter({
  tone = "light",
  slim = false,
  hideByline = false,
  className,
}: {
  tone?: "light" | "navy";
  slim?: boolean;
  hideByline?: boolean;
  className?: string;
}) {
  const navy = tone === "navy";
  const link = cn(
    "rounded-[4px] font-medium underline decoration-1 underline-offset-2 transition-colors duration-150",
    navy
      ? "text-on-navy decoration-on-navy-muted hover:decoration-on-navy"
      : "text-heading decoration-line-strong hover:decoration-heading active:text-navy-700",
  );
  const dot = <span aria-hidden> · </span>;
  return (
    <footer
      // The slim bar sits at the foot of the screen on the full-height views: toasts keep clear of it.
      data-bottombar={slim ? "" : undefined}
      className={cn(
        "border-t px-4 py-6 text-xs sm:px-6 lg:px-8",
        slim && "lg:shrink-0 lg:px-4 lg:py-2",
        navy ? "border-white/10 text-on-navy-muted" : "border-line text-muted",
        className,
      )}
    >
      <p className="mx-auto flex max-w-[1440px] flex-wrap items-baseline justify-center gap-x-3 gap-y-1.5 text-center">
        <span>{CONCEPT_NOTICE}</span>
        <span>
          {hideByline ? null : (
            <>
              Built by {BUILDER.name}
              {dot}
              <span className="sr-only">. </span>
            </>
          )}
          <a href={BUILDER.mailto} className={link}>
            Email
            <span className="sr-only"> {BUILDER.email}</span>
          </a>
          {dot}
          <a href={BUILDER.linkedin} target="_blank" rel="noopener noreferrer" className={link}>
            LinkedIn
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </span>
      </p>
    </footer>
  );
}
