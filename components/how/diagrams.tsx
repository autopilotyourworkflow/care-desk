import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/*
 * Hand-authored inline SVG for the How it works page. Two drawings per figure: a wide one from 1024px and a tall one
 * below it, so labels stay about 12px on a phone instead of shrinking with a wide drawing. Only one is displayed at a
 * time (the other is display: none, so assistive technology reads one). Colours come from the design tokens; meaning
 * is always carried by a word on the drawing as well as its colour.
 */

type Kind = "plain" | "code" | "claude" | "person";

interface StepNode {
  wide: [string, string];
  tall: string;
  sub: string;
  kind: Kind;
}

const STEPS: StepNode[] = [
  { wide: ["Patient", "message"], tall: "Patient message", sub: "Email or chat", kind: "plain" },
  { wide: ["Details", "removed"], tall: "Details removed", sub: "Code, no AI", kind: "code" },
  { wide: ["Safety", "rules"], tall: "Safety rules", sub: "Code, no AI", kind: "code" },
  { wide: ["Sorted", "by type"], tall: "Sorted by type", sub: "Claude, fast model", kind: "claude" },
  { wide: ["Sources", "found"], tall: "Sources found", sub: "Records and policy", kind: "code" },
  { wide: ["Reply", "drafted"], tall: "Reply drafted", sub: "Claude, strong model", kind: "claude" },
  { wide: ["Facts", "checked"], tall: "Facts checked", sub: "Code, no AI", kind: "code" },
  { wide: ["A person", "sends"], tall: "A person sends", sub: "Agent reviews first", kind: "person" },
];

const NODE_BOX: Record<Kind, string> = {
  plain: "fill-surface stroke-line-strong",
  code: "fill-surface stroke-line-strong",
  claude: "fill-navy-50 stroke-navy-300",
  person: "fill-navy-900 stroke-navy-900",
};
const NODE_TITLE: Record<Kind, string> = {
  plain: "fill-heading",
  code: "fill-heading",
  claude: "fill-heading",
  person: "fill-white",
};
const NODE_SUB: Record<Kind, string> = {
  plain: "fill-muted",
  code: "fill-muted",
  claude: "fill-navy-600",
  person: "fill-on-navy-muted",
};

/** Arrowhead markers, one per colour (marker content cannot inherit the line's colour in every browser). */
function Markers({ prefix }: { prefix: string }) {
  const tones: [string, string][] = [
    ["ink", "#6f7887"],
    ["stop", "#9e1119"],
    ["clin", "#3a47b8"],
    ["info", "#1b6893"],
  ];
  return (
    <defs>
      {tones.map(([name, color]) => (
        <marker
          key={name}
          id={`${prefix}-${name}`}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 z" fill={color} />
        </marker>
      ))}
    </defs>
  );
}

const LINE: Record<string, string> = {
  ink: "stroke-muted-icon",
  stop: "stroke-urgent-fg",
  clin: "stroke-clinician-fg",
  info: "stroke-info-fg",
};

function Arrow({
  d,
  tone = "ink",
  prefix,
  both,
  width = 1.5,
}: {
  d: string;
  tone?: keyof typeof LINE;
  prefix: string;
  both?: boolean;
  width?: number;
}) {
  return (
    <path
      d={d}
      fill="none"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={LINE[tone]}
      markerEnd={`url(#${prefix}-${tone})`}
      markerStart={both ? `url(#${prefix}-${tone})` : undefined}
    />
  );
}

function Label({
  x,
  y,
  children,
  anchor = "start",
  className,
  size = 12,
  weight = 500,
}: {
  x: number;
  y: number;
  children: ReactNode;
  anchor?: "start" | "middle" | "end";
  className?: string;
  size?: number;
  weight?: number;
}) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={size} fontWeight={weight} className={cn("fill-muted", className)}>
      {children}
    </text>
  );
}

