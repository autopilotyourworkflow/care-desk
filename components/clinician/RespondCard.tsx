"use client";

import { useImperativeHandle, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import { CircleCheck, CircleOff, NotebookPen, Phone, PhoneMissed, Send, StickyNote } from "lucide-react";
import {
  Avatar,
  Button,
  Card,
  CardHeader,
  Disclosure,
  Field,
  Inset,
  KeyCombo,
  Notice,
  TextArea,
  useToast,
} from "@/components/ui";
import { relativeTime, plural } from "@/lib/format";
import { staffName, useSession } from "@/lib/client/session";
import type { CaseFile } from "@/lib/client/types";
import type { DeskRow } from "@/lib/client/queue";
import {
  CALL_NO_ANSWER,
  CALL_SPOKE,
  READING_TEXT,
  clearEffectText,
  clearToastDetail,
  reasonCategory,
  sessionNow,
  type ClearPreview,
  type DeathFraming,
  type FalseAlarmFit,
} from "./model";
import { useClinicianUndo } from "./undo";

interface Entry {
  key: string;
  at: string;
  by: string;
  icon: typeof Phone;
  title: string;
  body?: string;
}

export interface RespondHandle {
  /** Open "Mark as a false alarm", bring it into view and put focus in its note. */
  openFalseAlarm: () => void;
}

/** The clinician's own reply (no AI, no draft), the call log, internal notes, a false alarm, and the activity log. */
export function RespondCard({
  row,
  data,
  death,
  fit,
  preview,
  heldBackCount,
  handle,
  className,
}: {
  row: DeskRow;
  data: CaseFile;
  /** How a possible death is framed: only when it leads is the reply written to the family. */
  death: DeathFraming;
  /** Whether "Mark as a false alarm" fits this message, and what stays after it (null: not offered). */
  fit: FalseAlarmFit | null;
  /** What the clear would do to the patient's other replies right now (null while the queue loads). */
  preview: ClearPreview | null;
  handle?: Ref<RespondHandle>;
  /** Replies on the desk this message holds back "Check with clinician before sending": speaking to the patient releases them. */
  heldBackCount: number;
  className?: string;
}) {
  const session = useSession();
  const { toast } = useToast();
  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [clearNote, setClearNote] = useState("");
  const [clearError, setClearError] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const noteWrapRef = useRef<HTMLDivElement>(null);
  const clearWrapRef = useRef<HTMLDivElement>(null);
  const activityRef = useRef<HTMLHeadingElement>(null);
  const clearNoteRef = useRef<HTMLTextAreaElement>(null);
  const undoable = useClinicianUndo();

  useImperativeHandle(
    handle,
    () => ({
      openFalseAlarm: () => {
        setClearOpen(true);
        window.requestAnimationFrame(() => {
          let reduce = false;
          try {
            reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          } catch {
            /* no matchMedia: jump */
          }
          clearWrapRef.current?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
          clearNoteRef.current?.focus({ preventScroll: true });
        });
      },
    }),
    [],
  );

  /** Put focus back on a disclosure's own button when its content closes, so it never falls to the page. */
  const focusToggle = (wrap: RefObject<HTMLDivElement | null>) => {
    window.setTimeout(() => wrap.current?.querySelector<HTMLElement>("button[aria-expanded]")?.focus(), 0);
  };
  const closeNote = () => {
    setNoteOpen(false);
    setNoteError(null);
    focusToggle(noteWrapRef);
  };
  const closeClear = () => {
    setClearOpen(false);
    setClearError(null);
    focusToggle(clearWrapRef);
  };

  const { patient } = data;
  const bereavement = death.led;
  const crisis = reasonCategory(row) === "crisis";
  const to = bereavement ? "the family" : patient.firstName;
  const rec = row.clinicianRecord;
  const canClear = fit !== null;

  const sendReply = () => {
    if (!reply.trim()) {
      setReplyError(`Write your reply to ${to} first.`);
      replyRef.current?.focus();
      return;
    }
    if (session.clinicianReply(row.messageId, reply)) {
      setReply("");
      setReplyError(null);
      toast({
        message: "Reply sent",
        detail: `To ${to}. Simulated: nothing leaves this demo.`,
        tone: "success",
        onUndo: undoable("reply", row.messageId),
      });
    }
  };

  const heldBackText = plural(heldBackCount, "reply", "replies");
  const logSpoke = () => {
    if (session.logCall(row.messageId, CALL_SPOKE)) {
      toast({
        message: `Spoke to ${to}`,
        detail: heldBackCount
          ? `${heldBackText} released on the desk.`
          : `Recorded as ${session.staff.name}.`,
        tone: "success",
        onUndo: undoable("call", row.messageId),
      });
    }
  };
  const logNoAnswer = () => {
    if (session.logCall(row.messageId, CALL_NO_ANSWER)) {
      toast({
        message: "Call attempt logged",
        detail: heldBackCount
          ? `No answer. ${heldBackText} ${heldBackCount === 1 ? "stays" : "stay"} held.`
          : `No answer. Recorded as ${session.staff.name}.`,
        tone: "neutral",
        onUndo: undoable("call", row.messageId),
      });
    }
  };

  const saveNote = () => {
    if (!note.trim()) {
      setNoteError("Write the note first.");
      return;
    }
    if (session.addNote(row.messageId, note)) {
      setNote("");
      closeNote();
      toast({
        message: "Note added",
        detail: "Only the team sees internal notes.",
        tone: "success",
        onUndo: undoable("note", row.messageId),
      });
    }
  };

  const markFalseAlarm = () => {
    if (!clearNote.trim()) {
      setClearError("Say why it is a false alarm, so the desk knows it is safe to reply.");
      return;
    }
    if (session.clearAlert(row.messageId, clearNote)) {
      setClearNote("");
      setClearError(null);
      setClearOpen(false);
      // The false-alarm control goes away once it is marked, so focus moves to the activity log that records it.
      window.setTimeout(() => activityRef.current?.focus(), 0);
      toast({
        message: "Marked as a false alarm",
        detail: preview ? clearToastDetail(preview) : undefined,
        tone: "success",
        onUndo: undoable("clear", row.messageId),
      });
    }
  };

  const entries: Entry[] = [];
  rec?.calls.forEach((c, i) =>
    entries.push({
      key: `c${i}`,
      at: c.at,
      by: c.by,
      icon: c.outcome === CALL_NO_ANSWER ? PhoneMissed : Phone,
      title:
        c.outcome === CALL_SPOKE
          ? `Called and spoke to ${to}`
          : c.outcome === CALL_NO_ANSWER
            ? "Called, no answer or voicemail"
            : "Called the patient",
      body: c.outcome === CALL_SPOKE || c.outcome === CALL_NO_ANSWER ? undefined : c.outcome,
    }),
  );
  rec?.replies.forEach((r, i) =>
    entries.push({
      key: `r${i}`,
      at: r.at,
      by: r.by,
      icon: Send,
      title: `Replied to ${to}`,
      body: r.text,
    }),
  );
  rec?.notes.forEach((n, i) =>
    entries.push({
      key: `n${i}`,
      at: n.at,
      by: n.by,
      icon: StickyNote,
      title: "Internal note",
      body: n.text,
    }),
  );
  if (rec?.holdResumed)
    entries.push({
      key: "h",
      at: rec.holdResumed.at,
      by: rec.holdResumed.by,
      icon: CircleCheck,
      title: "Resumed orders",
      body: rec.holdResumed.note,
    });
  if (rec?.cleared)
    entries.push({
      key: "x",
      at: rec.cleared.at,
      by: rec.cleared.by,
      icon: CircleOff,
      title: "Marked as a false alarm",
      body: rec.cleared.note,
    });
  entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const now = sessionNow();

  return (
    <Card as="section" aria-labelledby="respond-title" className={className}>
      <CardHeader
        title={<span id="respond-title">Reply to {to}</span>}
        description="No AI and no draft: what you write is what they receive."
      />

      {crisis && (
        <p className="mb-3 text-sm text-ink">
          <span className="font-semibold text-heading">Call first if you can.</span> For crisis language, speak to the
          patient before you write, and use the support lines on this page.
        </p>
      )}

      <Field
        label="Your reply"
        hideLabel
        error={replyError}
        hint={
          // The button says the send is simulated; the hint only adds the shortcut, on screens with a keyboard.
          <span className="hidden items-center gap-1 lg:inline-flex">
            Press <KeyCombo keys={["Ctrl", "Enter"]} /> to send.
          </span>
        }
      >
        <TextArea
          ref={replyRef}
          rows={6}
          value={reply}
          placeholder={bereavement ? "Write to the family in your own words" : `Hi ${patient.firstName},`}
          onChange={(e) => {
            setReply(e.target.value);
            if (replyError) setReplyError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              sendReply();
            }
          }}
        />
      </Field>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button leadingIcon={Send} onClick={sendReply}>
          Send reply (simulated)
        </Button>
      </div>

      <div className="mt-4 border-t border-line-cool pt-3">
        <h3 className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-heading">
          Log a call
          <span className="text-xs font-normal text-muted tnum">
            <span className="sr-only">. The number on file: </span>
            {patient.phone}
          </span>
        </h3>
        <p className="mt-0.5 text-sm text-muted">
          {heldBackCount
            ? `Once you have spoken to ${to}, the ${heldBackText} held back on the desk ${heldBackCount === 1 ? "is" : "are"} released. A call with no answer keeps ${heldBackCount === 1 ? "it" : "them"} held.`
            : `Recorded as ${session.staff.name}, so the next clinician knows who tried and when.`}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button variant="secondary" leadingIcon={Phone} onClick={logSpoke}>
            Spoke to {to}
          </Button>
          <Button variant="secondary" leadingIcon={PhoneMissed} onClick={logNoAnswer}>
            No answer or voicemail
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-1 border-t border-line-cool pt-3">
        <div ref={noteWrapRef}>
          <Disclosure summary="Add an internal note" icon={NotebookPen} open={noteOpen} onOpenChange={setNoteOpen}>
            <div className="flex flex-col gap-2 pb-2">
              <Field
                label="Internal note"
                hideLabel
                hint="Only the team sees this. It is not sent to the patient."
                error={noteError}
              >
                <TextArea
                  rows={3}
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    if (noteError) setNoteError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      closeNote();
                    }
                  }}
                  placeholder="For example: asked for a call back after 5 pm their time"
                />
              </Field>
              <div>
                <Button size="sm" variant="secondary" onClick={saveNote}>
                  Add note
                </Button>
              </div>
            </div>
          </Disclosure>
        </div>

        {canClear && !row.cleared && (
          <div ref={clearWrapRef}>
            <Disclosure summary="Mark as a false alarm" icon={CircleOff} open={clearOpen} onOpenChange={setClearOpen}>
              <div className="flex flex-col gap-2 pb-2">
                <p className="text-sm text-ink">
                  {[
                    fit ? falseAlarmUse(fit, patient.firstName) : "",
                    preview ? clearEffectText(preview, patient.firstName) : "",
                    row.holdActive ? "Orders stay on hold until you resume them." : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                </p>
                {fit && fit.others.length > 0 && (
                  <p className="text-sm text-ink">
                    <span className="font-semibold text-heading">The rest still needs you.</span> This message also has{" "}
                    {fit.others.map((c) => READING_TEXT[c]).join(" and ")}, so reply to or call {patient.firstName} as
                    well.
                  </p>
                )}
                <Field label="Why is it a false alarm?" required error={clearError}>
                  <TextArea
                    ref={clearNoteRef}
                    rows={2}
                    value={clearNote}
                    onChange={(e) => {
                      setClearNote(e.target.value);
                      if (clearError) setClearError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        closeClear();
                      }
                    }}
                    placeholder={fit ? FALSE_ALARM_EXAMPLE[fit.kind] : undefined}
                  />
                </Field>
                <div>
                  <Button size="sm" variant="secondary" leadingIcon={CircleOff} onClick={markFalseAlarm}>
                    Mark as a false alarm
                  </Button>
                </div>
              </div>
            </Disclosure>
          </div>
        )}
      </div>

      {(entries.length > 0 || (row.cleared && rec?.cleared)) && (
        <div className="mt-4 border-t border-line-cool pt-4">
          <h3 ref={activityRef} tabIndex={-1} className="text-sm font-semibold text-heading outline-none">
            Activity
          </h3>
          {row.cleared && rec?.cleared && (
            <Notice tone="neutral" className="mt-2">
              {heldBackCount
                ? `Marked as a false alarm.${fit?.kind === "death" ? " Only the death reading went." : ""} ${heldBackText} to ${patient.firstName} still ${heldBackCount === 1 ? "waits" : "wait"} until you have been in touch.`
                : `Marked as a false alarm. It no longer holds back any replies to ${patient.firstName} on the desk.`}
            </Notice>
          )}
          {entries.length ? (
            <ol className="mt-2 flex flex-col gap-3">
              {entries.map((e) => (
                <ActivityItem key={e.key} entry={e} now={now} />
              ))}
            </ol>
          ) : null}
        </div>
      )}
    </Card>
  );
}

