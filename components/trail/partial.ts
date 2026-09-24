import type { PipelineResult, TrailStep } from "@/lib/types";
import { STEP_ORDER } from "./reveal";

const PENDING_TITLES: Record<TrailStep["id"], string> = {
  redact: "Personal details removed",
  rules: "Safety rules",
  sort: "Sorted by type",
  sources: "Sources found",
  draft: "Reply drafted",
  check: "Facts checked",
  decide: "A person decides",
};

/** Seven pending steps: the starting state of a live run. */
export function pendingTrail(): TrailStep[] {
  return STEP_ORDER.map((id) => ({ id, status: "pending", title: PENDING_TITLES[id], summary: "" }));
}

/**
 * A PipelineResult to render while a live run streams step events. Merge each received step in order; pass
 * running={true} to <Trail> so the next pending step shows as working. When the "done" event arrives, render the
 * final result instead.
 */
export function partialResult(messageId: string, received: TrailStep[]): PipelineResult {
  const trail = pendingTrail().map((p) => received.find((s) => s.id === p.id) ?? p);
  return {
    messageId,
    redactedText: "",
    redactions: [],
    rules: { matched: false, hits: [] },
    route: "person",
    holdOrders: false,
    trail,
    models: {},
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    versions: { rules: "", prompts: "" },
    mode: "live",
  };
}
