import type { Metadata } from "next";
import { InsightsScreen } from "@/components/insights/InsightsScreen";

export const metadata: Metadata = {
  title: "Insights",
  description:
    "What Care Desk would save a support team: first response time before and after, a savings calculator, safety, AI cost and what to automate next. Simulated figures from fictional data.",
};

export default function InsightsPage() {
  return <InsightsScreen />;
}
