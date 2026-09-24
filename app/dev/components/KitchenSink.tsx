"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Inbox,
  Pencil,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Stethoscope,
  UserRound,
} from "lucide-react";
import { AppShell, PageHeader, useShell } from "@/components/shell";
import {
  Button,
  Card,
  CardHeader,
  Chip,
  Disclosure,
  EmptyState,
  Field,
  HoldBadge,
  IconButton,
  Inset,
  Kbd,
  KeyCombo,
  Menu,
  Notice,
  RiskBadge,
  SegmentedControl,
  Select,
  Skeleton,
  SkeletonText,
  TabPanel,
  Tabs,
  TextArea,
  TextInput,
  Tooltip,
  useToast,
} from "@/components/ui";
import { partialResult, Trail, TrailMini, TrailMiniLoop } from "@/components/trail";
import { SAMPLE_CASES, sampleCase } from "@/lib/fixtures/sample-results";
import { formatDate, formatMoney, formatNumber, relativeTime, waitingTime, COUNTRY_LABEL } from "@/lib/format";
import staffData from "@/data/staff.json";
import type { Category } from "@/lib/types";

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="scroll-mt-2">
      <div className="mb-4">
        <h2 id={id} className="text-lg font-semibold text-heading">
          {title}
        </h2>
        {description && <p className="mt-0.5 max-w-[70ch] text-sm text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}


const SWATCHES: { name: string; value: string; note: string; text?: string }[] = [
  { name: "navy-900", value: "#010337", note: "Brand navy. Text on it: white 19.6", text: "#ffffff" },
  { name: "navy-950", value: "#060a20", note: "Deep navy", text: "#ffffff" },
  { name: "navy-app", value: "#0a182a", note: "App navy. White 17.8", text: "#ffffff" },
  { name: "canvas", value: "#f8f5f0", note: "Page. Ink 13.5, muted 5.2" },
  { name: "surface", value: "#ffffff", note: "Cards. Ink 14.6, muted 5.7" },
  { name: "panel", value: "#f1ece4", note: "Rails. Ink 12.4, muted 4.8" },
  { name: "field", value: "#eff3f9", note: "Inputs. Ink 13.1, muted 5.1" },
  { name: "success", value: "#d7f2e0", note: "Text #05693f 5.7", text: "#05693f" },
  { name: "info", value: "#dcefff", note: "Text #1b6893 5.2", text: "#1b6893" },
  { name: "clinician", value: "#e0e4fc", note: "Text #3a47b8 6.0", text: "#3a47b8" },
  { name: "urgent", value: "#ffdede", note: "Text #9e1119 6.6", text: "#9e1119" },
  { name: "hold", value: "#fdecd0", note: "Text #7d4400 6.7", text: "#7d4400" },
  { name: "warning", value: "#fff3c4", note: "Text #7a5a00 5.7", text: "#7a5a00" },
  { name: "error", value: "#fff0f0", note: "Text #b42318 5.9", text: "#b42318" },
];

const CATEGORIES: Category[] = [
  "order_status",
  "delivery_problem",
  "billing",
  "plan_change",
  "wants_human",
  "clinical_question",
  "side_effect",
  "adverse_event",
  "crisis",
  "bereavement",
];

function ShellActions() {
  const { openShortcuts, replayTour } = useShell();
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" onClick={openShortcuts} shortcut={<Kbd>?</Kbd>}>
        Keyboard shortcuts
      </Button>
      <Button variant="ghost" size="sm" onClick={replayTour}>
        Replay the tour
      </Button>
    </div>
  );
}

function ToastDemo() {
  const { toast } = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        leadingIcon={Send}
        onClick={() =>
          toast({
            message: "Sent. Next message opened.",
            detail: "Reply to Priya R., order status",
            tone: "success",
            onUndo: () => toast({ message: "Send undone. The draft is back in your queue." }),
          })
        }
      >
        Send (shows toast with Undo)
      </Button>
      <Button variant="secondary" onClick={() => toast({ message: "Couldn't reach the AI. Showing saved examples.", tone: "error" })}>
        Error toast
      </Button>
    </div>
  );
}

const QUEUE_TABS = [
  { id: "person", label: "Write the reply", count: 7 },
  { id: "ready", label: "Ready to send", count: 18 },
  { id: "waiting", label: "Waiting", count: 4 },
  { id: "all", label: "All", count: 29 },
] as const;

