"use client";

import { useCallback, useEffect, useRef } from "react";
import { useToast } from "@/components/ui";
import { useSession } from "@/lib/client/session";
import type { UndoableType } from "@/lib/client/session-state";

/** The newest clinician toast that may undo. Toasts stack, so an older toast's Undo must not reverse a newer action. */
let latest = 0;

/**
 * Undo for a clinician toast. Call it right after an action succeeded, and pass the result as the toast's onUndo. It
 * undoes only while that action is still the most recent one, like the desk; otherwise it says so and changes nothing.
 */
export function useClinicianUndo() {
  const session = useSession();
  const { toast } = useToast();
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  });

  return useCallback(
    (type: UndoableType, messageId: string) => {
      const token = ++latest;
      return () => {
        const s = sessionRef.current;
        const last = s.lastAction;
        if (token !== latest || last?.type !== type || last.messageId !== messageId) {
          toast({
            message: "Only your most recent action can be undone",
            detail: "Something newer was recorded after this one.",
          });
          return;
        }
        const undone = s.undo();
        if (undone) {
          latest++;
          toast({ message: `Undone: ${undone.label.toLowerCase()}` });
        }
      };
    },
    [toast],
  );
}
