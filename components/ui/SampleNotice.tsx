"use client";

import { FlaskConical } from "lucide-react";
import { cn } from "./cn";
import type { Side } from "./floating";
import { Tooltip } from "./Tooltip";

/**
 * The one plain name for a run without Claude ("sample run") and its definition, said once per page behind the
 * "Sample results" chip. Other lines that need to name the stand-in use SAMPLE_STAND_IN, so it reads the same
 * everywhere.
 */
export const SAMPLE_STAND_IN = "a simple built-in stand-in for Claude";
export const SAMPLE_RUN_TEXT =
  "Sample run: Claude was not used here. A simple built-in stand-in did the sorting and the drafting, so those parts are only samples. The safety rules and the fact check are the real ones.";

export interface SampleNoticeProps {
  /** The one honest sentence: what is a sample and what is real. Shown on press, hover, and read out when opened. */
  text: string;
  /** Chip label. Default "Sample results". */
  label?: string;
  side?: Side;
  className?: string;
}

/**
 * The "Sample results" chip, the same on every screen. A toggletip: tap, click, Enter or Space shows the sentence and
 * keeps it open until the next press, Escape or a press elsewhere, so it can be read on a phone. The sentence is not
 * repeated in hidden text, so a screen reader hears it once, when it opens.
 */
export function SampleNotice({ text, label = "Sample results", side = "bottom", className }: SampleNoticeProps) {
  return (
    <Tooltip content={text} side={side} toggle>
      <button
        type="button"
        className={cn(
          "inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-pill bg-warning-bg px-2.5 text-xs font-semibold text-warning-fg",
          "transition-[filter,transform] duration-150 hover:brightness-95 active:scale-[0.97] active:brightness-90 aria-expanded:brightness-95",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
      >
        <FlaskConical aria-hidden size={12} className="shrink-0" />
        {label}
      </button>
    </Tooltip>
  );
}