const PANEL_COPY: Record<(typeof QUEUE_TABS)[number]["id"], string> = {
  person: "Showing messages that need a person.",
  ready: "Showing checked drafts that are ready to send.",
  waiting: "Showing messages waiting on the patient.",
  all: "Showing the whole queue.",
};

/** The signed-in agent in the demo world, used to fill a draft's sign-off. */
const AGENT_NAME = (staffData as { name: string; role: string }[]).find((s) => s.role === "agent")?.name;

const MESSAGE_LIMIT = 1000;

export function KitchenSink() {
  const [tab, setTab] = useState<"all" | "person" | "ready" | "waiting">("person");
  const [message, setMessage] = useState("Hi, my order hasn't turned up yet and the tracking hasn't moved since Monday.");
  const [seg, setSeg] = useState<"all" | "tricky" | "failures">("all");
  const [replay, setReplay] = useState(0);
  const [liveSteps, setLiveSteps] = useState(3);
  const routine = sampleCase("routine");
  const blocked = sampleCase("blocked");
  const clinical = sampleCase("clinical");
  const urgent = sampleCase("urgent");

  const live = useMemo(
    () => partialResult("MSG-LIVE", routine.result.trail.slice(0, liveSteps).filter((s) => s.id !== "decide")),
    [routine.result.trail, liveSteps],
  );

  const deskActions = (
    <>
      <Button leadingIcon={Send} shortcut={<KeyCombo keys={["Ctrl", "Enter"]} tone="onDark" />}>
        Send
      </Button>
      <Button variant="secondary" leadingIcon={Pencil} shortcut={<Kbd>E</Kbd>}>
        Edit
      </Button>
      <Button variant="ghost" leadingIcon={Stethoscope} shortcut={<Kbd>X</Kbd>}>
        Escalate
      </Button>
    </>
  );

  return (
    <AppShell>
      <PageHeader
        title="Components"
        description="Every component, state and trail variant, for design review. Built on the Care Desk design tokens. Not linked from the navigation, and left out of production builds."
        meta={
          <>
            <Chip tone="info">Design review</Chip>
            <Chip tone="outline">Fictional data</Chip>
          </>
        }
        actions={<ShellActions />}
      />

      <div className="flex flex-col gap-12">
        {/* ---------------- Tokens ---------------- */}
        <Section id="tokens" title="Colour tokens" description="Every text pair meets WCAG AA (4.5:1 or more). Ratios are listed in app/globals.css.">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {SWATCHES.map((s) => (
              <li key={s.name} className="overflow-hidden rounded-control bg-surface ring-1 ring-line/70">
                <div className="flex h-16 items-end p-2 text-xs font-semibold" style={{ background: s.value, color: s.text ?? "#25292e" }}>
                  Aa
                </div>
                <div className="p-2.5">
                  <p className="text-xs font-semibold text-heading">{s.name}</p>
                  <p className="font-mono text-2xs text-muted">{s.value}</p>
                  <p className="mt-0.5 text-2xs text-muted">{s.note}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        {/* ---------------- Type ---------------- */}
        <Section id="type" title="Type" description="Poppins for all UI. Clash Display for page titles and the wordmark only. Fixed rem scale, ratio about 1.2.">
          <Card>
            <div className="flex flex-col gap-3">
              <p className="display-title text-4xl text-navy-900">Clash Display 40, page titles</p>
              <p className="display-title text-3xl text-navy-900">Clash Display 33, page titles</p>
              <p className="text-2xl font-semibold text-heading">Poppins 28 semibold</p>
              <p className="text-xl font-semibold text-heading">Poppins 23 semibold</p>
              <p className="text-lg font-semibold text-heading">Poppins 19 semibold, card titles</p>
              <p className="text-base text-ink">Poppins 16 regular, reading text for longer explanations and message bodies.</p>
              <p className="text-sm text-ink">Poppins 14 regular, the default UI size for rows, labels and controls.</p>
              <p className="text-xs text-muted">Poppins 12, secondary text and meta</p>
              <p className="text-sm text-ink tnum">
                Tabular figures: {formatMoney(129, "NZD", { explicit: true })}, {formatMoney(-20, "AUD")}, {formatMoney(99, "GBP")},
                CD4829103756, 12:08 pm
              </p>
            </div>
          </Card>
        </Section>

        {/* ---------------- Buttons ---------------- */}
        <Section id="buttons" title="Buttons" description="Solid navy for the one main action. 16px radius. Hover, focus-visible (Tab to see), active, disabled and loading.">
          <Card>
            <div className="flex flex-col gap-6">
              {(["primary", "secondary", "subtle", "ghost", "destructive"] as const).map((v) => (
                <div key={v} className="flex flex-wrap items-center gap-3">
                  <span className="w-24 text-xs font-medium text-muted capitalize">{v}</span>
                  <Button variant={v} leadingIcon={v === "destructive" ? RotateCcw : Send}>
                    {v === "destructive" ? "Discard draft" : "Send reply"}
                  </Button>
                  <Button variant={v} disabled>
                    Disabled
                  </Button>
                  <Button variant={v} loading loadingLabel="Sending">
                    Sending
                  </Button>
                  <Button variant={v} size="sm">
                    Small
                  </Button>
                  <Button variant={v} size="lg">
                    Large
                  </Button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-3">
                <span className="w-24 text-xs font-medium text-muted">Icon</span>
                <IconButton icon={Search} label="Search messages" />
                <IconButton icon={Settings} label="Settings" variant="subtle" />
                <IconButton icon={UserRound} label="Assign to me" variant="secondary" />
                <IconButton icon={Inbox} label="Show waiting" pressed />
                <IconButton icon={Send} label="Send" variant="primary" loading />
                <IconButton icon={Pencil} label="Edit" disabled />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="w-24 text-xs font-medium text-muted">As link</span>
                <Button href="/desk/" trailingIcon={ArrowUpRight} variant="secondary">
                  Open the desk
                </Button>
              </div>
            </div>
          </Card>
          <div className="mt-4 rounded-card bg-navy-900 p-6" data-surface="navy">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="onNavy" size="lg">
                Start the 1-minute tour
              </Button>
              <Button variant="onNavyGhost" size="lg">
                Open the desk
              </Button>
              <Button variant="onNavy" size="lg" disabled>
                Disabled
              </Button>
            </div>
          </div>
        </Section>

        {/* ---------------- Tags ---------------- */}
        <Section id="tags" title="Chips and badges" description="Category chips in plain words. Risk is always icon plus text, never colour alone.">
          <Card>
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <Chip key={c} category={c} />
                ))}
                <Chip category="stop_sending" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <RiskBadge kind="ready" />
                <RiskBadge kind="person" />
                <RiskBadge kind="clinician" />
                <RiskBadge kind="urgent" />
                <HoldBadge />
                <HoldBadge count={2} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <RiskBadge route="draft" size="md" />
                <RiskBadge route="person" size="md" />
                <RiskBadge route="clinician" size="md" />
                <RiskBadge route="urgent" size="md" />
                <HoldBadge size="md" />
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-ink">
                <span>Keys:</span>
                <Kbd>J</Kbd>
                <Kbd>K</Kbd>
                <KeyCombo keys={["Ctrl", "Enter"]} />
                <Kbd>?</Kbd>
              </div>
            </div>
          </Card>
        </Section>

        {/* ---------------- Forms ---------------- */}
        <Section id="forms" title="Fields" description="16px controls on the input fill, as in their patient app. Hint, error, disabled and read-only states.">
          <Card>
            <div className="grid gap-6 md:grid-cols-2">
              <Field label="Search the queue" hint="Name, order number or words in the message">
                <TextInput placeholder="e.g. ORD-20004" />
              </Field>
              <Field label="Resume note" required error="Add a note before resuming orders, so the next person knows why.">
                <TextInput defaultValue="" placeholder="Why is it safe to resume?" />
              </Field>
              <Field
                label="Your message"
                hint="Don't enter real personal details. Nothing you type is stored."
                aside={`${formatNumber(message.length)} / ${formatNumber(MESSAGE_LIMIT)}`}
                className="md:col-span-2"
              >
                <TextArea rows={3} maxLength={MESSAGE_LIMIT} value={message} onChange={(e) => setMessage(e.target.value)} />
              </Field>
              <Field label="Sample patient">
                <Select defaultValue="PT-1001">
                  <option value="PT-1001">Priya, Australia</option>
                  <option value="PT-1031">Aroha, New Zealand</option>
                  <option value="PT-1043">Grace, United Kingdom</option>
                </Select>
              </Field>
              <Field label="Disabled field" hint="Locked while a clinician reviews">
                <TextInput disabled defaultValue="Orders on hold" />
              </Field>
            </div>
          </Card>
        </Section>

        {/* ---------------- Navigation controls ---------------- */}
        <Section id="nav" title="Tabs, segmented control, menu, tooltip, disclosure">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Queue tabs" description="Arrow keys move between tabs." />
              <Tabs
                id="demo-queue"
                label="Queue"
                value={tab}
                onChange={setTab}
                items={[...QUEUE_TABS]}
              />
              {QUEUE_TABS.map(({ id }) => (
                <TabPanel key={id} tabsId="demo-queue" id={id} value={tab} className="pt-4">
                  <p className="text-sm text-ink">{PANEL_COPY[id]}</p>
                </TabPanel>
              ))}
            </Card>
            <Card>
              <CardHeader title="Segmented control" description="A radio group for filters." />
              <SegmentedControl
                label="Show test cases"
                value={seg}
                onChange={setSeg}
                items={[
                  { id: "all", label: "All", count: 180 },
                  { id: "tricky", label: "Tricky", count: 30 },
                  { id: "failures", label: "Failures", count: 0 },
                ]}
              />
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <SegmentedControl
                  label="Size"
                  size="sm"
                  value="sm"
                  onChange={() => {}}
                  items={[
                    { id: "sm", label: "Small" },
                    { id: "off", label: "Disabled", disabled: true },
                  ]}
                />
                <Menu
                  label="Assign"
                  items={[
                    { id: "me", label: "Assign to me", icon: UserRound },
                    { id: "clin", label: "Send to a clinician", icon: Stethoscope, description: "Puts orders on hold" },
                    { type: "separator", id: "s" },
                    { id: "x", label: "Mark as spam", disabled: true },
                  ]}
                  trigger={({ open, ...p }) => (
                    <Button {...p} variant="secondary" size="sm" aria-expanded={open}>
                      Menu
                    </Button>
                  )}
                />
                <Tooltip content="Median time to a first human reply">
                  <button type="button" className="rounded-inner px-1 text-sm font-medium text-heading underline decoration-dotted underline-offset-4">
                    Hover or focus for a tooltip
                  </button>
                </Tooltip>
              </div>
              <div className="mt-5">
                <Disclosure summary="See what the AI saw" icon={ShieldAlert}>
                  <Inset>
                    <p>Hi, just checking on my order. Has it shipped yet? Thanks, [NAME]</p>
                  </Inset>
                </Disclosure>
                <Disclosure summary="Row disclosure" variant="row" className="mt-2">
                  <p className="pb-3 text-sm text-ink">Content revealed inline, no modal.</p>
                </Disclosure>
              </div>
            </Card>
          </div>
        </Section>

        {/* ---------------- Feedback ---------------- */}
        <Section id="feedback" title="Notices, toasts, empty and loading states">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <div className="flex flex-col gap-3">
                <Notice tone="info" title="Simulated figures">
                  Every number on this page comes from the test set or a labelled simulation.
                </Notice>
                <Notice tone="warning" title="The AI is resting">
                  Live drafting is paused. The desk still works on the saved examples, and the safety rules still run.
                </Notice>
                <Notice
                  tone="error"
                  title="That didn't send"
                  actions={
                    <Button size="sm" variant="secondary" leadingIcon={RotateCcw}>
                      Try again
                    </Button>
                  }
                >
                  The connection dropped. Your reply is saved as a draft.
                </Notice>
                <Notice tone="hold" title="Orders on hold">
                  ORD-20089 will not ship until a clinician resumes it with a note.
                </Notice>
                <Notice tone="success" title="Every safety case caught">
                  All safety cases in the test set went to a clinician.
                </Notice>
                <Notice tone="clinician" title="Clinician queue">
                  Escalations arrive here with the trigger words highlighted.
                </Notice>
              </div>
              <div className="mt-5">
                <ToastDemo />
              </div>
            </Card>
            <div className="flex flex-col gap-4">
              <Card padding="none">
                <EmptyState
                  icon={Inbox}
                  title="All caught up"
                  actions={
                    <Button variant="secondary" size="sm" href="/try/">
                      Try your own message
                    </Button>
                  }
                >
                  New patient messages land here with their check trail already run. Routine ones arrive with a checked draft.
                </EmptyState>
              </Card>
              <Card>
                <CardHeader title="Loading" description="Skeletons keep the final layout." />
                <div className="flex flex-col gap-4">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton rounded="pill" className="size-8" />
                      <div className="flex-1">
                        <Skeleton className="mb-2 h-3.5 w-1/3" />
                        <Skeleton className="h-3 w-4/5" />
                      </div>
                      <Skeleton rounded="pill" className="h-6 w-24" />
                    </div>
                  ))}
                  <SkeletonText lines={3} />
                </div>
              </Card>
            </div>
          </div>
        </Section>

        {/* ---------------- Format ---------------- */}
        <Section id="format" title="Formatting" description="Dates in each patient's own timezone, currency by country, relative to the demo's now (Wed 23 Sep 2026).">
          <Card>
            <ul className="grid gap-3 text-sm md:grid-cols-2">
              {SAMPLE_CASES.map((c) => (
                <li key={c.key} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-cool pb-2">
                  <span className="font-medium text-heading">
                    {c.patient.firstName} {c.patient.lastName.charAt(0)}., {COUNTRY_LABEL[c.patient.country]}
                  </span>
                  <span className="text-muted tnum">
                    {formatDate(c.message.receivedAt, c.patient.timezone, "dateTimeZone")}, {relativeTime(c.message.receivedAt)},
                    waiting {waitingTime(c.message.receivedAt)}, plan {formatMoney(c.patient.plan.monthlyPrice, c.patient.plan.currency, { explicit: true })}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>

        {/* ---------------- Trail ---------------- */}
        <Section
          id="trail"
          title="Check trail"
          description="The signature component. Each step expands inline to show its evidence. A safety stop halts the trail, marks it Stopped here, and settles later steps as skipped."
        >
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" leadingIcon={RotateCcw} onClick={() => setReplay((r) => r + 1)}>
              Replay the animation
            </Button>
          </div>
          <div className="grid items-start gap-4 xl:grid-cols-2">
            <Card>
              <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                <RiskBadge route="draft" /> Routine, animated, sources and check open
              </p>
              <Trail
                result={routine.result}
                messageText={routine.text}
                names={{ firstName: routine.patient.firstName, agentName: AGENT_NAME }}
                animate
                replayKey={replay}
                defaultOpen={["sources", "check"]}
                actions={deskActions}
              />
            </Card>
            <Card>
              <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                <RiskBadge route="clinician" /> Clinical question, animated stop
              </p>
              <Trail
                result={clinical.result}
                messageText={clinical.text}
                animate
                replayKey={replay}
                defaultOpen={["rules"]}
                actions={
                  <Button variant="secondary" size="sm" leadingIcon={Stethoscope} href="/clinician/">
                    Open in the clinician queue
                  </Button>
                }
              />
            </Card>
            <Card>
              <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                <RiskBadge route="person" /> Draft blocked by the fact check
              </p>
              <Trail
                result={blocked.result}
                messageText={blocked.text}
                names={{ firstName: blocked.patient.firstName, agentName: AGENT_NAME }}
                defaultOpen={["check"]}
                actions={
                  <Button variant="primary" leadingIcon={Pencil}>
                    Write the reply
                  </Button>
                }
              />
            </Card>
            <Card>
              <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                <RiskBadge route="urgent" /> <HoldBadge /> Bereavement, orders on hold
              </p>
              <Trail result={urgent.result} messageText={urgent.text} defaultOpen={["rules"]} />
            </Card>
            <Card>
              <p className="mb-3 text-xs text-muted">Compact, for narrow columns. No names passed: the draft shows fill-in tokens</p>
              <Trail result={routine.result} compact title="Checks" defaultOpen={["draft"]} />
            </Card>
            <Card>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted">Live run streaming (running), {liveSteps} of 6 steps received</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setLiveSteps((n) => Math.max(0, n - 1))}>
                    Back a step
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setLiveSteps((n) => Math.min(6, n + 1))}>
                    Next step
                  </Button>
                </div>
              </div>
              <Trail result={live} running title="Live trail" />
            </Card>
          </div>
        </Section>

        <Section id="mini" title="Mini trail" description="Compact and non-interactive, for the welcome screen. The loop is pausable and pauses on hover or focus.">
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <div className="rounded-card bg-navy-900 p-4 sm:p-8" data-surface="navy">
              <TrailMiniLoop
                cases={[
                  { message: routine.message, patient: routine.patient, result: routine.result },
                  { message: clinical.message, patient: clinical.patient, result: clinical.result },
                ]}
              />
            </div>
            <div className="flex flex-col gap-4">
              <Card>
                <TrailMini result={routine.result} tone="light" animate={false} />
              </Card>
              <Card>
                <TrailMini result={urgent.result} tone="light" animate={false} />
              </Card>
            </div>
          </div>
        </Section>
      </div>
    </AppShell>
  );
}
