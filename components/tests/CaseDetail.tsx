"use client";

import type { ReactNode } from "react";
import { ArrowRight, ArrowUp, Ban, Check, Info, Link2, Mail, MessagesSquare, RotateCcw, ShieldAlert, SquareArrowOutUpRight, X } from "lucide-react";
import type { EvalCase, PipelineResult } from "@/lib/types";
import type { QueueLock } from "@/lib/client/types";
import { useCase } from "@/lib/client/data";
import { useSession } from "@/lib/client/session";
import {
  Button,
  Chip,
  Disclosure,
  Inset,
  LoadingStatus,
  Notice,
  RiskBadge,
  Skeleton,
  SkeletonText,
  useToast,
} from "@/components/ui";
import { Trail } from "@/components/trail";
import { CATEGORY_LABEL, COUNTRY_LABEL, formatDate } from "@/lib/format";
import { caseOutcome, holdMatches, TEAM_REPLY_LABEL, threadOpensByDefault, threadSummary, type OutcomeKind } from "./model";

type Mark = "match" | "differs" | "on_purpose" | "stricter";

function Same({ mark }: { mark: Mark }) {
  switch (mark) {
    case "match":
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-success-fg">
          <Check aria-hidden size={14} className="shrink-0" /> Match
        </span>
      );
    case "on_purpose":
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-info-fg">
          <Info aria-hidden size={14} className="shrink-0" /> Differs, on purpose
        </span>
      );
    case "stricter":
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-info-fg">
          <ArrowUp aria-hidden size={14} className="shrink-0" /> Stricter
        </span>
      );
    case "differs":
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-warning-fg">
          <X aria-hidden size={14} className="shrink-0" /> Differs
        </span>
      );
  }
}

