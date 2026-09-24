"use client";

import { forwardRef, type Ref } from "react";
import { X } from "lucide-react";
import { KeyCombo } from "@/components/ui/Kbd";
import { SegmentedControl } from "@/components/ui/Tabs";

export interface Shortcut {
  keys: string[];
  label: string;
}
export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

/**
 * The shortcuts that work on every page. Screens with their own keys (the desk, the clinician queue, Test results,
 * Try it) pass their groups to AppShell, ending with this group.
 */
export const DEFAULT_SHORTCUTS: ShortcutGroup[] = [
  {
    title: "Anywhere",
    items: [
      { keys: ["?"], label: "Show keyboard shortcuts" },
      { keys: ["Esc"], label: "Close menus and panels" },
    ],
  },
];

/** The line under the panel title when a page does not supply its own. */
export const DEFAULT_SHORTCUTS_INTRO = "Shortcuts pause while you type.";

export interface ShortcutsPanelProps {
  groups: ShortcutGroup[];
  onClose: () => void;
  /** One line under the title. Defaults to DEFAULT_SHORTCUTS_INTRO. */
  intro?: string;
  /** The close button, so the shell can move focus into the panel when it opens. */
  closeButtonRef?: Ref<HTMLButtonElement>;
  /** One-key shortcuts on or off (WCAG 2.1.4). */
  singleKeys: boolean;
  onSingleKeysChange: (on: boolean) => void;
}

const SINGLE_KEY_ITEMS = [
  { id: "on", label: "On" },
  { id: "off", label: "Off" },
] as const;

/** A shortcut is a chord when it needs Ctrl, Cmd or Alt, or is a named key such as Esc or an arrow. */
function isSingleKey(keys: string[]): boolean {
  return keys.length === 1 && keys[0].length === 1;
}

/**
 * Keyboard shortcuts panel: a modal <dialog> (opened with showModal, so the page behind is inert and Tab stays inside).
 * Escape, the close button or a click on the dimmed backdrop close it. Opened from Help or the "?" key. AppShell moves
 * focus to the close button when it opens and back to where it was when it closes. It also holds the switch that turns
 * one-key shortcuts off.
 */
export const ShortcutsPanel = forwardRef<HTMLDialogElement, ShortcutsPanelProps>(function ShortcutsPanel(
  { groups, onClose, intro = DEFAULT_SHORTCUTS_INTRO, closeButtonRef, singleKeys, onSingleKeysChange },
  ref,
) {
  return (
    <dialog
      ref={ref}
      id="caredesk-shortcuts"
      aria-labelledby="caredesk-shortcuts-title"
      onClick={(e) => {
        // A click on the backdrop lands on the dialog itself, outside its box.
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside) onClose();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-card bg-surface p-6 text-ink shadow-pop ring-1 ring-line-cool open:animate-rise-in backdrop:bg-navy-950/30"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 id="caredesk-shortcuts-title" className="text-base font-semibold text-heading">
            Keyboard shortcuts
          </h2>
          <p className="mt-0.5 text-sm text-muted">{intro}</p>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Close keyboard shortcuts"
          className="-mr-2 -mt-1 inline-flex size-9 shrink-0 items-center justify-center rounded-inner text-muted-icon transition-colors duration-150 hover:bg-field hover:text-heading active:bg-field-hover"
        >
          <X aria-hidden size={18} />
        </button>
      </div>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-control bg-inset p-3">
        <div className="min-w-0 flex-1 basis-48">
          <p id="caredesk-single-keys-label" className="text-sm font-medium text-heading">
            One-key shortcuts
          </p>
          <p id="caredesk-single-keys-help" className="mt-0.5 text-xs text-muted">
            {singleKeys
              ? "Turn these off if they get in the way of speech input or another tool."
              : "Off. J, K, ? and the other one-key shortcuts do nothing. Ctrl+Enter and Esc still work."}
          </p>
        </div>
        <SegmentedControl
          label="One-key shortcuts"
          size="sm"
          items={[...SINGLE_KEY_ITEMS]}
          value={singleKeys ? "on" : "off"}
          onChange={(v) => onSingleKeysChange(v === "on")}
        />
      </div>

      <div className="flex flex-col gap-5">
        {groups.map((g) => (
          <section key={g.title}>
            <h3 className="mb-1 text-xs font-semibold text-muted">{g.title}</h3>
            <dl className="divide-y divide-line-cool">
              {g.items.map((s) => {
                const paused = !singleKeys && isSingleKey(s.keys);
                return (
                  <div key={s.label} className="flex items-center justify-between gap-4 py-2">
                    <dt className={paused ? "text-sm text-muted" : "text-sm text-ink"}>
                      {s.label}
                      {paused && <span className="sr-only"> (off)</span>}
                    </dt>
                    <dd className={paused ? "opacity-50" : undefined}>
                      <KeyCombo keys={s.keys} />
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ))}
      </div>
    </dialog>
  );
});
