import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Suspense } from "react";
import { VipKeyFromUrl } from "@/components/try/access";
import { SessionProvider } from "@/lib/client/session";
import "./globals.css";

/*
 * Only the weights the UI sets are loaded (and preloaded): Poppins 400, 500 and 600, and Clash Display 500 for page
 * titles and the wordmark. Emphasis uses font-semibold, so no bold file is needed.
 */
const poppins = localFont({
  src: [
    { path: "../public/fonts/poppins-400.woff2", weight: "400", style: "normal" },
    { path: "../public/fonts/poppins-500.woff2", weight: "500", style: "normal" },
    { path: "../public/fonts/poppins-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-poppins",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "Segoe UI", "Arial", "sans-serif"],
});

const clash = localFont({
  src: [
    { path: "../public/fonts/clash-display-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-clash",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "Arial", "sans-serif"],
});

/* A simple navy monogram for the browser tab: a rounded square with a white check. No third-party artwork. */
const ICON_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%23010337'/><path d='M9.5 16.5l4.5 4.5 8.5-9' fill='none' stroke='%23ffffff' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/></svg>";

export const metadata: Metadata = {
  title: {
    default: "Care Desk",
    template: "%s · Care Desk",
  },
  description:
    "Care Desk drafts routine patient-support replies in seconds and sends anything clinical straight to a person. A concept for Dispensed, built by Chanon Poovaviranon (Beam). Not affiliated with Dispensed. All patients, orders and messages are fictional.",
  applicationName: "Care Desk",
  authors: [{ name: "Chanon Poovaviranon (Beam)" }],
  icons: {
    icon: [{ url: `data:image/svg+xml,${ICON_SVG}`, type: "image/svg+xml" }],
  },
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export const viewport: Viewport = {
  themeColor: "#f8f5f0",
  width: "device-width",
  initialScale: 1,
};

/*
 * The design direction contract, emitted as an HTML comment in every page so the finish review can audit the render
 * against it. Plain product language only, nothing private, so shipping it in the markup is harmless. Keep it the
 * first element RootLayout renders in <body> (Next's own metadata outlet is injected ahead of it), under 150 words,
 * and never with a double hyphen inside. After `npm run build`, `grep -c e613dc99 out/index.html` must return 1.
 * If it should not be public, strip it at deploy time (in the Worker or a post-export step), never in this build.
 */
const DIRECTION_CONTRACT = [
  "THESIS: each message shows its own check trail, ending at a person's decision; no inbox with a chatbot reply box.",
  "OWN-WORLD: brand navy #010337 on warm off-white #f8f5f0, white 24px cards, 16px controls on #eff3f9, pill tags; mint for ready, lavender for clinician, pale red for urgent, amber for orders on hold; Poppins for UI, Clash Display for titles; warm photos of the people (patient, agent, clinician) and soft eucalyptus texture on the story pages, never inside the work tools.",
  "STORY: a routine question gets a checked, cited draft; a medication question stops the trail with no AI reply; the visitor sees safety built in, then tries a message.",
  "FIRST VIEWPORT: on navy, the name, one line, Start the 1-minute tour and Open the desk; beside them a support agent photo with the live mini trail floating over it, running two example messages.",
  "FORM: vertical check trail, first on the list, seed key e613dc99.",
  "FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md",
].join(" ");
/* One line on purpose: the HTML copy and the RSC payload copy then share a line, so grep -c counts 1. */
const CONTRACT_COMMENT = `<!-- ${DIRECTION_CONTRACT} -->`;

/*
 * Cloudflare Web Analytics (cookie-free), only when a token is set at build time: NEXT_PUBLIC_CF_BEACON_TOKEN is added
 * at deploy. Without it no analytics script is emitted at all. A token that is not a plain id is ignored.
 */
const CF_BEACON_TOKEN = (process.env.NEXT_PUBLIC_CF_BEACON_TOKEN ?? "").trim();
const CF_BEACON = /^[A-Za-z0-9_-]{16,64}$/.test(CF_BEACON_TOKEN) ? JSON.stringify({ token: CF_BEACON_TOKEN }) : null;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU" className={`${poppins.variable} ${clash.variable}`}>
      <body className="min-h-dvh bg-canvas font-sans text-ink antialiased">
        <div hidden aria-hidden="true" dangerouslySetInnerHTML={{ __html: CONTRACT_COMMENT }} />
        {/* A private link (?k=) works on any page: the reader stores it for the tab, so the home page link on a CV opens
            the live box with that link's budget. Only this empty component waits for the address bar; pages prerender. */}
        <Suspense fallback={null}>
          <VipKeyFromUrl />
        </Suspense>
        <SessionProvider>{children}</SessionProvider>
        {CF_BEACON && (
          // The official snippet, as Cloudflare gives it: deferred, no cookies.
          <script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon={CF_BEACON} />
        )}
      </body>
    </html>
  );
}
