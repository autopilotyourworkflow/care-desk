"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  CirclePause,
  Code,
  FileCheck,
  Flag,
  Layers,
  Send,
  Server,
  ShieldCheck,
  Stethoscope,
  Terminal,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/shell";
import { Button, Card, Disclosure, Photo } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { DataDiagram, Figure, PipelineDiagram } from "./diagrams";
import { FailureTable } from "./FailureTable";
import { Markdown, type Block } from "./markdown";
import { OnThisPage, type TocItem } from "./OnThisPage";
import { RedactionExample } from "./RedactionExample";

/**
 * Public repo URL, set at build time with NEXT_PUBLIC_CODE_URL. Until a real https URL is configured, both
 * "Code on GitHub" links are left out rather than shown as dead links. Point it only at a clean public export of the
 * app: a fresh history that holds the app code and data only, with no planning notes in any commit.
 */
const CODE_HREF = (process.env.NEXT_PUBLIC_CODE_URL ?? "").trim();
const HAS_CODE_LINK = CODE_HREF.startsWith("https://");
const STACK_TITLE = HAS_CODE_LINK ? "Stack and code" : "Stack";

/** The reference parts, folded under "For the team running it". Each id is also its anchor. */
type Fold = "data" | "agent-guide" | "runbook" | "stack";
const FOLDS: Fold[] = ["data", "agent-guide", "runbook", "stack"];

/** Which fold holds an anchor: the fold itself, or a heading inside one of the two docs. */
function foldFor(id: string): Fold | undefined {
  if ((FOLDS as string[]).includes(id)) return id as Fold;
  if (id.startsWith("guide-")) return "agent-guide";
  if (id.startsWith("runbook-")) return "runbook";
  return undefined;
}

const TOC: TocItem[] = [
  { id: "in-short", label: "In short" },
  { id: "pipeline", label: "How a message moves" },
  { id: "never-sees", label: "What the AI never sees" },
  { id: "person-decides", label: "Where a person decides" },
  { id: "failures", label: "When something fails" },
  { id: "team", label: "For the team running it" },
  { id: "data", label: "Where data lives", sub: true },
  { id: "agent-guide", label: "Agent guide", sub: true },
  { id: "runbook", label: "Runbook", sub: true },
  { id: "stack", label: STACK_TITLE, sub: true },
];

export interface HowItWorksProps {
  agentGuide: Block[];
  runbook: Block[];
  models: { sort: string; draft: string };
  threshold: number;
}

