"use client";

import { useId, type ReactNode } from "react";
import { Check } from "lucide-react";
import type { Persona } from "@/lib/client/types";
import type { Patient, SourceRef } from "@/lib/types";
import { Avatar, Disclosure, Skeleton, cn } from "@/components/ui";
import { COUNTRY_NAME, orderLine, placeLine, planLine, shortName } from "./examples";

/**
 * Three sample patients as one compact row of radio cards: arrow keys move between them, the choice is announced.
 * The selected patient's place and latest order sit on one line underneath (PersonaRecord), so the message box and
 * the Run button stay above the fold.
 */
export function PersonaPicker({
  personas,
  value,
  onChange,
}: {
  personas: Persona[];
  value: string;
  onChange: (id: string) => void;
}) {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-heading">Who is writing?</legend>
      <div className="grid grid-cols-3 gap-2">
        {personas.map(({ patient: p }) => {
          const checked = p.id === value;
          return (
            <label
              key={p.id}
              className={cn(
                "relative flex min-h-14 min-w-0 cursor-pointer items-center gap-2.5 rounded-control border px-2.5 py-2 sm:px-3 transition-[background-color,border-color,box-shadow] duration-150 ease-out-expo",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
                checked
                  ? "border-navy-900 bg-selected-bg shadow-[inset_0_0_0_1px_var(--color-navy-900)]"
                  : "border-line-cool bg-surface hover:border-navy-300 hover:bg-field active:bg-field-hover",
              )}
            >
              <input
                type="radio"
                name={name}
                value={p.id}
                checked={checked}
                onChange={() => onChange(p.id)}
                className="sr-only"
              />
              <Avatar name={`${p.firstName} ${p.lastName}`} size="sm" className="max-sm:hidden" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-heading">{shortName(p)}</span>
                <span className="block truncate text-xs text-muted">
                  <span className="sm:hidden">{p.country}</span>
                  <span className="max-sm:hidden">{COUNTRY_NAME[p.country]}</span>
                </span>
              </span>
              <span
                aria-hidden
                className={cn(
                  // Below sm the thicker selected border carries the choice, so the names get the room.
                  "inline-flex size-4 shrink-0 items-center justify-center rounded-pill border transition-colors duration-150 max-sm:hidden",
                  checked ? "border-navy-900 bg-navy-900 text-white" : "border-control-line bg-surface",
                )}
              >
                {checked && <Check size={10} strokeWidth={3} />}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Same boxes, lines and gaps as the loaded picker plus its record line, so nothing moves when the patients arrive. */
export function PersonaPickerSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-2">
      <div>
        <p className="mb-2 text-sm">
          <Skeleton className="inline-block h-4 w-32 align-middle" />
        </p>
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex min-h-14 items-center gap-2.5 rounded-control border border-line-cool px-2.5 py-2 sm:px-3">
              <Skeleton rounded="pill" className="size-6 shrink-0 max-sm:hidden" />
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <Skeleton className="inline-block h-3.5 w-4/5 align-middle" />
                </p>
                <p className="text-xs">
                  <Skeleton className="inline-block h-3 w-3/5 align-middle" />
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <RecordLayout
        line={
          <>
            <Skeleton className="inline-block h-3 w-4/5 align-middle" />
            <Skeleton className="inline-block h-3 w-2/5 align-middle sm:hidden" />
          </>
        }
        record={
          <p className="py-1 text-sm">
            <Skeleton className="inline-block h-3.5 w-44 align-middle" />
          </p>
        }
      />
    </div>
  );
}

/** One layout for the record line and its disclosure, shared by the real thing and the skeleton. */
function RecordLayout({ line, record }: { line: ReactNode; record: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted tnum">{line}</p>
      {record}
    </div>
  );
}

/** "Brunswick, Australia. Order DSP-1234 shipped Tue 16 Sep, due 19 Sep." */
export function personaLine(p: Patient): string {
  return `${placeLine(p)}. ${orderLine(p)}.`;
}

const GROUPS: { kind: SourceRef["kind"]; title: string }[] = [
  { kind: "plan", title: "Plan" },
  { kind: "order", title: "Orders" },
  { kind: "charge", title: "Charges" },
  { kind: "appointment", title: "Appointments" },
];

/** The selected patient's place and latest order, then what the drafter may cite, in the same words it is given. */
export function PersonaRecord({ persona }: { persona: Persona }) {
  const first = persona.patient.firstName;
  return (
    <RecordLayout
      line={personaLine(persona.patient)}
      record={
        <Disclosure summary={`What's in ${first}'s record`}>
          <div className="rounded-inner bg-inset p-3">
            <p className="text-sm font-medium text-heading tnum">{planLine(persona.patient)}</p>
            <p className="mt-1 text-xs text-muted">
              The AI can cite only these fictional records and the written support policy. {first}&apos;s name, email,
              phone and address are left out.
            </p>
            <dl className="mt-3 flex flex-col gap-3">
              {GROUPS.map(({ kind, title }) => {
                const items = persona.sources.filter((s) => s.kind === kind);
                if (items.length === 0) return null;
                return (
                  <div key={kind}>
                    <dt className="text-xs font-semibold text-heading">{title}</dt>
                    <dd className="mt-1">
                      <ul className="flex flex-col gap-0.5">
                        {items.map((s) => (
                          <li key={s.id} className="text-xs text-ink tnum">
                            {s.label.replace(/^Plan: /, "")}
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </Disclosure>
      }
    />
  );
}
