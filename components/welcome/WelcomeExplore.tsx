import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/components/ui/cn";

const DOORS = [
  { href: "/desk/", label: "Open the desk", text: "The support queue, with the checks shown on every message." },
  { href: "/tests/", label: "See the test results", text: "Every test message, and how each one was handled." },
  { href: "/how-it-works/", label: "How it works", text: "The design, the data handling and how to run it." },
] as const;

const MORE = [
  { href: "/clinician/", label: "Clinician queue" },
  { href: "/insights/", label: "Insights" },
  { href: "/try/", label: "Try your own message" },
] as const;

const TEXT_LINK =
  "rounded-inner font-medium text-heading underline decoration-line-strong underline-offset-4 transition-colors duration-150 hover:decoration-navy-900";

/** Three clear ways in, and quiet text links for the rest. */
export function WelcomeExplore({ className }: { className?: string }) {
  return (
    <nav aria-labelledby="welcome-places-title" className={className}>
      <h2 id="welcome-places-title" className="text-2xl font-semibold text-heading sm:text-3xl">
        Explore the demo
      </h2>
      <ul className="mt-8 grid gap-4 md:grid-cols-3">
        {DOORS.map((d) => (
          <li key={d.href} className="min-w-0">
            <Link
              href={d.href}
              className={cn(
                "group flex h-full flex-col rounded-card bg-surface p-6 shadow-card",
                "transition-[box-shadow,transform] duration-200 ease-out-expo hover:-translate-y-0.5 hover:shadow-raised active:translate-y-0",
              )}
            >
              <span className="flex items-center justify-between gap-3">
                <span className="text-lg font-semibold text-heading">{d.label}</span>
                <ArrowRight
                  aria-hidden
                  size={20}
                  className="shrink-0 text-muted-icon transition-transform duration-200 ease-out-expo group-hover:translate-x-1 group-hover:text-heading"
                />
              </span>
              <span className="mt-1.5 text-sm text-muted">{d.text}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
        <span>Also here:</span>
        {MORE.map((m) => (
          <Link key={m.href} href={m.href} className={TEXT_LINK}>
            {m.label}
          </Link>
        ))}
      </p>
    </nav>
  );
}
