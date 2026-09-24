"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CirclePlay } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Photo } from "@/components/ui/Photo";
import { ConceptFooter } from "@/components/shell/ConceptFooter";
import { Wordmark } from "@/components/shell/Wordmark";
import { useStartTour } from "@/components/tour/TourProvider";
import { BuilderContact } from "./BuilderContact";
import { WelcomeDemo } from "./WelcomeDemo";
import { WelcomeExplore } from "./WelcomeExplore";
import { WelcomeFacts } from "./WelcomeFacts";
import { WelcomeJourney } from "./WelcomeJourney";

const WRAP = "mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8";

/**
 * The decision page. The hero answers what it is and what to press, with a support agent's photo and the live check
 * trail floating over it, so the person and the proof read together. Below: how a message moves, what keeps it safe,
 * who built it and how to reach me, and three ways in.
 */
export function Welcome() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        <Hero />
        <WelcomeJourney className={`${WRAP} py-16 sm:py-20 lg:py-24`} />
        <WelcomeFacts />
        <div className={`${WRAP} flex flex-col gap-16 py-16 sm:gap-20 sm:py-20 lg:gap-24 lg:py-24`}>
          <BuilderContact />
          <WelcomeExplore />
        </div>
      </main>
      <ConceptFooter hideByline />
    </div>
  );
}

function Hero() {
  const { start, starting } = useStartTour();
  return (
    <div className="relative isolate overflow-hidden bg-navy-900">
      <Suspense fallback={null}>
        <TourFromLink start={start} />
      </Suspense>

      {/* A faint eucalyptus texture on the photo side only, faded out before it reaches the text. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 -z-10 hidden w-[60%] opacity-[0.14] mix-blend-luminosity [mask-image:linear-gradient(to_left,black_30%,transparent)] lg:block"
      >
        <Photo name="leaves-deep" alt="" sizes="60vw" />
      </div>

      <div
        className={`${WRAP} grid items-center gap-10 pb-10 pt-6 sm:pb-14 sm:pt-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-10 lg:py-14 xl:grid-cols-[minmax(0,1fr)_minmax(0,33rem)] xl:gap-14 xl:py-16`}
      >
        <section aria-labelledby="welcome-title" data-surface="navy" className="min-w-0">
          <Wordmark href={null} tone="navy" />
          <h1
            id="welcome-title"
            className="display-title mt-8 max-w-[13ch] text-[2.5rem] leading-[1.08] text-white sm:mt-12 sm:text-[3.25rem] lg:mt-10 lg:max-w-[15ch] lg:text-[3rem] lg:leading-[1.06] xl:mt-12 xl:max-w-[13ch] xl:text-[3.625rem] xl:leading-[1.04]"
          >
            Routine replies <span className="text-[#9ee8bd]">drafted in seconds.</span> Anything clinical goes straight
            to a person.
          </h1>
          <p className="mt-6 max-w-[44ch] text-base text-on-navy-muted sm:text-lg sm:leading-8">
            Safety rules run first, every draft is <span className="whitespace-nowrap">fact-checked</span>, and a person always presses send.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button
              size="lg"
              variant="onNavy"
              leadingIcon={CirclePlay}
              onClick={start}
              loading={starting}
              loadingLabel="Starting the tour"
            >
              Start the 1-minute tour
            </Button>
            <Button size="lg" variant="onNavyGhost" href="/desk/">
              Open the desk
            </Button>
          </div>
          <p className="mt-10 max-w-[52ch] text-xs text-on-navy-muted sm:mt-14">
            Concept for Dispensed. Not affiliated with Dispensed. All patients, orders and messages are fictional.
          </p>
        </section>

        <div className="relative min-w-0">
          <div className="relative ml-auto aspect-[5/4] w-full overflow-hidden rounded-card bg-navy-800 sm:aspect-[4/5] sm:w-[82%] lg:w-[86%]">
            <Photo
              name="agent"
              priority
              sizes="(min-width: 1024px) 460px, (min-width: 640px) 82vw, 100vw"
              className="object-[50%_18%]"
            />
          </div>
          <WelcomeDemo className="relative mx-3 -mt-20 sm:mx-0 sm:-mt-[52%] sm:w-[min(27rem,100%)] lg:-mt-[60%]" />
        </div>
      </div>
    </div>
  );
}

/** /?tour=1 (where Help > Replay the tour lands on a page without the tour mounted) starts the tour. */
function TourFromLink({ start }: { start: () => void }) {
  const params = useSearchParams();
  const router = useRouter();
  const done = useRef(false);
  const wanted = params?.get("tour") === "1";
  useEffect(() => {
    if (!wanted || done.current) return;
    done.current = true;
    router.replace("/");
    start();
  }, [wanted, start, router]);
  return null;
}
