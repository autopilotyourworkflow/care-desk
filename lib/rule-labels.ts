/**
 * Plain display labels for safety rule ids, for the screens that name a rule (the trail's rule tooltip). The chip next
 * to a match already says the category ("Crisis language", "Adverse event"), so a label is only kept here when it says
 * more than the category does; any other rule reads as its category alone. Rule ids stay in the tooltip too, after the
 * plain words, for anyone who wants to look a rule up.
 *
 * Tiny and dependency free (types and constants only), so any screen can import it without the pipeline. Every
 * message and patient is fictional demo material.
 */
import { AGENT_DEATH_RULE_ID, LIVING_PATIENT_RULE_ID, RELATIVE_DEATH_RULE_ID } from "@/lib/pipeline/death";

export const RULE_LABELS: Readonly<Record<string, string>> = {
  // Crisis
  "crisis.stockpile": "Keeping doses back",
  "crisis.plan_signal": "Words that point to a plan",
  "crisis.be_with_them": "Wants to be with someone who has died",
  "crisis.helpline": "Mentions a crisis line",
  "crisis.worthless": "Feeling worthless or hating being alive",
  "crisis.weapon_on_self": "A weapon turned on themselves",
  "crisis.for_when": "Doses kept for a moment later on",
  "crisis.skip_to_save": "Skipping doses to save them",
  "crisis.last_message": "Calls this their last message",
  "crisis.say_goodbye": "Wants to say goodbye",
  "crisis.quiet_farewell": "A quiet farewell",
  "crisis.means_and_end": "A means and a final phrase together",
  // Bereavement
  "bereavement.idiom": "A death told in an everyday saying",
  "bereavement.own_life": "Reported they took their own life",
  "bereavement.rites": "Memorial, cremation or service",
  "bereavement.patient_gone": "Says the patient has gone",
  [RELATIVE_DEATH_RULE_ID]: "A relative's death, told by the patient",
  [AGENT_DEATH_RULE_ID]: "A death told in an earlier reply by the team",
  // Adverse events
  [LIVING_PATIENT_RULE_ID]: "The writer is the patient, still using their treatment",
  "adverse.disoriented": "Sudden confusion",
  "adverse.poisons_line": "Mentions the Poisons line",
  "adverse.early_run_out": "Supply used up far too early",
  "adverse.prescribed_overuse": "More than the prescribed amount",
  "adverse.finished_early": "Supply finished within days",
  "adverse.high_temperature": "High temperature",
  "adverse.fall_injury": "Fall with an injury",
  "adverse.road_accident": "Road accident after a dose",
  "adverse.too_often": "Taking it far too often",
  "adverse.others_medicine": "Taking someone else's medicine",
  "adverse.serious_signs": "A serious sign in everyday words",
  // Side effects
  "side_effect.tingling": "Tingling or numbness",
  "side_effect.swelling_limbs": "Swollen ankles, feet or legs",
  // Clinical questions
  "clinical.dose_change": "A change of amount",
  "clinical.max_amount": "Asks for the most they may take",
  "clinical.claimed_authority": "Claims to be a clinician, or asks to leave one out",
  "clinical.is_normal": "Asks whether an effect is normal",
  "clinical.route": "How the product is taken",
  "clinical.pet_use": "Using it on a pet",
};

/**
 * The rule id without the pipeline's source prefix: a hit found in an earlier message ("thread.crisis.stockpile") is the
 * same rule. The team-reply death rule ("thread.agent.condolence") keeps its own id.
 */
export function baseRuleId(ruleId: string): string {
  if (ruleId === AGENT_DEATH_RULE_ID) return ruleId;
  return ruleId.replace(/^thread\./, "");
}

/** The plain label for one rule id, or undefined when the category chip already says it all. */
export function ruleLabel(ruleId: string): string | undefined {
  return RULE_LABELS[ruleId] ?? RULE_LABELS[baseRuleId(ruleId)];
}

/**
 * The tooltip for a group of matched rules: the plain labels first, then the rule ids ("Keeping doses back; Words
 * that point to a plan. Rules crisis.stockpile, crisis.plan_signal"). With no label beyond the category, only the ids.
 */
export function ruleTooltip(ruleIds: readonly string[]): string {
  const ids = Array.from(new Set(ruleIds));
  const labels = Array.from(new Set(ids.map(ruleLabel).filter((l): l is string => !!l)));
  const idText = `${ids.length > 1 ? "Rules" : "Rule"} ${ids.join(", ")}`;
  return labels.length ? `${labels.join("; ")}. ${idText}` : idText;
}
