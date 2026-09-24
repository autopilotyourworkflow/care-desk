import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { AppShell } from "@/components/shell";
import { HowItWorks } from "@/components/how/HowItWorks";
import { parseMarkdown } from "@/components/how/markdown";
import { MODEL_CONFIG } from "@/lib/pipeline/llm";
import { DEFAULT_CONFIDENCE_THRESHOLD } from "@/lib/pipeline/run";
import { modelLabel } from "@/lib/format";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "How Care Desk works: the pipeline, where data lives, what the AI never sees, where a person decides, what happens when something fails, the agent guide and the runbook.",
};

/** The docs are read from docs/*.md when the static site is built, so the page always matches the files in the repo. */
function readDoc(name: string): string {
  return readFileSync(join(process.cwd(), "docs", name), "utf8");
}

export default function HowItWorksPage() {
  const agentGuide = parseMarkdown(readDoc("AGENT-GUIDE.md"));
  const runbook = parseMarkdown(readDoc("RUNBOOK.md"));
  return (
    <AppShell>
      <HowItWorks
        agentGuide={agentGuide}
        runbook={runbook}
        models={{ sort: modelLabel(MODEL_CONFIG.sortModel), draft: modelLabel(MODEL_CONFIG.draftModel) }}
        threshold={DEFAULT_CONFIDENCE_THRESHOLD}
      />
    </AppShell>
  );
}