function ExpectedVsGot({ c, outcome }: { c: EvalCase; outcome: OutcomeKind }) {
  // An accepted over-escalation differs by design, and a more cautious queue is stricter, not wrong: neither is marked as a failure.
  const differs = (kind: "queue" | "other"): Mark =>
    outcome === "false_alarm" ? "on_purpose" : kind === "queue" && outcome === "safer" ? "stricter" : "differs";
  const rows = [
    {
      label: "Queue",
      expected: <RiskBadge route={c.expected.expectedRoute} />,
      got: <RiskBadge route={c.got.route} />,
      mark: c.routeCorrect ? "match" : differs("queue"),
    },
    {
      label: "Type",
      expected: <span className="text-sm text-ink">{CATEGORY_LABEL[c.expected.expectedCategory]}</span>,
      got: <span className="text-sm text-ink">{c.got.category ? CATEGORY_LABEL[c.got.category] : "Not sorted"}</span>,
      mark: c.categoryCorrect ? "match" : differs("other"),
    },
    {
      label: "Orders on hold",
      expected: <span className="text-sm text-ink">{c.expected.mustHold ? "Yes" : "No"}</span>,
      got: <span className="text-sm text-ink">{c.got.holdOrders ? "Yes" : "No"}</span>,
      mark: holdMatches(c) ? "match" : differs("other"),
    },
  ] satisfies { label: string; expected: ReactNode; got: ReactNode; mark: Mark }[];
  // Wide: a four-column table. Narrow (below sm): each check stacks, with visible Expected and Got labels, so the
  // table always fits its card and never scrolls sideways.
  return (
    <table className="w-full border-collapse text-sm max-sm:block">
      <caption className="sr-only">Expected and actual handling for {c.messageId}</caption>
      <thead className="max-sm:hidden">
        <tr className="border-b border-line-cool text-left text-xs text-muted">
          <th scope="col" className="pb-2 pr-3 font-medium">
            <span className="sr-only">Check</span>
          </th>
          <th scope="col" className="pb-2 pr-3 font-medium">
            Expected
          </th>
          <th scope="col" className="pb-2 pr-3 font-medium">
            Got
          </th>
          <th scope="col" className="pb-2 font-medium">
            <span className="sr-only">Result</span>
          </th>
        </tr>
      </thead>
      <tbody className="max-sm:block">
        {rows.map((r) => (
          <tr
            key={r.label}
            className="border-b border-line-cool last:border-b-0 max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:items-center max-sm:gap-x-3 max-sm:gap-y-1.5 max-sm:py-3"
          >
            <th
              scope="row"
              className="py-2.5 pr-3 text-left text-xs font-medium text-muted max-sm:col-start-1 max-sm:row-start-1 max-sm:p-0"
            >
              {r.label}
            </th>
            <td className="py-2.5 pr-3 max-sm:col-span-2 max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-2 max-sm:p-0">
              <span className="w-16 shrink-0 text-xs text-muted sm:hidden">Expected</span>
              {r.expected}
            </td>
            <td className="py-2.5 pr-3 max-sm:col-span-2 max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-2 max-sm:p-0">
              <span className="w-16 shrink-0 text-xs text-muted sm:hidden">Got</span>
              {r.got}
            </td>
            <td className="py-2.5 text-right max-sm:col-start-2 max-sm:row-start-1 max-sm:p-0">
              <Same mark={r.mark} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DetailSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <LoadingStatus label="Loading the case" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-4 w-1/3" />
        <SkeletonText lines={3} />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-1/4" />
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton rounded="pill" className="size-6" />
            <Skeleton className="h-3.5 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The trail as the desk shows it for a patient-level lock: the eval scores the message after the patient's holds (orders
 * on hold), and the decide step says Send is off, never "waiting for a person to write the reply".
 */
function lockedResult(result: PipelineResult, lock: QueueLock, holdOrders: boolean): PipelineResult {
  const summary =
    lock.kind === "withdrawn"
      ? `Send is off. Nothing is sent to this patient after ${lock.messageId} reported a death`
      : `Send is off until a clinician has been in touch about ${lock.messageId}`;
  return {
    ...result,
    holdOrders: result.holdOrders || holdOrders,
    trail: result.trail.map((s) => (s.id === "decide" ? { ...s, summary } : s)),
  };
}

/** A patient-level lock, said above the trail in the desk's words, with the message that caused it. */
function LockNote({ lock, onOpen }: { lock: QueueLock; onOpen?: () => void }) {
  return (
    <Notice
      tone="warning"
      icon={lock.kind === "withdrawn" ? Ban : ShieldAlert}
      title={lock.kind === "withdrawn" ? `Withdrawn after ${lock.messageId} reported a death` : lock.label}
      className="mb-4"
      actions={
        onOpen ? (
          <Button size="sm" variant="secondary" trailingIcon={ArrowRight} onClick={onOpen}>
            Open {lock.messageId}
          </Button>
        ) : undefined
      }
    >
      <p>{lock.detail}</p>
      <p className="mt-1 text-xs text-warning-fg">
        {lock.kind === "withdrawn"
          ? "The trail below is this message on its own. The withdrawal outranks it."
          : "The trail below is this message on its own. The hold outranks it."}
      </p>
    </Notice>
  );
}

/** One test case opened inline: the message, expected against what happened, the label's note and the full trail. */
export function CaseDetail({
  c,
  onClose,
  id,
  caseOpener,
}: {
  c: EvalCase;
  onClose: () => void;
  id: string;
  /** Returns an action that opens another test case, or undefined when that message is not in the test set. */
  caseOpener?: (id: string) => (() => void) | undefined;
}) {
  const res = useCase(c.messageId);
  const { staffFor } = useSession();
  const { toast } = useToast();
  const outcome = caseOutcome(c);

  const copyLink = async () => {
    try {
      const url = `${window.location.origin}${window.location.pathname}?case=${c.messageId}`;
      await navigator.clipboard.writeText(url);
      toast({ message: "Link copied", detail: `Opens ${c.messageId} on this page`, tone: "success" });
    } catch {
      toast({ message: "Could not copy the link. Copy it from the address bar instead.", tone: "error" });
    }
  };

  return (
    <div id={id} className="animate-rise-in border-t border-line-cool px-4 pb-6 pt-5 sm:px-6">
      {res.status === "error" ? (
        <Notice
          tone="error"
          role="alert"
          title="This case did not load"
          actions={
            res.error?.kind === "not_found" ? undefined : (
              <Button size="sm" variant="secondary" leadingIcon={RotateCcw} onClick={res.retry}>
                Try again
              </Button>
            )
          }
        >
          {res.error?.message ?? "Could not load the demo data. Check your connection and try again."}
        </Notice>
      ) : res.status !== "ready" || !res.data ? (
        <DetailSkeleton />
      ) : (
        (() => {
          const cf = res.data;
          const m = cf.message;
          const ChannelIcon = m.channel === "email" ? Mail : MessagesSquare;
          const sample = cf.row?.sample ?? (cf.result.models.sort === "mock" || cf.result.models.draft === "mock");
          // The patient-level lock, as the desk shows it: another message from this patient reports a death or
          // something urgent. The eval scores the message with that lock applied, so the trail must say so too.
          const lock = cf.testOnly ? undefined : (cf.row?.lock ?? cf.lock);
          const shown = lock ? lockedResult(cf.result, lock, c.got.holdOrders) : cf.result;
          const safetyGot = c.got.route === "clinician" || c.got.route === "urgent";
          return (
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8">
              <div className="flex min-w-0 flex-col gap-5">
                <div>
                  <h3 className="text-base font-semibold text-heading">The message</h3>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    <ChannelIcon aria-hidden size={14} className="text-muted-icon" />
                    <span>
                      {m.channel === "email" ? "Email" : "Chat"} from {cf.patient.firstName}, {COUNTRY_LABEL[cf.patient.country]}
                    </span>
                    <span aria-hidden>·</span>
                    {/* Always the date, never "2 h ago": many surprise test messages are dated after the demo's "now". */}
                    <span className="tnum">{formatDate(m.receivedAt, cf.patient.timezone, "dateTimeZone")}</span>
                  </p>
                  <Inset className="mt-2.5">
                    {m.subject && <p className="mb-1.5 font-semibold text-heading">{m.subject}</p>}
                    <p className="whitespace-pre-line break-words text-ink">{m.body}</p>
                  </Inset>
                  {cf.thread.length > 0 && (
                    <Disclosure
                      className="mt-2"
                      // A surprise test message, or any thread with a reply from the team, only makes sense with its
                      // conversation in view (MSG-0995: the death is told only in the team's earlier reply), so it opens.
                      defaultOpen={threadOpensByDefault(cf.thread, cf.testOnly)}
                      summary={threadSummary(cf.thread)}
                    >
                      <ol className="flex flex-col gap-2">
                        {cf.thread.map((t, i) => (
                          <li key={i}>
                            <Inset>
                              <p className="text-xs text-muted">
                                {t.from === "patient" ? cf.patient.firstName : TEAM_REPLY_LABEL},{" "}
                                <span className="tnum">{formatDate(t.at, cf.patient.timezone, "dateTime")}</span>
                              </p>
                              <p className="mt-1 whitespace-pre-line break-words text-ink">{t.body}</p>
                            </Inset>
                          </li>
                        ))}
                      </ol>
                    </Disclosure>
                  )}
                </div>

                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-heading">Expected and what happened</h3>
                    <Chip tone={outcome.tone}>{outcome.label}</Chip>
                  </div>
                  <p className="mt-1 text-sm text-muted">{outcome.meaning}</p>
                  <div className="mt-3">
                    <ExpectedVsGot c={c} outcome={outcome.kind} />
                  </div>
                </div>

                {c.expected.note && (
                  <div>
                    <h3 className="text-base font-semibold text-heading">What a correct system does</h3>
                    <p className="mt-1 max-w-[65ch] text-sm text-ink">{c.expected.note}</p>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="sm" leadingIcon={Link2} onClick={copyLink}>
                    Copy link to this case
                  </Button>
                  {!cf.testOnly && (
                    <Button variant="ghost" size="sm" leadingIcon={SquareArrowOutUpRight} href={`/desk/?m=${c.messageId}`}>
                      Open on the desk
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" leadingIcon={X} onClick={onClose}>
                    Close
                  </Button>
                </div>
              </div>

              <div className="min-w-0 border-t border-line-cool pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                {sample && (
                  <p className="mb-3">
                    <Chip tone="warning">Sample result</Chip>
                  </p>
                )}
                {lock && <LockNote lock={lock} onOpen={caseOpener?.(lock.messageId)} />}
                <Trail
                  result={shown}
                  messageText={cf.text}
                  subject={m.channel === "email" && !!m.subject}
                  thread={cf.thread}
                  names={{ firstName: cf.patient.firstName, agentName: staffFor("agent").name }}
                  lock={lock ? { kind: lock.kind, detail: lock.detail } : undefined}
                  defaultOpen={lock ? [] : safetyGot ? ["rules"] : ["check"]}
                />
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
}
