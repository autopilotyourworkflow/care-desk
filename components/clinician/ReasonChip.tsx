import { HeartCrack, MessageCircleWarning, Pill, Siren, Stethoscope, UserRound } from "lucide-react";
import type { SafetyCategory } from "@/lib/types";
import { Chip, type IconType } from "@/components/ui";
import type { DeskRow } from "@/lib/client/queue";
import { reasonCategory } from "./model";

const ICON: Record<SafetyCategory, IconType> = {
  clinical_question: Stethoscope,
  side_effect: Pill,
  adverse_event: Siren,
  crisis: MessageCircleWarning,
  bereavement: HeartCrack,
};

/** The reason in plain words, as a pill with an icon: "Crisis language", "Side effect", "Escalated by an agent". */
export function ReasonChip({ row, size = "sm" }: { row: DeskRow; size?: "sm" | "md" }) {
  const cat = reasonCategory(row);
  if (cat) return <Chip category={cat} icon={ICON[cat]} size={size} />;
  if (row.escalatedByAgent) {
    return (
      <Chip tone="info" icon={UserRound} size={size}>
        Escalated by an agent
      </Chip>
    );
  }
  return (
    <Chip
      tone={row.status === "urgent" ? "urgent" : "clinician"}
      icon={row.status === "urgent" ? Siren : Stethoscope}
      size={size}
    >
      {row.status === "urgent" ? "Urgent safety check" : "Clinical review"}
    </Chip>
  );
}
