import type { Metadata } from "next";
import { ConceptFooter, Wordmark } from "@/components/shell";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export const metadata: Metadata = {
  title: "Page not found",
};

/**
 * Replaces Next's default not-found page (exported as out/404.html). The default carries an inline dark-scheme style
 * that turns the page black with navy headings; this one keeps the canvas, the wordmark and one clear way back.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="px-4 pt-5 sm:px-6 lg:px-8">
        <Wordmark />
      </header>
      <main id="main" className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6">
        <Card padding="lg" raised className="w-full max-w-md text-center">
          <h1 className="display-title text-2xl text-navy-900 sm:text-3xl">That page isn&apos;t here</h1>
          <p className="mx-auto mt-3 max-w-[40ch] text-base text-muted">
            The link may be mistyped or out of date. Everything in the demo starts from the welcome screen.
          </p>
          <div className="mt-6 flex justify-center">
            <Button href="/" size="lg">
              Open Care Desk
            </Button>
          </div>
        </Card>
      </main>
      <ConceptFooter />
    </div>
  );
}