function Section({
  id,
  title,
  description,
  children,
  className,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-2", className)}>
      <div className="mb-5">
        <h2 id={`${id}-title`} className="text-balance text-xl font-semibold text-heading">
          {title}
        </h2>
        {description && <p className="mt-1.5 max-w-[65ch] text-base text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

const PRINCIPLES: { icon: LucideIcon; text: string }[] = [
  { icon: ShieldCheck, text: "Safety rules run before any AI" },
  { icon: UserCheck, text: "A person sends every reply" },
  { icon: FileCheck, text: "Every fact traced to a source" },
];

export function HowItWorks({ agentGuide, runbook, models, threshold }: HowItWorksProps) {
  const [open, setOpen] = useState<Record<Fold, boolean>>({ data: false, "agent-guide": false, runbook: false, stack: false });
  const setFold = (fold: Fold, next: boolean) => setOpen((o) => ({ ...o, [fold]: next }));

  /** Opens the fold that holds an anchor, then scrolls to it once the fold has grown. */
  const reveal = useCallback((id: string) => {
    const fold = foldFor(id);
    if (!fold) return;
    setOpen((o) => (o[fold] ? o : { ...o, [fold]: true }));
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 320);
  }, []);

  // A link from elsewhere (or the back button) can point inside a fold: open it.
  useEffect(() => {
    const onHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id) reveal(id);
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [reveal]);

  return (
    <>
      <PageHeader
        title="How it works"
        description="What happens to a message, what the AI never sees, and where a person decides."
        actions={
          HAS_CODE_LINK ? (
            <Button href={CODE_HREF} variant="secondary" leadingIcon={Code}>
              Code on GitHub
            </Button>
          ) : undefined
        }
      />

      <div className="xl:grid xl:grid-cols-[208px_minmax(0,1fr)] xl:gap-12">
        <aside className="hidden xl:block">
          <OnThisPage items={TOC} variant="rail" onNavigate={reveal} />
        </aside>

        <div className="min-w-0 max-w-[1000px] space-y-16 sm:space-y-20">
          <OnThisPage items={TOC} variant="pills" onNavigate={reveal} />

          <InShort />

          <Section
            id="pipeline"
            title="How a message moves"
            description="Seven checks, always in this order, on the demo messages and in Try it."
          >
            <Card padding="lg">
              <Figure
                caption={
                  <>
                    Steps marked <strong className="font-semibold text-heading">Code, no AI</strong> are plain rules. A
                    draft needs the rules and the sorter to agree a message is routine, and an agent can still escalate
                    any draft.
                  </>
                }
              >
                <PipelineDiagram />
              </Figure>
            </Card>
          </Section>

          <Section
            id="never-sees"
            title="What the AI never sees"
            description="Names, contact details, addresses, dates of birth and health numbers are swapped for placeholders in code, before any AI step. Three fictional messages, before and after:"
          >
            <Card padding="lg">
              <RedactionExample />
            </Card>
            <ul className="mt-6 grid gap-x-8 gap-y-3 text-sm text-ink sm:text-base lg:grid-cols-3">
              <Point>The drafter gets the patient&apos;s records as numbered sources, with no name or contact details.</Point>
              <Point>
                Email drafts open with <Token>Hi [FIRST_NAME],</Token> and sign off with <Token>[AGENT_NAME]</Token>. Chat
                drafts skip the greeting and sign off only in the first reply of a chat. The desk fills in the names, so
                the AI never sees or invents one.
              </Point>
              <Point>Nothing typed into Try it is stored, and there is no database of patient data.</Point>
            </ul>
          </Section>

          <Section
            id="person-decides"
            title="Where a person decides"
            description="Care Desk acts on its own only to protect a patient: it holds orders and withdraws drafts. It never sends anything."
          >
            <PersonDecides />
          </Section>

          <Section
            id="failures"
            title="When something fails"
            description="Every failure lands on a person, never on the patient."
          >
            <FailureTable threshold={threshold} />
          </Section>

          <Section
            id="team"
            title="For the team running it"
            description="The data flow, the agent guide, the runbook and the stack. Open what you need."
          >
            <Card padding="none" className="px-5 pb-2 sm:px-8">
              <FoldRow
                id="data"
                icon={Server}
                title="Where data lives"
                hint="One static site and one Worker, with no database of patient data"
                open={open.data}
                onOpenChange={(v) => setFold("data", v)}
              >
                <Figure caption="Everything in the demo is fictional. A visitor's sends, edits and escalations stay in their own browser, and Help resets them.">
                  <DataDiagram />
                </Figure>
              </FoldRow>
              <FoldRow
                id="agent-guide"
                icon={BookOpen}
                title="Agent guide"
                hint="The habits and shortcuts for agents on the desk"
                source="docs/AGENT-GUIDE.md"
                open={open["agent-guide"]}
                onOpenChange={(v) => setFold("agent-guide", v)}
              >
                <Markdown blocks={agentGuide} idPrefix="guide" />
              </FoldRow>
              <FoldRow
                id="runbook"
                icon={Terminal}
                title="Runbook"
                hint="Limits, private links, the API key, spend and pausing the live box"
                source="docs/RUNBOOK.md"
                open={open.runbook}
                onOpenChange={(v) => setFold("runbook", v)}
              >
                <Markdown blocks={runbook} idPrefix="runbook" />
              </FoldRow>
              <FoldRow
                id="stack"
                icon={Layers}
                title={STACK_TITLE}
                hint="What Care Desk is built with"
                open={open.stack}
                onOpenChange={(v) => setFold("stack", v)}
                last
              >
                <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
                  <p className="max-w-[68ch] text-base text-ink">
                    Next.js 16, React 19 and TypeScript, styled with Tailwind CSS, served as a static site by one
                    Cloudflare Worker, with the Claude API ({models.sort} to sort, {models.draft} to draft) and Vitest
                    for the tests.
                  </p>
                  {HAS_CODE_LINK && (
                    <Button href={CODE_HREF} variant="primary" leadingIcon={Code}>
                      Code on GitHub
                    </Button>
                  )}
                </div>
              </FoldRow>
            </Card>
          </Section>
        </div>
      </div>
    </>
  );
}

/** The answer first: three short paragraphs and the three principles, beside a calm eucalyptus photo. */
function InShort() {
  return (
    <section
      id="in-short"
      aria-labelledby="in-short-title"
      className="scroll-mt-2 overflow-hidden rounded-card bg-surface shadow-card ring-1 ring-line/70"
    >
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,0.72fr)]">
        <div className="p-6 sm:p-8 lg:py-10 lg:pl-10 lg:pr-6">
          <h2 id="in-short-title" className="text-xl font-semibold text-heading">
            In short
          </h2>
          <p className="mt-3 max-w-[40ch] text-pretty text-lg font-medium text-heading sm:text-xl">
            Care Desk drafts replies to routine patient messages. A person sends every one.
          </p>
          <div className="mt-4 max-w-[62ch] space-y-3 text-base text-ink">
            <p>
              Before any AI step, personal details are removed and plain safety rules read the message. Anything
              clinical, a crisis or a death stops there: no AI reply, the orders go on hold, and a clinician takes it.
            </p>
            <p>
              Routine drafts use only the patient&apos;s records and the support policy. Every date, amount and order
              number is checked before an agent sees it.
            </p>
          </div>
          <ul className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:gap-x-6" aria-label="Design principles">
            {PRINCIPLES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-2 text-sm font-medium text-heading">
                <Icon aria-hidden size={18} className="shrink-0 text-success-icon" />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative h-36 sm:h-48 lg:h-auto">
          <Photo name="leaves-light" alt="" sizes="(min-width: 1024px) 420px, 100vw" priority className="absolute inset-0" />
          {/* Blends the photo into the white panel so the edge reads as light, not as a frame. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-linear-to-b from-surface via-surface/0 via-30% lg:bg-linear-to-r"
          />
        </div>
      </div>
    </section>
  );
}

function PersonDecides() {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <PhotoCard photo="agent" photoPosition="object-[center_28%]">
        <Decision
          icon={Send}
          iconClass="bg-navy-50 text-navy-900"
          title="Every reply that is sent"
          note="On the desk: Send, or Ctrl+Enter"
        >
          A draft waits for an agent, who can send, edit or escalate it. Undo is there straight after sending.
        </Decision>
        <Decision
          icon={Flag}
          iconClass="bg-clinician-bg text-clinician-fg"
          title="Any draft, escalated by hand"
          className="mt-5 border-t border-line-cool pt-5"
        >
          If anything feels clinical, the agent escalates it to a clinician with a note, instead of sending.
        </Decision>
        <Button href="/desk/" variant="ghost" size="sm" trailingIcon={ArrowRight} className="-ml-3 mt-auto self-start pt-4">
          Open the desk
        </Button>
      </PhotoCard>

      <PhotoCard photo="clinician" photoPosition="object-[center_40%]">
        <Decision icon={Stethoscope} iconClass="bg-clinician-bg text-clinician-fg" title="Every clinical item">
          Clinical questions, side effects, crisis language and reports of a death never get an AI reply. A clinician
          sees why it was escalated and replies personally.
        </Decision>
        <Decision
          icon={CirclePause}
          iconClass="bg-hold-bg text-hold-icon"
          title="Every hold release"
          className="mt-5 border-t border-line-cool pt-5"
        >
          A safety stop holds the patient&apos;s orders at once. Only a clinician can resume them, with a written note.
        </Decision>
        <Button href="/clinician/" variant="ghost" size="sm" trailingIcon={ArrowRight} className="-ml-3 mt-auto self-start pt-4">
          Open the clinician queue
        </Button>
      </PhotoCard>
    </div>
  );
}

function PhotoCard({
  photo,
  photoPosition,
  children,
}: {
  photo: "agent" | "clinician";
  photoPosition: string;
  children: ReactNode;
}) {
  return (
    <Card padding="none" className="flex flex-col overflow-hidden">
      <div className="relative aspect-[16/9] bg-inset">
        <Photo
          name={photo}
          sizes="(min-width: 1280px) 480px, (min-width: 768px) 46vw, 100vw"
          className={cn("absolute inset-0", photoPosition)}
        />
      </div>
      <div className="flex flex-1 flex-col p-5 sm:p-6">{children}</div>
    </Card>
  );
}

function Decision({
  icon: Icon,
  iconClass,
  title,
  note,
  children,
  className,
}: {
  icon: LucideIcon;
  iconClass: string;
  title: string;
  note?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-4", className)}>
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-control", iconClass)}>
        <Icon aria-hidden size={18} />
      </span>
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-heading">{title}</h3>
        <p className="mt-1 text-base text-ink">{children}</p>
        {note && <p className="mt-1.5 text-sm text-muted">{note}</p>}
      </div>
    </div>
  );
}

function FoldRow({
  id,
  icon: Icon,
  title,
  hint,
  source,
  open,
  onOpenChange,
  last,
  children,
}: {
  id: Fold;
  icon: LucideIcon;
  title: string;
  hint: string;
  source?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-2">
      <Disclosure
        variant="row"
        open={open}
        onOpenChange={onOpenChange}
        className={cn("[&>button]:py-4", last && "[&>button]:border-b-0")}
        summary={
          <span className="flex min-w-0 items-start gap-3.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-field text-navy-900">
              <Icon aria-hidden size={18} />
            </span>
            <span className="flex min-w-0 flex-col items-start">
              <span className="text-base font-semibold text-heading">{title}</span>
              <span className="text-sm font-normal text-muted">{hint}</span>
            </span>
          </span>
        }
      >
        {/* relative: keeps absolutely placed bits (sr-only status lines) inside the clipped fold. */}
        <div className="relative pb-6 pt-2">
          {source && <p className="mb-4 font-mono text-xs text-muted">{source}</p>}
          {children}
        </div>
      </Disclosure>
    </div>
  );
}

function Point({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-pill bg-navy-900 sm:mt-2.5" />
      <span className="max-w-[60ch]">{children}</span>
    </li>
  );
}

function Token({ children }: { children: ReactNode }) {
  return <code className="rounded-md bg-field px-1.5 font-mono text-[0.8125em]">{children}</code>;
}
