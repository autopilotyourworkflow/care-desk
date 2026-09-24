import type { Metadata } from "next";
import { TryPage } from "@/components/try/TryPage";

export const metadata: Metadata = {
  title: "Try a message",
  description:
    "Write as one of three fictional patients and watch Care Desk's checks run live: personal details removed, safety rules first, then a checked draft or a safety stop. Unofficial concept for Dispensed by Chanon Poovaviranon (Beam).",
};

export default function Page() {
  // No page-level Suspense: ?k= is read (useSearchParams) only by <VipKeyFromUrl /> in the root layout, inside its own
  // small <Suspense>, so the shell, header and message box all prerender. A boundary here would make the static
  // export ship a fallback plus a hidden copy of the page, swapped in by script: heavier, and the real page stays hidden until scripts run.
  return <TryPage />;
}
