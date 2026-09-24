"use client";

/**
 * Hand-built chart parts for Insights: plain React and SVG, no chart library.
 *
 * Colour roles (validated with the dataviz skill's palette checker against the white card):
 *   --viz-primary   navy-500 #474e9c   "with Care Desk", routine messages (3:1 or better, in the lightness band)
 *   --viz-context   navy-300 #9fa5d6   the simulated "before" (context, 2.38:1, so every value is also in a label or
 *                                      the table view)
 *   --viz-safety    #6b7cff            safety messages, the clinician's lavender (19.3 from primary, normal vision)
 * Marks: columns at most 24px wide, 4px rounded data ends, square at the baseline, a 2px surface gap between touching
 * marks, solid hairline gridlines. Text always wears text tokens, never a series colour.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { SegmentedControl } from "@/components/ui";

export const VIZ = {
  primary: "#474e9c",
  context: "#9fa5d6",
  safety: "#6b7cff",
  grid: "#e4e8ef",
  axis: "#cfd5df",
  surface: "#ffffff",
} as const;

// ---------- Layout helpers ----------

/** The rendered width of an element, updated on resize. Starts from a fallback so the first paint has a layout. */
export function useElementWidth<E extends HTMLElement>(fallback = 640) {
  const ref = useRef<E>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setWidth(w);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Clean tick values from 0 to a round maximum at or above `max`. */
export function niceTicks(max: number, target = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const steps = [1, 2, 2.5, 5, 10];
  const step = (steps.find((s) => s * pow >= raw) ?? 10) * pow;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + step / 1000; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

/** A column with a 4px rounded data end and a square foot on the baseline. */
export function columnPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

// ---------- Chart or table ----------

export type ChartView = "chart" | "table";

export function ViewToggle({ value, onChange, label }: { value: ChartView; onChange: (v: ChartView) => void; label: string }) {
  return (
    <SegmentedControl
      size="sm"
      label={label}
      value={value}
      onChange={onChange}
      items={[
        { id: "chart", label: "Chart" },
        { id: "table", label: "Table" },
      ]}
    />
  );
}

// ---------- Legend ----------

export interface LegendItem {
  label: string;
  color: string;
  /** Shown after the label in muted text, e.g. "simulated". */
  note?: string;
}

export function Legend({ items, className }: { items: LegendItem[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink", className)}>
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2.5 rounded-[3px]" style={{ backgroundColor: it.color }} />
          <span className="font-medium text-heading">{it.label}</span>
          {it.note && <span className="text-muted">{it.note}</span>}
        </li>
      ))}
    </ul>
  );
}

// ---------- Tooltip ----------

export interface TipRow {
  label: string;
  value: string;
  color: string;
}