/** When to use "Mark as a false alarm", worded for why this message was stopped. */
function falseAlarmUse(fit: FalseAlarmFit, firstName: string): string {
  const first = firstName || "the patient";
  switch (fit.kind) {
    case "death":
      return `Use this only once you know ${first} is well and the death was someone else's.`;
    case "figure":
      return "Use this when the flagged words were a figure of speech.";
    case "ai_flag":
      return "The AI check flags on the cautious side. Use this when nothing in the message needs a clinician.";
  }
}

const FALSE_ALARM_EXAMPLE: Record<FalseAlarmFit["kind"], string> = {
  death: "For example: called the patient, it was their grandmother who died",
  figure: "For example: 'dying to get my order' is a figure of speech",
  ai_flag: "For example: only asks when the parcel arrives, nothing about their health",
};

function ActivityItem({ entry, now }: { entry: Entry; now: number }) {
  const Icon = entry.icon;
  const who = staffName(entry.by) ?? "A clinician";
  let body: ReactNode = null;
  if (entry.body) {
    body = (
      <Inset className="mt-1.5">
        <p className="whitespace-pre-wrap break-words">{entry.body}</p>
      </Inset>
    );
  }
  return (
    <li className="flex gap-3">
      <Avatar name={who} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-ink">
          <Icon aria-hidden size={14} className="text-muted-icon" />
          <span className="font-medium text-heading">{entry.title}</span>
          <span className="text-muted">
            by {who}, {relativeTime(entry.at, now)}
          </span>
        </p>
        {body}
      </div>
    </li>
  );
}
