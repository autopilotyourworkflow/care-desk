"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui";
import { useMeta, useQueue } from "@/lib/client/data";
import type { QueueRow } from "@/lib/client/types";

type Finder = (rows: QueueRow[], threshold: number) => { href: string; label: string } | null;

interface FailureRow {
  what: string;
  desk: string;
  next: string;
  example?: Finder;
}

const firstWhere = (rows: QueueRow[], fn: (r: QueueRow) => boolean) => rows.find(fn) ?? null;

/**
 * What the system does when each part fails. The example links are looked up in the live queue data, so they always
 * point at a message that really behaves that way in this build, and disappear if none does.
 */
const ROWS: FailureRow[] = [
  {
    what: "The AI is unavailable",
    desk: "Details are still removed and the safety rules still run: both are plain code. Nothing is drafted, so every message goes to a person.",
    next: "Agents reply as they do today",
  },
  {
    what: "The sorter is not sure",
    desk: "Below {threshold} confidence there is no draft. The message shows as Write the reply, with the best guess.",
    next: "An agent writes the reply",
    example: (rows, threshold) => {
      const r = firstWhere(rows, (r) => r.route === "person" && r.confidence != null && r.confidence < threshold);
      return r ? { href: `/desk/?m=${r.messageId}`, label: `See ${r.messageId}` } : null;
    },
  },
  {
    what: "The fact check fails",
    desk: "Any date, amount, order or tracking number missing from the sources blocks the draft, as does any dose. The trail names the fact.",
    next: "An agent writes the reply",
  },
  {
    what: "A safety rule fires",
    desk: "No AI reply. The patient's orders go on hold and the message joins the clinician queue, urgent first.",
    next: "A clinician",
    example: (rows) => {
      const r = firstWhere(rows, (r) => r.reason.stoppedAt === "rules" && (r.route === "clinician" || r.route === "urgent"));
      return r ? { href: `/clinician/?m=${r.messageId}`, label: `See ${r.messageId}` } : null;
    },
  },
  {
    what: "The drafter declines",
    desk: "If the sources do not hold the answer, it says so instead of guessing. No draft.",
    next: "An agent writes the reply",
  },
  {
    what: "A death is reported later",
    desk: "Every unsent draft to that patient is withdrawn at once and their orders are held. A clinician checks the report first.",
    next: "A clinician, then the family",
    example: (rows) => {
      const r = firstWhere(rows, (r) => r.status === "withdrawn");
      return r ? { href: `/desk/?m=${r.messageId}`, label: `See ${r.messageId}` } : null;
    },
  },
];

export function FailureTable({ threshold }: { threshold: number }) {
  const pct = `${Math.round(threshold * 100)}%`;
  const queue = useQueue();
  const meta = useMeta();
  const rows = queue.data?.items;

  return (
    <div>
      <div className="overflow-hidden rounded-card bg-surface shadow-card ring-1 ring-line/70">
        <table className="w-full border-collapse text-left text-sm max-md:block">
          <caption className="sr-only">What happens when each part of Care Desk fails, and who acts next</caption>
          <thead className="bg-inset max-md:hidden">
            <tr>
              <th scope="col" className="w-[24%] px-5 py-3 text-xs font-semibold text-muted">
                When
              </th>
              <th scope="col" className="px-5 py-3 text-xs font-semibold text-muted">
                What Care Desk does
              </th>
              <th scope="col" className="w-[22%] px-5 py-3 text-xs font-semibold text-muted">
                Who acts next
              </th>
            </tr>
          </thead>
          <tbody className="max-md:block">
            {ROWS.map((row) => {
              const example = row.example ? (rows ? row.example(rows, threshold) : undefined) : null;
              return (
                <tr key={row.what} className="border-t border-line-cool max-md:block max-md:px-4 max-md:py-4 max-md:first:border-t-0">
                  <th scope="row" className="px-5 py-4 align-top font-semibold text-heading max-md:block max-md:p-0">
                    {row.what}
                  </th>
                  <td className="px-5 py-4 align-top text-ink max-md:mt-1 max-md:block max-md:p-0">
                    <p className="max-w-[62ch]">{row.desk.replace("{threshold}", pct)}</p>
                    {example === undefined && queue.status !== "error" ? (
                      <Skeleton className="mt-2 h-5 w-24" />
                    ) : example ? (
                      <Link
                        href={example.href}
                        className="group mt-2 inline-flex items-center gap-1 rounded-inner text-sm font-medium text-navy-900 underline decoration-navy-300 underline-offset-2 hover:decoration-navy-900 active:text-navy-700"
                      >
                        {example.label}
                        <ArrowRight aria-hidden size={14} className="transition-transform duration-150 group-hover:translate-x-0.5" />
                      </Link>
                    ) : null}
                  </td>
                  <td className="px-5 py-4 align-top text-ink max-md:mt-2 max-md:block max-md:p-0">
                    <span className="mr-1 text-xs font-semibold text-muted md:hidden">Next:</span>
                    {row.next}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {meta.data?.isMock && (
        <p className="mt-3 text-xs text-muted">
          Sample run: the examples were sorted and drafted by a simple built-in stand-in for Claude, so they may change.
        </p>
      )}
    </div>
  );
}
