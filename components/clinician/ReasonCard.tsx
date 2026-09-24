"use client";

import { CircleOff, HeartCrack, History, Info, ListChecks, Mail, MessageSquare, ShieldAlert, Sparkles, Timer, UserRound } from "lucide-react";
import { Button, Card, CardHeader, Chip, Disclosure, Divider, Inset } from "@/components/ui";
import { Trail } from "@/components/trail";
import { categoryLabel, formatDate, formatPercent, modelLabel, relativeTime, shortPhrase } from "@/lib/format";
import { ruleLabel } from "@/lib/rule-labels";
import { staffName } from "@/lib/client/session";
import type { CaseFile } from "@/lib/client/types";
import type { DeskRow } from "@/lib/client/queue";
import {
  aiCheckedAfterStop,
  distinctHits,
  figureOfSpeech,
  policyFor,
  reasonHeadline,
  sessionNow,
  stoppedAtText,
  type DeathFraming,
  type FalseAlarmFit,
} from "./model";
import { HighlightedMessage } from "./HighlightedMessage";

/** Why it was escalated: the reason in plain words, the trigger words highlighted, and what the AI thought. */
export function ReasonCard({
  row,
  data,
  death,
  fit,
  onMarkFalseAlarm,
  className,
}: {
  row: DeskRow;
  data: CaseFile;
  /** How a possible death is framed: when it does not lead, the patient's own care is named first. */
  death: DeathFraming;
  /** Whether "Mark as a false alarm" fits this message (model.ts falseAlarmFit); null: it is not offered. */
  fit: FalseAlarmFit | null;
  /** Open the "Mark as a false alarm" control further down. */
  onMarkFalseAlarm?: () => void;
  className?: string;
}) {
  const { message, text, result, patient, thread } = data;
  const first = patient.firstName;
  const hits = result.rules.hits;
  const words = distinctHits(hits);
  // When a death is mentioned but does not lead, the words about the patient's own care come first.
  const deathLast = death.mentioned && !death.led;
  const current = words
    .filter((w) => !w.earlier)
    .sort((a, b) => (deathLast ? Number(a.category === "bereavement") - Number(b.category === "bereavement") : 0));
  const earlier = words.filter((w) => w.earlier && !w.team);
  // Words from an earlier reply by the team (condolences, MSG-0995): never shown as the patient's words.
  const fromTeam = words.filter((w) => w.team);
  const policy = policyFor(row);
  const stopped = stoppedAtText(row, result);
  const aiChecked = aiCheckedAfterStop(result);
  const tone = row.status === "urgent" ? "urgent" : "clinician";
  const ChannelIcon = message.channel === "email" ? Mail : MessageSquare;
  const sort = result.sort;
  const sortIsSample = !!result.models.sort && modelLabel(result.models.sort) === modelLabel("mock");
  const agentDecision = row.escalatedByAgent && row.decision?.kind === "escalated" ? row.decision : undefined;
  const figure = figureOfSpeech(row, result);
  const clearable = fit !== null && !row.cleared && Boolean(onMarkFalseAlarm);
  const quoted = (phrases: string[]) => phrases.map((p) => `“${p}”`).join(" and ");
  // The hint only points to the control; what the clear releases is spelt out next to it.
  let falseAlarmHint: string | null = null;
  if (clearable && fit.kind === "figure" && figure) {
    falseAlarmHint =
      `The rules flag ${quoted(figure.phrases)} even in a figure of speech, on purpose. ` +
      (fit.others.length
        ? "If it is one here, you can mark it as a false alarm, but the rest of the message still needs your answer."
        : "If it is one here, you can mark it as a false alarm.");
  } else if (clearable && fit.kind === "death" && death.aboutSomeoneElseBy === "signed" && fit.others.length === 0) {
    falseAlarmHint =
      `The rules stop every mention of a death on purpose. Once you know ${first} is well and wrote about someone else, ` +
      "you can mark it as a false alarm.";
  }

  return (
    <Card as="section" aria-labelledby="reason-title" data-tour="clinician-reason" className={className}>
      <CardHeader
        title={<span id="reason-title">Why it was escalated</span>}
        actions={<Chip tone="outline">Policy {policy.ref}</Chip>}
      />

      <div className="flex flex-col gap-3">
        <p className="max-w-[65ch] text-base text-ink">{reasonHeadline(row, death, first)}</p>
        <ul className="flex flex-col gap-1.5 text-sm text-muted">
          {death.aboutSomeoneElse && (
            <li className="flex items-start gap-2">
              <HeartCrack aria-hidden size={16} className="mt-0.5 shrink-0 text-muted-icon" />
              {death.aboutSomeoneElseBy === "own_treatment" ? (
                <span>
                  The writer says &ldquo;{death.aboutSomeoneElse}&rdquo;, so it reads as {first} using their own
                  treatment now. It is handled as {first}&apos;s own care, and nothing to {first} was withdrawn.
                </span>
              ) : (
                <span>
                  {first} writes &ldquo;{death.aboutSomeoneElse}&rdquo;, and the message is signed with {first}&apos;s
                  name.
                  {death.usingOwnTreatment
                    ? ` The rules also read ${first} as using their own treatment now, so nothing to ${first} was withdrawn.`
                    : death.livingPatient
                      ? ` Nothing to ${first} was withdrawn.`
                      : ""}
                </span>
              )}
            </li>
          )}
          {stopped && (
            <li className="flex items-start gap-2">
              <ShieldAlert aria-hidden size={16} className="mt-0.5 shrink-0 text-muted-icon" />
              <span>{stopped}</span>
            </li>
          )}
          <li className="flex items-start gap-2">
            <Timer aria-hidden size={16} className="mt-0.5 shrink-0 text-muted-icon" />
            <span>
              <span className="font-medium text-heading">Target: </span>
              {policy.target}
            </span>
          </li>
        </ul>
        {falseAlarmHint && (
          <div className="flex max-w-[65ch] flex-col items-start gap-2 rounded-inner bg-field px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <p className="flex items-start gap-2 text-sm text-ink">
              <Info aria-hidden size={16} className="mt-0.5 shrink-0 text-info-fg" />
              <span>{falseAlarmHint}</span>
            </p>
            <Button size="sm" variant="secondary" leadingIcon={CircleOff} onClick={onMarkFalseAlarm} className="shrink-0">
              Mark as a false alarm
            </Button>
          </div>
        )}
      </div>

      {agentDecision && (
        <>
          <Divider />
          <div className="flex items-start gap-3">
            <UserRound aria-hidden size={18} className="mt-0.5 shrink-0 text-info-fg" />
            <div className="min-w-0">
              <p className="text-sm text-ink">
                <span className="font-semibold text-heading">{staffName(agentDecision.by) ?? "An agent"}</span>{" "}
                escalated this from the desk {relativeTime(agentDecision.at, sessionNow())}.
              </p>
              {agentDecision.reason ? (
                <Inset className="mt-2">
                  <p className="whitespace-pre-wrap break-words">{agentDecision.reason}</p>
                </Inset>
              ) : (
                <p className="mt-1 text-sm text-muted">No note was added.</p>
              )}
            </div>
          </div>
        </>
      )}

      <Divider />

      <Inset className="p-4" data-tone={tone}>
        <p className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <ChannelIcon aria-hidden size={14} className="text-muted-icon" />
          <span>
            {message.channel === "email" ? "Email" : "Chat"} from {patient.firstName}&apos;s account,{" "}
            <span className="tnum">{formatDate(message.receivedAt, patient.timezone, "dateTimeZone")}</span>
          </span>
          <span className="tnum">{message.id}</span>
        </p>
        <HighlightedMessage message={message} text={text} hits={hits} />
      </Inset>

      {/* The words are marked in the message above; this one line says what each of them is. */}
      {current.length > 0 && (
        <p className="mt-3 text-sm text-ink" data-tone={tone}>
          <span className="font-medium text-heading">
            {current.length === 1 ? "The words that stopped it: " : "Highlighted, the words that stopped it: "}
          </span>
          {current.map((w, i) => (
            <span key={w.phrase}>
              {i > 0 && (i === current.length - 1 ? " and " : ", ")}
              <mark title={w.phrase.length > 60 ? w.phrase : undefined}>{shortPhrase(w.phrase)}</mark>{" "}
              <span className="text-muted">({(ruleLabel(w.ruleId) ?? categoryLabel(w.category)).toLowerCase()})</span>
            </span>
          ))}
          .
        </p>
      )}
      {current.length === 0 && earlier.length === 0 && fromTeam.length === 0 && !row.escalatedByAgent && (
        <p className="mt-3 text-sm text-muted">No trigger words matched in this message.</p>
      )}

      {earlier.length > 0 && (
        <p className="mt-3 flex items-start gap-2 text-sm text-ink" data-tone={tone}>
          <History aria-hidden size={16} className="mt-0.5 shrink-0 text-muted-icon" />
          <span>
            Also matched in an earlier message in this conversation:{" "}
            {earlier.map((w, i) => (
              <span key={w.phrase}>
                {i > 0 && ", "}
                <mark>{shortPhrase(w.phrase)}</mark>
              </span>
            ))}
            . It is not highlighted above because it is not in this message.
          </span>
        </p>
      )}

      {fromTeam.length > 0 && (
        <p className="mt-3 flex items-start gap-2 text-sm text-ink" data-tone={tone}>
          <History aria-hidden size={16} className="mt-0.5 shrink-0 text-muted-icon" />
          <span>
            From an earlier reply by the team:{" "}
            {fromTeam.map((w, i) => (
              <span key={w.phrase}>
                {i > 0 && ", "}
                <mark>{shortPhrase(w.phrase)}</mark>
              </span>
            ))}
            . The team&apos;s own words, not {first}&apos;s, so they are not highlighted in the message above.
          </span>
        </p>
      )}

      {thread.length > 0 && (
        <Disclosure summary={`Earlier in this conversation (${thread.length})`} icon={History} className="mt-3">
          <ol className="flex flex-col gap-2">
            {thread.map((t, i) => (
              <li key={i}>
                <Inset>
                  <p className="mb-1 text-xs text-muted">
                    <span className="font-medium text-heading">
                      {t.from === "patient" ? "Patient" : "Support team"}
                    </span>
                    , <span className="tnum">{formatDate(t.at, patient.timezone, "dateTime")}</span>
                  </p>
                  <p className="whitespace-pre-wrap break-words">{t.body}</p>
                </Inset>
              </li>
            ))}
          </ol>
        </Disclosure>
      )}

      <Divider />

      {sort ? (
        <Disclosure summary="What the AI thought" icon={Sparkles}>
          <div className="flex flex-col gap-2 pb-1">
            <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
              <Chip category={sort.category} />
              <span className="tnum">{formatPercent(sort.confidence)} sure</span>
              {sortIsSample && <Chip tone="warning">Sample AI</Chip>}
            </p>
            {sort.reasons.length > 0 && (
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink marker:text-muted-icon">
                {sort.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted">
              Run by {modelLabel(result.models.sort ?? "mock")}. The safety rules and the AI check each can escalate. A
              draft is written only when both agree the message is routine.
            </p>
          </div>
        </Disclosure>
      ) : stopped ? null : (
        // When the stop line above already says what the AI did, it is not said twice.
        <p className="text-sm text-muted">
          {aiChecked
            ? "The AI wrote no reply. It only checked the message, with personal details removed, for anything more urgent, and it left the route with a clinician."
            : "The AI never saw this message: the safety rules stopped it first."}
        </p>
      )}

      <Disclosure summary="See the full check trail" icon={ListChecks} className={sort ? "mt-1" : !stopped ? "mt-4" : undefined}>
        <div className="pt-1">
          <Trail result={result} compact title={false} messageText={text} subject={!!message.subject} thread={thread} />
        </div>
      </Disclosure>
    </Card>
  );
}
