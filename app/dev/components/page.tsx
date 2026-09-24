import type { ComponentType } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Components",
  robots: { index: false, follow: false },
};

/*
 * The design review page is for development only (npm run dev). In a production build the branch below is dead code,
 * so the page renders a 404 and the gallery's code is not bundled at all: the public site never serves it.
 */
const KitchenSink: ComponentType | null =
  process.env.NODE_ENV === "production"
    ? null
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require("./KitchenSink") as typeof import("./KitchenSink")).KitchenSink;

/** Design review page: every component, state and Trail variant. Not linked from the nav. */
export default function ComponentsPage() {
  if (!KitchenSink) notFound();
  return <KitchenSink />;
}