/** The chart's hover and focus readout: values lead, series names follow, keyed with a short line. */
function ChartTip({ x, y, title, rows, containerWidth }: { x: number; y: number; title: string; rows: TipRow[]; containerWidth: number }) {
  const width = 232;
  const left = Math.max(0, Math.min(containerWidth - width, x - width / 2));
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-10 rounded-inner bg-surface p-3 text-xs shadow-pop ring-1 ring-line-cool"
      style={{ left, top: Math.max(0, y), width }}
    >
      <p className="mb-1.5 font-semibold text-heading">{title}</p>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2 whitespace-nowrap">
            <span aria-hidden className="h-0.5 w-3 shrink-0 rounded-pill" style={{ backgroundColor: r.color }} />
            <span className="font-semibold text-heading tnum">{r.value}</span>
            <span className="min-w-0 truncate text-muted">{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Keyboard and pointer layer shared by the column charts ----------

function useActiveIndex(count: number) {
  const [active, setActive] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const onKeyDown = useCallback(
    (e: KeyboardEvent<SVGSVGElement>) => {
      if (!count) return;
      let next: number | null = null;
      const cur = active ?? -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = Math.min(count - 1, cur + 1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = Math.max(0, cur < 0 ? 0 : cur - 1);
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = count - 1;
      else if (e.key === "Escape") {
        setActive(null);
        return;
      }
      if (next == null) return;
      e.preventDefault();
      setActive(next);
    },
    [active, count],
  );
  return {
    active,
    setActive,
    focused,
    svgProps: {
      tabIndex: 0,
      onKeyDown,
      onFocus: () => {
        setFocused(true);
        setActive((a) => a ?? count - 1);
      },
      onBlur: () => {
        setFocused(false);
        setActive(null);
      },
      onPointerLeave: () => setActive(null),
    },
  };
}

// ---------- Grouped columns: before and after, per week ----------

export interface PairDatum {
  label: string;
  /** Long label for the tooltip, e.g. "Week of 24 Aug". */
  longLabel: string;
  before: number;
  after: number;
}

export function PairedColumns({
  data,
  beforeLabel,
  afterLabel,
  format,
  formatTick,
  unitMax,
  ariaLabel,
  tipBeforeLabel,
  tipAfterLabel,
  height = 280,
}: {
  data: PairDatum[];
  /** Shorter series names for the tooltip. */
  tipBeforeLabel?: string;
  tipAfterLabel?: string;
  beforeLabel: string;
  afterLabel: string;
  /** Full value text, e.g. "5 h 12 min". */
  format: (v: number) => string;
  /** Tick text for the y axis, e.g. "6 h". */
  formatTick: (v: number) => string;
  /** Converts a value to tick units (minutes to hours: v / 60). */
  unitMax: (v: number) => number;
  ariaLabel: string;
  height?: number;
}) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const { active, setActive, focused, svgProps } = useActiveIndex(data.length);
  const liveId = useId();
  const axisW = 40;
  const bottom = 30;
  const top = 22;
  const plotW = Math.max(120, width - axisW - 4);
  const plotH = height - top - bottom;
  const maxUnits = Math.max(...data.map((d) => unitMax(Math.max(d.before, d.after))), 0.001);
  const ticks = niceTicks(maxUnits);
  const topTick = ticks[ticks.length - 1] || 1;
  const band = plotW / Math.max(1, data.length);
  const barW = Math.max(8, Math.min(24, band * 0.28));
  const gap = 2;
  const y = (v: number) => top + plotH - (unitMax(v) / topTick) * plotH;

  const activeDatum = active != null ? data[active] : null;
  const lastIdx = data.length - 1;

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg
        role="img"
        aria-label={ariaLabel}
        aria-describedby={liveId}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block overflow-visible rounded-inner focus-visible:outline-offset-4"
        {...svgProps}
      >
        {ticks.map((t) => {
          const ty = top + plotH - (t / topTick) * plotH;
          return (
            <g key={t}>
              <line x1={axisW} x2={axisW + plotW} y1={ty} y2={ty} stroke={t === 0 ? VIZ.axis : VIZ.grid} strokeWidth={1} />
              <text x={axisW - 8} y={ty} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tnum">
                {formatTick(t)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const cx = axisW + band * i + band / 2;
          const bx = cx - barW - gap / 2;
          const ax = cx + gap / 2;
          const by = y(d.before);
          const ay = y(d.after);
          const base = top + plotH;
          const dim = active != null && active !== i;
          return (
            <g key={d.label} style={{ opacity: dim ? 0.45 : 1, transition: "opacity 150ms" }}>
              <path d={columnPath(bx, by, barW, base - by)} fill={VIZ.context} />
              <path d={columnPath(ax, ay, barW, base - ay)} fill={VIZ.primary} />
              {i === lastIdx && (
                <>
                  <text x={bx + barW / 2} y={by - 6} textAnchor="middle" className="fill-muted text-[11px] font-medium tnum">
                    {formatTick(unitMax(d.before))}
                  </text>
                  <text x={ax + barW / 2} y={ay - 6} textAnchor="middle" className="fill-heading text-[11px] font-semibold tnum">
                    {formatTick(unitMax(d.after))}
                  </text>
                </>
              )}
              <text x={cx} y={base + 18} textAnchor="middle" className="fill-muted text-[11px] tnum">
                {d.label}
              </text>
              <rect
                x={axisW + band * i}
                y={top}
                width={band}
                height={plotH + bottom}
                fill="transparent"
                onPointerMove={() => setActive(i)}
                onPointerDown={() => setActive(i)}
              />
            </g>
          );
        })}
      </svg>
      {activeDatum && active != null && (
        <ChartTip
          containerWidth={width}
          x={axisW + band * active + band / 2}
          y={Math.max(0, y(Math.max(activeDatum.before, activeDatum.after)) - 86)}
          title={activeDatum.longLabel}
          rows={[
            { label: tipBeforeLabel ?? beforeLabel, value: format(activeDatum.before), color: VIZ.context },
            { label: tipAfterLabel ?? afterLabel, value: format(activeDatum.after), color: VIZ.primary },
          ]}
        />
      )}
      <p id={liveId} className="sr-only" aria-live="polite">
        {focused && activeDatum
          ? `${activeDatum.longLabel}: ${beforeLabel} ${format(activeDatum.before)}, ${afterLabel} ${format(activeDatum.after)}.`
          : "Use the left and right arrow keys to read each week."}
      </p>
    </div>
  );
}

// ---------- A table that scrolls inside its card ----------

export function DataTable({
  caption,
  head,
  rows,
  numeric,
}: {
  caption: string;
  head: ReactNode[];
  rows: ReactNode[][];
  /** Column indexes that hold numbers (right aligned, tabular). */
  numeric?: number[];
}) {
  const isNum = (i: number) => numeric?.includes(i);
  return (
    <div className="-mx-1 overflow-x-auto px-1" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full min-w-[420px] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line-cool text-left text-xs text-muted">
            {head.map((h, i) => (
              <th key={i} scope="col" className={cn("px-2 py-2 font-medium first:pl-0 last:pr-0", isNum(i) && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-line-cool last:border-b-0">
              {r.map((c, ci) =>
                ci === 0 ? (
                  <th key={ci} scope="row" className="py-2 pr-2 text-left font-medium text-heading">
                    {c}
                  </th>
                ) : (
                  <td key={ci} className={cn("px-2 py-2 text-ink last:pr-0", isNum(ci) && "text-right tnum")}>
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
