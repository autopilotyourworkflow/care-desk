import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/shell";
import { DeskFallback, DeskScreen } from "@/components/desk/DeskScreen";
import { DESK_SHORTCUTS } from "@/components/desk/shortcuts";

export const metadata: Metadata = {
  title: "Desk",
  description:
    "The patient-support desk: every message beside its check trail, a checked draft to review, and a person who sends. All patients and messages are fictional.",
};

/** The agent's desk. ?m=MSG-0026 opens a message directly (read on the client, so the page stays static). */
export default function DeskPage() {
  return (
    <AppShell fullBleed shortcuts={DESK_SHORTCUTS}>
      <Suspense fallback={<DeskFallback />}>
        <DeskScreen />
      </Suspense>
    </AppShell>
  );
}
