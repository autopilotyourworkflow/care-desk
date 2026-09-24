import type { ShortcutGroup } from "@/components/shell/ShortcutsPanel";

/** The desk's keyboard shortcuts, listed in the shell's shortcuts panel (the "?" key). Plain module: safe to import on the server. */
export const DESK_SHORTCUTS: ShortcutGroup[] = [
  {
    title: "On the desk",
    items: [
      { keys: ["J"], label: "Next message" },
      { keys: ["K"], label: "Previous message" },
      { keys: ["E"], label: "Edit the draft, or write the reply" },
      { keys: ["Ctrl", "Enter"], label: "Send the reply (Cmd on a Mac)" },
      { keys: ["X"], label: "Escalate to a clinician" },
      { keys: ["/"], label: "Search the queue" },
    ],
  },
  {
    title: "Anywhere",
    items: [
      { keys: ["?"], label: "Show keyboard shortcuts" },
      { keys: ["Esc"], label: "Cancel an edit, close menus and panels" },
    ],
  },
];
