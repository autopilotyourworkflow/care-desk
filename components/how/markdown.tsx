import { Fragment, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { CodeBlock } from "./CodeBlock";

/**
 * A small Markdown renderer for the handover docs (docs/AGENT-GUIDE.md, docs/RUNBOOK.md), run at build time on the
 * server. It covers exactly what those files use: headings, paragraphs, bold, inline code, links, ordered and
 * unordered lists (nested, with code blocks inside items), tables and fenced code. It builds React elements, never
 * raw HTML, so nothing in a doc can inject markup.
 */

export type Inline = string;

export type Block =
  | { type: "heading"; level: number; text: Inline }
  | { type: "paragraph"; text: Inline }
  | { type: "code"; lang?: string; code: string }
  | { type: "list"; ordered: boolean; start: number; items: Block[][] }
  | { type: "table"; head: Inline[]; rows: Inline[][] };

const FENCE = /^(\s*)```\s*([\w-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

const indentOf = (line: string) => line.length - line.trimStart().length;
const isBlank = (line: string) => line.trim() === "";

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/** Removes up to `n` leading spaces from each line. */
function dedent(lines: string[], n: number): string[] {
  return lines.map((l) => {
    const cut = Math.min(n, indentOf(l));
    return l.slice(cut);
  });
}

export function parseMarkdown(src: string): Block[] {
  return parseBlocks(src.replace(/\r\n?/g, "\n").split("\n"));
}

function parseBlocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const pad = fence[1].length;
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence
      out.push({ type: "code", lang: fence[2] || undefined, code: dedent(body, pad).join("\n").replace(/\s+$/, "") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      out.push({ type: "heading", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }

    if (line.trimStart().startsWith("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const head = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trimStart().startsWith("|")) rows.push(splitRow(lines[i++]));
      out.push({ type: "table", head, rows });
      continue;
    }

    const item = ITEM.exec(line);
    if (item) {
      const base = item[1].length;
      const ordered = /\d/.test(item[2]);
      const start = ordered ? parseInt(item[2], 10) : 1;
      const items: Block[][] = [];
      while (i < lines.length) {
        const m = ITEM.exec(lines[i]);
        if (!m || m[1].length !== base || /\d/.test(m[2]) !== ordered) break;
        const contentIndent = base + m[2].length + 1;
        const body: string[] = [m[3]];
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (isBlank(l)) {
            // A blank line continues the item only if the next non-blank line is indented under it.
            let j = i + 1;
            while (j < lines.length && isBlank(lines[j])) j++;
            if (j < lines.length && indentOf(lines[j]) > base) {
              body.push("");
              i++;
              continue;
            }
            break;
          }
          if (indentOf(l) > base) {
            body.push(l);
            i++;
            continue;
          }
          // A lazy continuation line of the item's first paragraph.
          if (!ITEM.test(l) && !HEADING.test(l) && !FENCE.test(l) && !l.trimStart().startsWith("|")) {
            body.push(l);
            i++;
            continue;
          }
          break;
        }
        items.push(parseBlocks([body[0], ...dedent(body.slice(1), contentIndent)]));
      }
      out.push({ type: "list", ordered, start, items });
      continue;
    }

    const para: string[] = [line.trim()];
    i++;
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !FENCE.test(lines[i]) &&
      !ITEM.test(lines[i]) &&
      !lines[i].trimStart().startsWith("|")
    ) {
      para.push(lines[i].trim());
      i++;
    }
    out.push({ type: "paragraph", text: para.join(" ") });
  }
  return out;
}

// ---------- Inline ----------

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

export function renderInline(text: string, tone: "default" | "table" = "default"): ReactNode {
  const parts = text.split(INLINE);
  return parts.map((p, i) => {
    if (!p) return null;
    if (p.startsWith("**") && p.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-heading">
          {p.slice(2, -2)}
        </strong>
      );
    }
    if (p.startsWith("`") && p.endsWith("`")) {
      return (
        <code
          key={i}
          className={cn(
            "rounded-md bg-field px-1.5 py-px font-mono text-[0.8125em] text-navy-900 [overflow-wrap:anywhere]",
            tone === "table" && "bg-inset",
          )}
        >
          {p.slice(1, -1)}
        </code>
      );
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(p);
    if (link) {
      const external = /^https?:/.test(link[2]);
      return (
        <a
          key={i}
          href={link[2]}
          {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
          className="font-medium text-navy-900 underline decoration-navy-300 underline-offset-2 hover:decoration-navy-900"
        >
          {link[1]}
        </a>
      );
    }
    return <Fragment key={i}>{p}</Fragment>;
  });
}

/** Plain text of an inline string, for ids and labels. */
export function plainText(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

export function slugify(text: string): string {
  return plainText(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

// ---------- Blocks ----------

export interface MarkdownProps {
  blocks: Block[];
  /** Prefix for heading ids, so two docs on one page never share an id. */
  idPrefix: string;
  /** Heading level the doc's "##" maps to. The doc's "#" title is dropped: the page section carries it. */
  className?: string;
}

/** Renders parsed Markdown in the page's reading style. */
export function Markdown({ blocks, idPrefix, className }: MarkdownProps) {
  return <div className={cn("min-w-0", className)}>{renderBlocks(blocks, idPrefix, 0)}</div>;
}

function renderBlocks(blocks: Block[], idPrefix: string, depth: number, tight = false): ReactNode {
  return blocks.map((b, i) => {
    const first = i === 0;
    switch (b.type) {
      case "heading": {
        if (b.level === 1) return null;
        const id = `${idPrefix}-${slugify(b.text)}`;
        if (b.level === 2) {
          return (
            <h3
              key={i}
              id={id}
              className={cn("scroll-mt-2 text-base font-semibold text-heading", first ? "mt-0" : "mt-8", "mb-2")}
            >
              {renderInline(b.text)}
            </h3>
          );
        }
        return (
          <h4 key={i} id={id} className={cn("scroll-mt-2 text-sm font-semibold text-heading", first ? "mt-0" : "mt-6", "mb-1.5")}>
            {renderInline(b.text)}
          </h4>
        );
      }
      case "paragraph":
        if (tight) return <Fragment key={i}>{renderInline(b.text)}</Fragment>;
        return (
          <p key={i} className={cn("max-w-[70ch] text-base text-ink", first ? "mt-0" : depth > 0 ? "mt-2" : "mt-3")}>
            {renderInline(b.text)}
          </p>
        );
      case "code":
        return <CodeBlock key={i} code={b.code} lang={b.lang} className={first ? "mt-0" : depth > 0 ? "mt-2" : "mt-3"} />;
      case "list": {
        const ListTag = b.ordered ? "ol" : "ul";
        return (
          <ListTag
            key={i}
            start={b.ordered && b.start !== 1 ? b.start : undefined}
            className={cn(
              "max-w-[70ch] space-y-2 pl-6 text-base text-ink",
              b.ordered ? "list-decimal marker:font-semibold marker:text-heading" : "list-disc marker:text-muted-icon",
              first ? "mt-0" : depth > 0 ? "mt-2" : "mt-3",
            )}
          >
            {b.items.map((item, j) => {
              const single = item.length === 1 && item[0].type === "paragraph";
              return (
                <li key={j} className="pl-1">
                  {renderBlocks(item, idPrefix, depth + 1, single)}
                </li>
              );
            })}
          </ListTag>
        );
      }
      case "table":
        return <DocTable key={i} head={b.head} rows={b.rows} className={first ? "mt-0" : "mt-4"} />;
    }
  });
}

/**
 * A doc table. From 640px it is a normal table; below that each row becomes a small block with the column name
 * beside each value, so nothing scrolls sideways on a phone.
 */
export function DocTable({ head, rows, className }: { head: Inline[]; rows: Inline[][]; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-inner ring-1 ring-line-cool", className)}>
      <table className="w-full border-collapse text-left text-sm max-sm:block">
        <thead className="bg-inset max-sm:hidden">
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="px-3.5 py-2.5 align-bottom text-xs font-semibold text-muted">
                {renderInline(h, "table")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="max-sm:block">
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line-cool first:border-t-0 sm:first:border-t max-sm:block max-sm:px-3.5 max-sm:py-3">
              {r.map((c, j) => (
                <td
                  key={j}
                  className={cn(
                    "px-3.5 py-2.5 align-top text-ink max-sm:block max-sm:p-0",
                    j === 0 ? "font-medium text-heading max-sm:text-sm" : "max-sm:mt-1",
                  )}
                >
                  {j > 0 && <span className="block text-2xs font-semibold text-muted sm:hidden">{plainText(head[j] ?? "")}</span>}
                  {renderInline(c, "table")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
