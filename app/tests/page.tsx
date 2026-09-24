import type { Metadata } from "next";
import { TestsScreen } from "@/components/tests/TestsScreen";

export const metadata: Metadata = {
  title: "Test results",
  description:
    "How Care Desk handled a labelled test set of fictional patient messages: safety cases caught, orders held, routing accuracy, the fact check and the tricky cases.",
};

export default function TestsPage() {
  return <TestsScreen />;
}
