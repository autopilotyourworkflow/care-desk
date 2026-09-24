"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button, Card, CardHeader, Disclosure, Field, TextInput } from "@/components/ui";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import {
  ASSUMPTION_SPECS,
  parseAssumption,
  roundEstimate,
  sameAssumptions,
  type AssumptionKey,
  type AssumptionSpec,
  type Assumptions,
  type Estimate,
} from "./model";

/** Shown open: the weekly volume and the cost of an hour. The minutes per task fold under "More assumptions". */
const FIRST_FIELDS: AssumptionKey[] = ["weeklyMessages", "hourlyCostAud"];

function asText(n: number): string {
  return String(n);
}

function rangeText(spec: AssumptionSpec): string {
  return `Enter a number from ${formatNumber(spec.min)} to ${formatNumber(spec.max)}.`;
}

/** One number box with its unit inside the field. Keeps what was typed while it is not a valid number. */
function NumberField({
  spec,
  value,
  onValid,
}: {
  spec: AssumptionSpec;
  value: number;
  onValid: (key: AssumptionKey, n: number) => void;
}) {
  // The parent remounts this field (a new key) when the values change from outside: a reset or a restore.
  const [raw, setRaw] = useState(() => asText(value));
  const [dirty, setDirty] = useState(false);
  const parsed = parseAssumption(spec, raw);
  const error = dirty && parsed === undefined ? rangeText(spec) : undefined;
  const unitText = spec.unit === "AUD" ? "A$" : spec.unit;
  return (
    <Field label={spec.label} error={error}>
      <span className="relative block">
        {spec.unit === "AUD" && (
          <span aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted">
            {unitText}
          </span>
        )}
        <TextInput
          inputMode="decimal"
          autoComplete="off"
          value={raw}
          onChange={(e) => {
            const next = e.target.value;
            setRaw(next);
            setDirty(true);
            const n = parseAssumption(spec, next);
            if (n !== undefined) onValid(spec.key, n);
          }}
          onBlur={() => {
            if (parseAssumption(spec, raw) !== undefined) setDirty(false);
          }}
          className={spec.unit === "AUD" ? "pl-10 tnum" : "pr-24 tnum"}
        />
        {spec.unit !== "AUD" && (
          <span aria-hidden className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted">
            {unitText}
          </span>
        )}
      </span>
    </Field>
  );
}

export function AssumptionsPanel({
  values,
  defaults,
  onChange,
  onReset,
  est,
  version,
  className,
}: {
  values: Assumptions;
  defaults: Assumptions;
  onChange: (key: AssumptionKey, n: number) => void;
  onReset: () => void;
  est: Estimate;
  /** Bumped when the values change from outside (reset, restore), so the fields start again from them. */
  version: number;
  className?: string;
}) {
  const atDefaults = sameAssumptions(values, defaults);
  const hoursNum = roundEstimate(est.hoursSaved);
  const hours = formatNumber(hoursNum);
  const cost = formatMoney(Math.round(est.costSavedAud / 10) * 10, "AUD", { explicit: true, decimals: 0 });
  const yearly = formatMoney(Math.round((est.costSavedAud * 52) / 100) * 100, "AUD", { explicit: true, decimals: 0 });
  const savedPer = values.minutesPerManualReply - values.minutesPerReview;

  return (
    <Card as="section" aria-labelledby="assumptions-title" data-tour="insights-assumptions" className={className}>
      <CardHeader
        title={<span id="assumptions-title">Your numbers</span>}
        description="Put in your own. The whole page updates."
        actions={
          <Button variant="ghost" size="sm" leadingIcon={RotateCcw} onClick={onReset} disabled={atDefaults}>
            Reset
          </Button>
        }
      />

      <div aria-live="polite" className="rounded-inner bg-field px-4 py-3.5">
        <p className="text-xs font-medium text-ink">Estimated saving each week</p>
        {est.noSaving ? (
          <p className="mt-1 text-sm font-medium text-heading">
            At these numbers a review takes as long as writing the reply, so no time is saved.
          </p>
        ) : (
          <dl className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <div>
              <dt className="sr-only">Agent time</dt>
              <dd className="text-2xl font-semibold text-heading tnum">
                {hours} <span className="text-sm font-medium text-ink">{hoursNum === 1 ? "hour" : "hours"}</span>
              </dd>
            </div>
            <div>
              <dt className="sr-only">Cost</dt>
              <dd className="text-2xl font-semibold text-heading tnum">{cost}</dd>
            </div>
          </dl>
        )}
        {!est.noSaving && <p className="mt-1 text-xs text-ink">About {yearly} a year. An estimate, not a measured result.</p>}
      </div>

      {/* The two numbers a business knows first; the timings behind the estimate fold one click away. */}
      <div className="mt-5 flex flex-col gap-4">
        {ASSUMPTION_SPECS.filter((spec) => FIRST_FIELDS.includes(spec.key)).map((spec) => (
          <NumberField key={`${spec.key}-${version}`} spec={spec} value={values[spec.key]} onValid={onChange} />
        ))}
      </div>
      <Disclosure summary="More assumptions" className="mt-4">
        <div className="flex flex-col gap-4 pb-1">
          {ASSUMPTION_SPECS.filter((spec) => !FIRST_FIELDS.includes(spec.key)).map((spec) => (
            <NumberField key={`${spec.key}-${version}`} spec={spec} value={values[spec.key]} onValid={onChange} />
          ))}
        </div>
      </Disclosure>

      <Disclosure summary="How the saving is worked out" className="mt-1">
        <div className="flex flex-col gap-2 text-sm text-ink">
          <p>Hours saved = messages a week × share with a ready draft × minutes saved per reply ÷ 60.</p>
          {est.noSaving ? (
            <p className="text-muted">
              A review ({formatNumber(values.minutesPerReview)} min) takes at least as long as a reply by hand (
              {formatNumber(values.minutesPerManualReply)} min), so nothing is saved.
            </p>
          ) : (
            <p className="text-muted tnum">
              {formatNumber(values.weeklyMessages)} × {formatPercent(est.readyShare)} × {formatNumber(savedPer)} min ÷ 60 ={" "}
              {hours} h
            </p>
          )}
          <p>Cost saved = hours saved × cost per hour.</p>
          <p>
            Only ready drafts count. Replies written by hand save nothing, and safety messages go to a clinician. The share
            with a ready draft comes from the fictional demo queue.
          </p>
          <dl className="mt-1 flex flex-col gap-1.5 border-t border-line-cool pt-3">
            {ASSUMPTION_SPECS.map((spec) => (
              <div key={spec.key}>
                <dt className="font-medium text-heading">{spec.label}</dt>
                <dd className="text-muted">{spec.hint}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Disclosure>
    </Card>
  );
}
