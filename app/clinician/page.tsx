import type { Metadata } from "next";
import { ClinicianScreen } from "@/components/clinician";

export const metadata: Metadata = {
  title: "Clinician queue",
  description:
    "Escalated patient messages with the reason, the trigger words, the order hold and the right crisis lines. A fictional demo.",
};

/** The clinician queue. ?m=<message id> opens one escalation; the screen reads it inside its own Suspense boundary. */
export default function ClinicianPage() {
  return <ClinicianScreen />;
}
