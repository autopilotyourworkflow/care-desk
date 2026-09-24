import type { Metadata } from "next";
import { Welcome } from "@/components/welcome";

export const metadata: Metadata = {
  title: { absolute: "Care Desk" },
  description:
    "Routine replies drafted in seconds. Anything clinical goes straight to a person. A working concept for Dispensed by Chanon Poovaviranon (Beam), on fictional data.",
};

export default function Home() {
  return <Welcome />;
}
