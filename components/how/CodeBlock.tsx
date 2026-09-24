"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/components/ui/cn";

/**
 * A command from the runbook: dark navy block, horizontal scroll for long commands (focusable, so it scrolls from
 * the keyboard), and a Copy button that copies only the commands, never the "# ..." notes after them.
 */
export function CodeBlock({ code, lang, className }: { code: string; lang?: string; className?: string }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const lines = code.split("\n");
  const commandText = lines
    .map((l) => (lang === "sh" ? l.replace(/\s+#\s.*$/, "") : l))
    .join("\n")
    .trim();

  const copy = async () => {
    window.clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(commandText);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
    timer.current = window.setTimeout(() => setCopied("idle"), 1800);
  };

  return (
    <div className={cn("flex max-w-full items-start rounded-inner bg-navy-950", className)} data-surface="navy">
      <pre
        tabIndex={0}
        aria-label={lang === "sh" ? "Command" : "Code"}
        className="min-w-0 flex-1 overflow-x-auto rounded-inner py-3 pl-4 pr-3 font-mono text-[0.8125rem] leading-6 text-white"
      >
        <code>
          {lines.map((l, i) => {
            const note = lang === "sh" ? /^(.*?)(\s+#\s.*)$/.exec(l) : null;
            return (
              <span key={i} className="block whitespace-pre">
                {note ? (
                  <>
                    {note[1]}
                    <span className="text-on-navy-muted">{note[2]}</span>
                  </>
                ) : (
                  l || " "
                )}
              </span>
            );
          })}
        </code>
      </pre>
      <button
        type="button"
        onClick={copy}
        className={cn(
          "m-2 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-inner px-2.5 text-xs font-medium",
          "bg-white/10 text-white transition-colors duration-150 hover:bg-white/20 active:bg-white/25",
        )}
      >
        {copied === "done" ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
        <span>{copied === "done" ? "Copied" : copied === "failed" ? "Select to copy" : "Copy"}</span>
      </button>
      <span className="sr-only" role="status">
        {copied === "done" ? "Copied to the clipboard" : copied === "failed" ? "Copy is blocked here: select the text instead" : ""}
      </span>
    </div>
  );
}
