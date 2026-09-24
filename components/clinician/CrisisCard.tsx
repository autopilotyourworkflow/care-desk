"use client";

import { ExternalLink, LifeBuoy, Phone, RotateCcw, TriangleAlert } from "lucide-react";
import { Button, Card, CardHeader, Chip, Disclosure, Notice, Skeleton } from "@/components/ui";
import { COUNTRY_LABEL, formatCalendarDate } from "@/lib/format";
import { useHelplines } from "@/lib/client/data";
import type { Helpline } from "@/lib/client/types";
import type { Country } from "@/lib/types";
import { emergencyNumber, selectLines, type SupportMode } from "./support";

const KIND_LABEL: Record<string, string> = {
  emergency: "Emergency",
  crisis: "Crisis line",
  poisons: "Poisons",
  health_advice: "Health advice",
};

/**
 * Support lines matched to why the message is urgent, numbers exactly as in public/data/helplines.json, each with its
 * official link (policy P10.2 to P10.4, step 4).
 *  crisis    crisis language: the emergency number first, then the crisis line.
 *  medical   a possible serious reaction or poisoning: the emergency number and the poisons line, as urgent medical help.
 *  family    the patient may have died: a note for the family, the lines one click away.
 *  grief     a living patient has lost someone: a note for them, the lines one click away.
 * In the UK only the patient's own nation's regional line is shown, marked as where they live.
 */
export function CrisisCard({
  country,
  mode,
  nation,
  firstName,
  grieving,
  className,
}: {
  country: Country;
  mode: SupportMode;
  /** The patient's UK nation (support.ts ukNation), or null when unknown or outside the UK. */
  nation: string | null;
  firstName: string;
  /** The patient has also lost someone close: on a medical card, point to the crisis line folded under other lines. */
  grieving?: boolean;
  className?: string;
}) {
  const res = useHelplines();
  const all = res.data ?? [];
  const { primary, other } = selectLines(all, country, nation, mode);
  const shown = [...primary, ...other];
  const verified = shown.map((h) => h.verifiedOn).sort()[0];
  const first = firstName || "the patient";
  const em = emergencyNumber(all, country);
  const hasPoisons = primary.some((h) => h.kind === "poisons");
  const where = country === "UK" && nation ? `${first} lives in ${nation}` : null;
  const folded = mode === "family" || mode === "grief";

  const title =
    mode === "crisis"
      ? `Crisis support for ${COUNTRY_LABEL[country]}`
      : mode === "medical"
        ? "Urgent medical help"
        : mode === "family"
          ? "Support for the family"
          : `Support for ${first}`;
  const description =
    mode === "crisis"
      ? "Give these in your call or reply."
      : mode === "medical"
        ? `${hasPoisons ? "Emergency and poisons lines" : "Emergency and health advice lines"} for ${COUNTRY_LABEL[country]}.`
        : mode === "family"
          ? "Start with condolences in your own words, and let the family lead. The lines are here if they would like someone to talk to."
          : `${first} has lost someone close. Acknowledge it in your reply before anything else. The lines are here if ${first} would like someone to talk to.`;

  const list = (
    <>
      <HelplineList lines={primary} where={where} />
      {other.length > 0 && (
        <Disclosure summary="Other support lines" icon={LifeBuoy} className="mt-3">
          <div className="pt-2">
            <HelplineList lines={other} where={where} />
          </div>
        </Disclosure>
      )}
    </>
  );

  return (
    <Card as="section" aria-labelledby="crisis-title" className={className}>
      <CardHeader title={<span id="crisis-title">{title}</span>} description={description} />

      {mode === "crisis" && (
        <Notice tone="warning" icon={TriangleAlert} className="mb-4">
          If anyone may be in immediate danger, give the emergency number first, then the crisis line.
        </Notice>
      )}
      {mode === "medical" && (
        <Notice tone="warning" icon={Phone} className="mb-4">
          If they have trouble breathing, chest pain, swelling of the face or lips, or a child has swallowed the
          product, tell them to call {em ?? "the emergency number"} now.
          {hasPoisons ? " For a possible overdose with none of these signs, give them the poisons line." : ""}
        </Notice>
      )}
      {grieving && mode === "medical" && other.some((h) => h.kind === "crisis") && (
        <p className="mb-3 text-sm text-ink">
          {first} has also lost someone close. If {first} would like someone to talk to, the crisis line is under
          other support lines.
        </p>
      )}

      {res.status === "error" ? (
        <Notice
          tone="error"
          role="alert"
          title="The support lines did not load"
          actions={
            <Button size="sm" variant="secondary" leadingIcon={RotateCcw} onClick={res.retry}>
              Try again
            </Button>
          }
        >
          {res.error?.message}
        </Notice>
      ) : res.status !== "ready" ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <span role="status" className="sr-only">
            Loading support lines
          </span>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="mt-2 h-3 w-4/5" />
              </div>
              <Skeleton className="h-6 w-20" />
            </div>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted">No support lines are listed for this country yet.</p>
      ) : (
        <>
          {folded ? (
            <Disclosure summary="Show support lines" icon={LifeBuoy}>
              <div className="pt-2">{list}</div>
            </Disclosure>
          ) : (
            list
          )}
          {country === "UK" && !nation && (
            <p className="mt-4 text-xs text-muted">
              The address does not say which UK nation {first} lives in, so only lines for the whole UK are shown.
            </p>
          )}
          <p className="mt-4 text-xs text-muted">
            {verified ? (
              <>
                Numbers as published by each service, checked on{" "}
                <span className="tnum">{formatCalendarDate(verified)}</span>.
              </>
            ) : (
              "Numbers as published by each service."
            )}
          </p>
        </>
      )}
    </Card>
  );
}

/** One full stop at the end of the hours line, whether or not the note already has one. */
function endWithStop(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function HelplineList({ lines, where }: { lines: Helpline[]; where: string | null }) {
  if (!lines.length) return null;
  return (
    <ul className="divide-y divide-line-cool">
      {lines.map((h) => (
        <li
          key={`${h.name}-${h.number}`}
          className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0 sm:gap-4"
        >
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-heading">{h.name}</span>
              <Chip tone={h.kind === "emergency" ? "urgent" : h.kind === "crisis" ? "clinician" : "neutral"}>
                {KIND_LABEL[h.kind] ?? "Support"}
              </Chip>
              {h.region && where && <Chip tone="outline">{where}</Chip>}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {endWithStop(h.note ? `${h.hours}. ${h.note}` : h.hours)}{" "}
              <a
                href={h.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-inner font-medium text-info-fg underline decoration-info-fg/40 underline-offset-2 transition-colors duration-150 hover:decoration-info-fg"
              >
                Official site
                <ExternalLink aria-hidden size={12} />
                <span className="sr-only"> for {h.name} (opens in a new tab)</span>
              </a>
            </p>
          </div>
          <p className="shrink-0 text-right text-lg font-semibold text-navy-900 tnum">
            <span className="sr-only">Number: </span>
            {h.number}
          </p>
        </li>
      ))}
    </ul>
  );
}