/** A small pause glyph and "Orders on hold" in a pill, drawn, not a font glyph. */
function HoldPill({ x, y, w, size = 11.5 }: { x: number; y: number; w: number; size?: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={26} rx={13} className="fill-hold-bg" />
      <rect x={x + 11} y={y + 8} width={2.5} height={10} rx={1} className="fill-hold-icon" />
      <rect x={x + 16} y={y + 8} width={2.5} height={10} rx={1} className="fill-hold-icon" />
      <text x={x + 25} y={y + 17.5} fontSize={size} fontWeight={600} className="fill-hold-fg">
        Orders on hold
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Figure 1: the pipeline
// ---------------------------------------------------------------------------------------------------------------

const PIPELINE_CLAIM =
  "A patient message passes seven steps in order. Personal details are removed and plain safety rules run before any AI. A safety stop sends the message to the clinician queue with the patient's orders on hold and no AI reply; the sorter can also escalate. When the sorter is unsure, the drafter declines or the fact check fails, an agent writes the reply instead. Every reply that goes out is sent by a person.";

function PipelineWide() {
  const p = "pw";
  const W = 110;
  const G = 16;
  const X0 = 4;
  const Y = 144;
  const H = 72;
  const x = (i: number) => X0 + i * (W + G);
  const cx = (i: number) => x(i) + W / 2;
  return (
    <svg viewBox="0 0 1000 360" role="img" aria-label={PIPELINE_CLAIM} className="hidden h-auto w-full lg:block">
      <Markers prefix={p} />

      {/* Clinician lane, above the steps that can stop the trail */}
      <rect x={x(1)} y={16} width={x(3) + W - x(1)} height={64} rx={16} className="fill-clinician-bg" />
      <Label x={x(1) + 18} y={43} size={13.5} weight={600} className="fill-clinician-fg">
        Clinician queue
      </Label>
      <Label x={x(1) + 18} y={63} className="fill-ink">
        Urgent first. No AI reply.
      </Label>
      <HoldPill x={x(3) + W - 142} y={35} w={128} />

      {/* Main flow */}
      {STEPS.map((s, i) => (
        <g key={i}>
          <rect x={x(i)} y={Y} width={W} height={H} rx={14} strokeWidth={1.25} className={NODE_BOX[s.kind]} />
          <text x={cx(i)} y={Y + 25} textAnchor="middle" fontSize={13} fontWeight={600} className={NODE_TITLE[s.kind]}>
            <tspan x={cx(i)}>{s.wide[0]}</tspan>
            <tspan x={cx(i)} dy={16}>
              {s.wide[1]}
            </tspan>
          </text>
          <text x={cx(i)} y={Y + 61} textAnchor="middle" fontSize={11} fontWeight={500} className={NODE_SUB[s.kind]}>
            {s.sub.replace(", fast model", " (fast)").replace(", strong model", " (strong)").replace(" reviews first", " approves")}
          </text>
          {i < STEPS.length - 1 && <Arrow prefix={p} d={`M${x(i) + W + 1} ${Y + H / 2} H${x(i + 1) - 2}`} />}
        </g>
      ))}

      {/* Stops: rules and sorter up to the clinician lane */}
      <Arrow prefix={p} tone="stop" width={2} d={`M${cx(2)} ${Y - 2} V${82}`} />
      <Label x={cx(2) - 8} y={108} anchor="end" weight={700} className="fill-urgent-fg">
        Stop
      </Label>
      <Label x={cx(2) - 8} y={124} anchor="end" size={11} className="fill-urgent-fg">
        clinical, crisis, a death
      </Label>
      <Arrow prefix={p} tone="clin" d={`M${cx(3)} ${Y - 2} V${82}`} />
      <Label x={cx(3) + 8} y={116} weight={600} className="fill-clinician-fg">
        Risk found
      </Label>

      {/* Person lane, below the AI steps that can hand over */}
      <rect x={x(3)} y={280} width={x(6) + W - x(3)} height={64} rx={16} className="fill-info-bg" />
      <Label x={x(3) + 18} y={307} size={13.5} weight={600} className="fill-info-fg">
        An agent writes the reply
      </Label>
      <Label x={x(3) + 18} y={327} className="fill-ink">
        No draft is offered, and the trail shows why.
      </Label>
      {(
        [
          [3, "Unsure"],
          [5, "Declines"],
          [6, "Fails"],
        ] as const
      ).map(([i, label]) => (
        <g key={i}>
          <Arrow prefix={p} tone="info" d={`M${cx(i)} ${Y + H + 2} V${278}`} />
          <Label x={cx(i) + 8} y={253} weight={600} className="fill-info-fg">
            {label}
          </Label>
        </g>
      ))}
    </svg>
  );
}

function PipelineTall() {
  const p = "pt";
  const X = 10;
  const W = 176;
  const H = 56;
  const STEP = 84;
  const RX = 244;
  const RW = 110;
  const y = (i: number) => 12 + i * STEP;
  const mid = (i: number) => y(i) + H / 2;
  return (
    <svg viewBox="0 0 360 668" role="img" aria-label={PIPELINE_CLAIM} className="mx-auto block h-auto w-full max-w-[420px] lg:hidden">
      <Markers prefix={p} />
      {STEPS.map((s, i) => (
        <g key={i}>
          <rect x={X} y={y(i)} width={W} height={H} rx={14} strokeWidth={1.25} className={NODE_BOX[s.kind]} />
          <text x={X + 14} y={y(i) + 23} fontSize={13} fontWeight={600} className={NODE_TITLE[s.kind]}>
            {s.tall}
          </text>
          <text x={X + 14} y={y(i) + 42} fontSize={11} fontWeight={500} className={NODE_SUB[s.kind]}>
            {s.sub}
          </text>
          {i < STEPS.length - 1 && <Arrow prefix={p} d={`M${X + 40} ${y(i) + H + 1} V${y(i + 1) - 2}`} />}
        </g>
      ))}

      {/* Clinician lane beside the rules and the sorter */}
      <rect x={RX} y={y(2)} width={RW} height={y(3) + H - y(2)} rx={14} className="fill-clinician-bg" />
      <text x={RX + 12} y={y(2) + 24} fontSize={13} fontWeight={600} className="fill-clinician-fg">
        <tspan x={RX + 12}>Clinician</tspan>
        <tspan x={RX + 12} dy={16}>
          queue
        </tspan>
      </text>
      <Label x={RX + 12} y={y(2) + 62} size={11} className="fill-ink">
        No AI reply
      </Label>
      <rect x={RX + 8} y={y(2) + 80} width={RW - 16} height={40} rx={12} className="fill-hold-bg" />
      <text x={RX + 16} y={y(2) + 96} fontSize={10.5} fontWeight={600} className="fill-hold-fg">
        <tspan x={RX + 16}>Orders</tspan>
        <tspan x={RX + 16} dy={13}>
          on hold
        </tspan>
      </text>
      <Arrow prefix={p} tone="stop" width={2} d={`M${X + W + 1} ${mid(2)} H${RX - 2}`} />
      <Label x={(X + W + RX) / 2} y={mid(2) - 7} anchor="middle" size={11} weight={700} className="fill-urgent-fg">
        Stop
      </Label>
      <Arrow prefix={p} tone="clin" d={`M${X + W + 1} ${mid(3) - 8} H${RX - 2}`} />
      <Label x={(X + W + RX) / 2} y={mid(3) - 15} anchor="middle" size={11} weight={600} className="fill-clinician-fg">
        Risk
      </Label>

      {/* Person lane beside sources, draft and check */}
      <rect x={RX} y={y(4)} width={RW} height={y(6) + H - y(4)} rx={14} className="fill-info-bg" />
      <text x={RX + 12} y={y(4) + 24} fontSize={13} fontWeight={600} className="fill-info-fg">
        <tspan x={RX + 12}>An agent</tspan>
        <tspan x={RX + 12} dy={16}>
          writes the
        </tspan>
        <tspan x={RX + 12} dy={16}>
          reply
        </tspan>
      </text>
      <text x={RX + 12} y={y(4) + 82} fontSize={11} fontWeight={500} className="fill-ink">
        <tspan x={RX + 12}>No draft is</tspan>
        <tspan x={RX + 12} dy={15}>
          offered
        </tspan>
      </text>
      <Arrow prefix={p} tone="info" d={`M${X + W + 1} ${mid(3) + 12} H${216} V${y(4) + 26} H${RX - 2}`} />
      <Label x={222} y={y(4) - 12} size={11} weight={600} className="fill-info-fg">
        Unsure
      </Label>
      <Arrow prefix={p} tone="info" d={`M${X + W + 1} ${mid(5)} H${RX - 2}`} />
      <Label x={(X + W + RX) / 2} y={mid(5) - 7} anchor="middle" size={11} weight={600} className="fill-info-fg">
        Declines
      </Label>
      <Arrow prefix={p} tone="info" d={`M${X + W + 1} ${mid(6)} H${RX - 2}`} />
      <Label x={(X + W + RX) / 2} y={mid(6) - 7} anchor="middle" size={11} weight={600} className="fill-info-fg">
        Fails
      </Label>
    </svg>
  );
}

export function PipelineDiagram() {
  return (
    <>
      <PipelineWide />
      <PipelineTall />
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Figure 2: where data lives
// ---------------------------------------------------------------------------------------------------------------

const DATA_CLAIM =
  "Three places. The visitor's browser loads the pages and the demo data from static files, and keeps the visitor's own decisions. One Cloudflare Worker serves those files and runs the live box: it removes personal details and runs the safety rules, then sends only placeholders and numbered sources to the Claude API, and streams the trail back. The Worker's settings store holds the limits, the on/off switch and counts, never a message; private-link codes are Worker secrets. There is no database of patient data.";

function Box({
  x,
  y,
  w,
  h,
  title,
  lines,
  tone = "plain",
  titleSize = 13.5,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  lines: string[];
  tone?: "plain" | "inner" | "claude" | "store";
  titleSize?: number;
}) {
  const box = {
    plain: "fill-surface stroke-line-strong",
    inner: "fill-inset stroke-line-cool",
    claude: "fill-navy-50 stroke-navy-300",
    store: "fill-surface stroke-line-strong",
  }[tone];
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={14}
        strokeWidth={1.25}
        strokeDasharray={tone === "store" ? "5 4" : undefined}
        className={box}
      />
      <text x={x + 16} y={y + 26} fontSize={titleSize} fontWeight={600} className="fill-heading">
        {title}
      </text>
      {lines.map((l, i) => (
        <text key={i} x={x + 16} y={y + 46 + i * 17} fontSize={12} fontWeight={400} className="fill-ink">
          {l}
        </text>
      ))}
    </g>
  );
}

function DataWide() {
  const p = "dw";
  return (
    <svg viewBox="0 0 1000 300" role="img" aria-label={DATA_CLAIM} className="hidden h-auto w-full lg:block">
      <Markers prefix={p} />
      {/* Browser */}
      <Box x={6} y={44} w={214} h={228} title="Visitor's browser" lines={["Shows the pages and", "the desk. Keeps the", "visitor's decisions, in", "this browser only."]} />

      {/* Worker */}
      <rect x={370} y={6} width={262} height={288} rx={18} strokeWidth={1.25} className="fill-surface stroke-navy-900" />
      <text x={386} y={30} fontSize={13.5} fontWeight={600} className="fill-heading">
        One Cloudflare Worker
      </text>
      <Box x={386} y={44} w={230} h={124} tone="inner" titleSize={13} title="Live box: /api/try" lines={["Removes details, runs the", "safety rules, then calls Claude.", "Holds the API key and limits."]} />
      <Box x={386} y={182} w={230} h={96} tone="inner" titleSize={13} title="Static files" lines={["Pages and precomputed", "demo results. All fictional."]} />

      {/* Claude */}
      <Box x={760} y={34} w={234} h={112} tone="claude" title="Claude API" lines={["Sees placeholders and", "numbered sources only."]} />
      {/* Settings store */}
      <Box x={760} y={182} w={234} h={96} tone="store" title="Settings store" lines={["Limits, on/off switch,", "counts. Never a message."]} />

      {/* Browser and live box */}
      <Arrow prefix={p} d="M222 82 H384" />
      <Label x={302} y={73} anchor="middle" size={11.5}>
        a typed message
      </Label>
      <Arrow prefix={p} d="M384 128 H222" />
      <Label x={302} y={119} anchor="middle" size={11.5}>
        the trail, step by step
      </Label>
      {/* Static files to the browser */}
      <Arrow prefix={p} d="M384 230 H222" />
      <Label x={302} y={221} anchor="middle" size={11.5}>
        pages and demo data
      </Label>
      {/* Live box and Claude */}
      <Arrow prefix={p} tone="clin" d="M618 76 H758" />
      <Label x={688} y={67} anchor="middle" size={11.5} weight={600} className="fill-clinician-fg">
        placeholders only
      </Label>
      <Arrow prefix={p} d="M758 118 H618" />
      <Label x={688} y={109} anchor="middle" size={11.5}>
        sort and draft
      </Label>
      {/* Live box and settings */}
      <Arrow prefix={p} d="M618 150 H690 V230 H758" />
      <Label x={698} y={200} size={11.5}>
        counts
      </Label>
    </svg>
  );
}

function DataTall() {
  const p = "dt";
  return (
    <svg viewBox="0 0 360 520" role="img" aria-label={DATA_CLAIM} className="mx-auto block h-auto w-full max-w-[420px] lg:hidden">
      <Markers prefix={p} />
      <Box x={4} y={4} w={352} h={82} title="Visitor's browser" lines={["Shows the pages. Keeps decisions", "in this browser only."]} />

      <rect x={4} y={150} width={352} height={196} rx={18} strokeWidth={1.25} className="fill-surface stroke-navy-900" />
      <Box x={16} y={164} w={160} h={140} tone="inner" titleSize={12.5} title="Static files" lines={["Pages and demo", "results. All", "fictional."]} />
      <Box x={184} y={164} w={160} h={140} tone="inner" titleSize={12.5} title="Live box" lines={["Removes details,", "runs the rules,", "then calls Claude.", "Holds the key."]} />
      <text x={18} y={330} fontSize={13.5} fontWeight={600} className="fill-heading">
        One Cloudflare Worker
      </text>

      {/* Browser links */}
      <Arrow prefix={p} d="M60 162 V88" />
      <Label x={68} y={116} size={11}>
        pages and
      </Label>
      <Label x={68} y={130} size={11}>
        demo data
      </Label>
      <Arrow prefix={p} both d="M230 90 V162" />
      <Label x={238} y={116} size={11}>
        message in,
      </Label>
      <Label x={238} y={130} size={11}>
        trail back
      </Label>

      {/* Claude and settings */}
      <Box x={184} y={410} w={172} h={104} tone="claude" title="Claude API" lines={["Sees placeholders", "and numbered", "sources only."]} />
      <Box x={4} y={410} w={172} h={104} tone="store" title="Settings store" lines={["Limits, on/off,", "counts. Never a", "message."]} />
      <Arrow prefix={p} tone="clin" both d="M230 306 V408" />
      <Label x={238} y={372} size={11} weight={600} className="fill-clinician-fg">
        placeholders
      </Label>
      <Label x={238} y={386} size={11} weight={600} className="fill-clinician-fg">
        only
      </Label>
      <Arrow prefix={p} d="M200 306 V372 H90 V408" />
      <Label x={145} y={365} size={11} anchor="middle">
        counts
      </Label>
    </svg>
  );
}

export function DataDiagram() {
  return (
    <>
      <DataWide />
      <DataTall />
    </>
  );
}

export function Figure({ children, caption, className }: { children: ReactNode; caption: ReactNode; className?: string }) {
  return (
    <figure className={cn("min-w-0", className)}>
      {children}
      <figcaption className="mt-4 max-w-[70ch] text-sm text-muted">{caption}</figcaption>
    </figure>
  );
}
