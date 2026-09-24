/**
 * The Claude-powered half of the pipeline: sorting a message and drafting a reply.
 *
 * Runs in Node 24 (scripts via tsx), in the browser (types only; the key never reaches a browser) and inside a
 * Cloudflare Worker. The official @anthropic-ai/sdk is fetch-based and works in all three. It is imported lazily so a
 * UI bundle that imports this module for its types or the mock does not pull the SDK in. The API key is always passed
 * in; nothing in lib/ reads process.env.
 */
import type { Category, Draft, Citation, Risk, Route, SafetyCategory, SortResult, SourceRef, Usage } from "../types";
import { ROUTINE_CATEGORIES, SAFETY_CATEGORIES } from "../types";
import {
  ALL_CATEGORIES,
  DRAFT_SCHEMA,
  DRAFT_SYSTEM_PROMPT,
  SORT_SCHEMA,
  SORT_SYSTEM_PROMPT,
  buildDraftUserPrompt,
  buildSortUserPrompt,
  type DraftPromptInput,
  type SortPromptInput,
} from "./prompts";
import { costUsd } from "./pricing";
import { checkRules, primarySafetyCategory } from "./rules";
import { DEMO_TODAY } from "./check";
import { CATEGORY_LABEL } from "../format";

/**
 * Model choice (model ids and capabilities confirmed against the Models API on 2026-09-24):
 *  - Sorting is a short classification into a fixed JSON schema on every message, so it uses the small fast model,
 *    Claude Haiku 4.5 ($1 input / $5 output per million tokens). It supports structured outputs; it does not take the
 *    effort parameter, and thinking stays off for speed.
 *  - Drafting is the patient-facing text, so it uses Claude Opus 5.5 ($4 / $20 per million tokens; newer, stronger
 *    and cheaper than Opus 5), with adaptive thinking (the only thinking mode Opus 5.5 takes) at "medium" effort: the
 *    replies are short and source-bound, and medium keeps the live box well inside its daily spend cap. Server-side
 *    refusal fallbacks ("default" mode) are on for the Opus 5 line, including Opus 5.5.
 * Override per call with createClaudeClient(key, { sortModel, draftModel }); scripts and the Worker read
 * CARE_DESK_SORT_MODEL / CARE_DESK_DRAFT_MODEL from their own environment and pass them in.
 */
export const MODEL_CONFIG = {
  sortModel: "claude-haiku-4-5",
  draftModel: "claude-opus-5-5",
  draftEffort: "medium" as "low" | "medium" | "high" | "xhigh" | "max",
  timeoutMs: 30_000,
  maxRetries: 2,
  sortMaxTokens: 2048,
  draftMaxTokens: 8000,
};

export type SortInput = SortPromptInput;
export type DraftInput = DraftPromptInput;

export interface LlmClient {
  sort(input: SortInput): Promise<{ sort: SortResult; usage: Usage; model: string }>;
  draft(input: DraftInput): Promise<{ draft: Draft; usage: Usage; model: string }>;
}

export type LlmErrorKind = "unavailable" | "invalid_output" | "refusal";

/** Every failure from an LlmClient is one of these. `usage` is set when tokens were spent before the failure. */
export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly usage?: Usage;
  readonly model?: string;
  constructor(kind: LlmErrorKind, message: string, opts: { usage?: Usage; model?: string; cause?: unknown } = {}) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
    this.usage = opts.usage;
    this.model = opts.model;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

// ---------- Validation (strict: anything off becomes an LlmError, which the pipeline routes to a person) ----------

const CATEGORY_SET = new Set<string>(ALL_CATEGORIES);
const RISKS: readonly Risk[] = ["routine", "clinical", "urgent"];
const ROUTES: readonly Route[] = ["draft", "person", "clinician", "urgent"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Returns the validated sort, or a reason string when the output is invalid. */
export function validateSort(raw: unknown): SortResult | string {
  if (!isRecord(raw)) return "not an object";
  const { category, risk, route, confidence, reasons, holdOrders } = raw;
  if (typeof category !== "string" || !CATEGORY_SET.has(category)) return "unknown category";
  if (typeof risk !== "string" || !RISKS.includes(risk as Risk)) return "unknown risk";
  if (typeof route !== "string" || !ROUTES.includes(route as Route)) return "unknown route";
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)
    return "confidence out of range";
  if (!Array.isArray(reasons) || reasons.some((r) => typeof r !== "string")) return "reasons not a list of strings";
  const cleanReasons = (reasons as string[]).map((r) => sanitizeDashes(r.trim())).filter(Boolean).slice(0, 3);
  if (cleanReasons.length === 0) return "no reasons given";
  if (typeof holdOrders !== "boolean") return "holdOrders not a boolean";
  return {
    category: category as Category,
    risk: risk as Risk,
    route: route as Route,
    confidence,
    reasons: cleanReasons,
    holdOrders,
  };
}

const MIN_WORDS = 25; // the prompt asks for 50 to 160; this is the hard floor and ceiling
const MAX_WORDS = 220;

/** Returns the validated draft (markers mapped to source ids), or a reason string when the output is invalid. */
export function validateDraft(raw: unknown, sources: SourceRef[]): Draft | string {
  if (!isRecord(raw)) return "not an object";
  const { declined, text } = raw;
  if (typeof declined !== "string" || typeof text !== "string") return "missing fields";
  if (declined.trim()) return { text: "", citations: [], declined: sanitizeDashes(declined.trim()) };
  const clean = sanitizeDashes(text.trim());
  if (!clean) return "empty reply";
  const words = clean.split(/\s+/).filter(Boolean).length;
  if (words < MIN_WORDS || words > MAX_WORDS) return `reply length ${words} words`;
  const citations = extractCitations(clean, sources);
  if (typeof citations === "string") return citations;
  if (citations.length === 0) return "no source cited";
  return { text: clean, citations };
}

/** Maps every [n] marker in the text to sources[n - 1]. Returns a reason string if a marker points nowhere. */
export function extractCitations(text: string, sources: SourceRef[]): Citation[] | string {
  const seen = new Map<string, Citation>();
  for (const m of text.matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(m[1]);
    const src = sources[n - 1];
    if (!src) return `marker [${n}] has no source`;
    if (!seen.has(m[0])) seen.set(m[0], { marker: m[0], sourceId: src.id });
  }
  return [...seen.values()];
}

/** Replaces en and em dashes: numeric ranges become "to", anything else becomes a comma. */
export function sanitizeDashes(s: string): string {
  return s
    .replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, "$1 to $2")
    .replace(/\s*[\u2013\u2014]\s*/g, ", ")
    .replace(/,\s*,/g, ",");
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// ---------- Claude client ----------

export interface ClaudeClientOptions {
  sortModel?: string;
  draftModel?: string;
  timeoutMs?: number;
  /** SDK retries on 408, 409, 429, 5xx and connection errors. */
  maxRetries?: number;
  draftEffort?: (typeof MODEL_CONFIG)["draftEffort"];
}

/** The parts of a Messages API response we read. Structural, so it fits both the stable and beta response types. */
interface ResponseLike {
  model: string;
  stop_reason: string | null;
  content: ReadonlyArray<{ type: string; text?: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
}

function toUsage(res: ResponseLike): Usage {
  const u = res.usage;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  return {
    inputTokens: u.input_tokens + cacheWrite + cacheRead,
    outputTokens: u.output_tokens,
    costUsd: costUsd(res.model, {
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheWriteTokens: cacheWrite,
      cacheReadTokens: cacheRead,
    }),
  };
}

function readJson(res: ResponseLike, what: string): { json: unknown; usage: Usage } {
  const usage = toUsage(res);
  if (res.stop_reason === "refusal") {
    throw new LlmError("refusal", `The model declined to ${what}`, { usage, model: res.model });
  }
  if (res.stop_reason === "max_tokens") {
    throw new LlmError("invalid_output", `The ${what} answer was cut off`, { usage, model: res.model });
  }
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  const json = parseJsonText(text);
  if (json === undefined) {
    throw new LlmError("invalid_output", `The ${what} answer was not valid JSON`, { usage, model: res.model });
  }
  return { json, usage };
}

/** The Opus 5 line (Opus 5, Opus 5.5) and the Fable line take server-side refusal fallbacks; smaller models do not need them. */
function supportsFallbacks(model: string): boolean {
  return /^claude-(opus-5|fable-5)/.test(model);
}

/** Haiku 4.5 rejects the effort parameter; current Opus, Sonnet and Fable models accept it. */
function supportsEffort(model: string): boolean {
  return !/haiku/.test(model);
}

type AnthropicCtor = (typeof import("@anthropic-ai/sdk"))["default"];
type AnthropicInstance = InstanceType<AnthropicCtor>;

export function createClaudeClient(apiKey: string, options: ClaudeClientOptions = {}): LlmClient {
  if (!apiKey) throw new Error("createClaudeClient needs an API key");
  const sortModel = options.sortModel || MODEL_CONFIG.sortModel;
  const draftModel = options.draftModel || MODEL_CONFIG.draftModel;
  const draftEffort = options.draftEffort || MODEL_CONFIG.draftEffort;
  const timeout = options.timeoutMs ?? MODEL_CONFIG.timeoutMs;
  const maxRetries = options.maxRetries ?? MODEL_CONFIG.maxRetries;

  let instance: Promise<AnthropicInstance> | undefined;
  const client = () => {
    instance ??= import("@anthropic-ai/sdk").then((mod) => new mod.default({ apiKey, timeout, maxRetries }));
    return instance;
  };

  async function call<T>(what: string, model: string, fn: (c: AnthropicInstance) => Promise<T>): Promise<T> {
    try {
      return await fn(await client());
    } catch (err) {
      if (err instanceof LlmError) throw err;
      const status = isRecord(err) && typeof err.status === "number" ? ` (HTTP ${err.status})` : "";
      const msg = err instanceof Error ? err.message : String(err);
      throw new LlmError("unavailable", `Claude could not ${what}${status}: ${msg}`, { model, cause: err });
    }
  }

  return {
    async sort(input) {
      return call("sort the message", sortModel, async (c) => {
        const res = (await c.messages.create({
          model: sortModel,
          max_tokens: MODEL_CONFIG.sortMaxTokens,
          system: [{ type: "text", text: SORT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: buildSortUserPrompt(input) }],
          output_config: { format: { type: "json_schema", schema: SORT_SCHEMA as unknown as Record<string, unknown> } },
        })) as unknown as ResponseLike;
        const { json, usage } = readJson(res, "sort the message");
        const sort = validateSort(json);
        if (typeof sort === "string") {
          throw new LlmError("invalid_output", `The sort answer was invalid: ${sort}`, { usage, model: res.model });
        }
        return { sort, usage, model: res.model };
      });
    },

    async draft(input) {
      return call("draft a reply", draftModel, async (c) => {
        const format = { type: "json_schema" as const, schema: DRAFT_SCHEMA as unknown as Record<string, unknown> };
        const output_config = supportsEffort(draftModel) ? { effort: draftEffort, format } : { format };
        const base = {
          model: draftModel,
          max_tokens: MODEL_CONFIG.draftMaxTokens,
          system: [{ type: "text" as const, text: DRAFT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } }],
          messages: [{ role: "user" as const, content: buildDraftUserPrompt(input) }],
          output_config,
        };
        const res = (
          supportsFallbacks(draftModel)
            ? await c.beta.messages.create({
                ...base,
                betas: ["server-side-fallback-2026-07-01"],
                fallbacks: "default",
              })
            : await c.messages.create(base)
        ) as unknown as ResponseLike;
        const { json, usage } = readJson(res, "draft a reply");
        const draft = validateDraft(json, input.sources);
        if (typeof draft === "string") {
          throw new LlmError("invalid_output", `The draft was invalid: ${draft}`, { usage, model: res.model });
        }
        return { draft, usage, model: res.model };
      });
    },
  };
}

// ---------- Mock client (deterministic sample sorter and drafter) ----------
//
// Used before a real API key is available, and as the graceful fallback when Claude is unavailable or the live box's
// spend cap is reached (RunOptions.fallbackLlm). Its results are always labelled with the model "mock", and the
// pipeline marks them as demo mode, so they are never mistaken for Claude's output.

export const MOCK_MODEL = "mock";

/** True when a model id belongs to the deterministic sample client. */
export function isMockModel(model: string | undefined): boolean {
  return !!model && model.startsWith(MOCK_MODEL);
}

type Rule = { category: Category; words: RegExp };

const URGENT_SET: ReadonlySet<Category> = new Set<Category>(["crisis", "adverse_event", "bereavement"]);
const CLINICIAN_SET: ReadonlySet<Category> = new Set<Category>(["side_effect", "clinical_question"]);

/**
 * The sample sorter's own safety words, checked alongside the real safety rules (see mockSort). Broader than the rules
 * on purpose: this client is the fallback when Claude is unavailable, so it has to be a second layer on its own.
 *
 * Written from general symptom and crisis vocabulary, never copied from the test set's messages: the red-team slice
 * (MSG-0901 onwards) is held out from tuning, so its score measures how well these patterns generalise.
 */
const MOCK_SAFETY: Rule[] = [
  {
    category: "crisis",
    words:
      /suicid|kill myself|end (it all|my life)|hurt(ing)? myself|self.?harm|don'?t (want|wanna) to (be here|live|go on)|don'?t (want|wanna) (be|b) here|do something (stupid|silly|drastic)|having (those |the |bad |dark |horrible )?thoughts|thoughts (again|are back|of (ending|hurting|dying|not))|dark thoughts|not (going to|gonna) be (around|here)|won'?t be (around|here)|letters? (to|for) my (kids|children|family|son|daughter|wife|husband|partner|mum|mom|dad)|sorted (out )?(all )?my affairs|affairs in order|where i'?m going|(no|don'?t see the|can'?t see the|not much) point (anymore|any more|in (going on|carrying on|living|anything|being here))|better off without me|(manage|cope|be) (fine|better) without me|ending (it|things)|can'?t (go on|do this anymore|do this any more|take (it|this) (anymore|any more))|say(ing)? goodbye|(never|not) (want to |wanna )?wake up|go to sleep and (not|never)|(sleep|asleep) (forever|for good)|(take|taking|end|ending) (my|her|his|their) own life|kill(ing)? (herself|himself|themselves)|suicidal|every ?thing'?s pointless|what'?s the point|won'?t (need|be needing) (any|it|them|anything) (more|anymore|any more)|giving (my|his|her) things away|(want|wanna|going) to die\b/i,
  },
  {
    category: "bereavement",
    words:
      /\b(mum|mom|dad|husband|wife|partner|father|mother|son|daughter|brother|sister|patient|she|he)\b[^.]{0,40}\b(pas+ed away|passed on|died|has died|death|is gone|lost (her|his) (fight|battle)|no longer with us)\b|\b(late (wife|husband|mother|father|mum|dad|partner))\b|\bpas+ed away\b|\b(we|i)('ve| have)? (just |sadly )?lost (him|her)\b(?! (card|order|parcel|package|password|details|number|login|script|prescription|oil|spray|capsules|bottle|box|account|email|phone|address|keys?|wallet|purse)\b)|\blost (my|our) (mum|mom|dad|husband|wife|partner|mother|father|son|daughter|brother|sister)\b/i,
  },
  {
    category: "adverse_event",
    words:
      /hospital|ambulance|emergency|\bED\b|\ba ?(&|and) ?e\b|urgent care|admitted|seizure|\bfits?\b|convuls|chest pain|faint|passed out|collaps|unconscious|psychosis|hallucinat|paranoi|hearing (things|voices)|allerg(ic|y) reaction|swell(ing|ed) (up|face|throat|lips|tongue)|overdos(?!\w* of (?:emails?|messages?|texts?|marketing|spam|notifications?|reminders?|updates)\b)|took too much|taken too much|double dose|(son|daughter|kid|child|toddler|baby|grandson|granddaughter|dog|cat|puppy|kitten)\b[^.]{0,20}\b(took|taken|ate|eaten|drank|drunk|swallowed|got into|chewed|licked)|took some of my|swallowed|floppy|turn(ed|ing)? (blue|grey|gray)|can'?t (breathe|wake)|trouble breathing|short of breath|\bana?(ph|f)\w*(lact|lax)\w*|\banaph\w*|(lips?|tongue|face|throat|eyes?) (have |has |had |is |are |went |gone |feels? |getting |got )*(all |really |very |a bit )?(puffy|swollen|swelling|tight|closing|thick)|throat (is )?(closing|tight|swelling)|stroke\b|slurr(ed|ing)|(face|mouth) (is )?droop|blacked out|\ber\b|\bicu\b|intensive care/i,
  },
  {
    category: "side_effect",
    words:
      /side effect|dizz|nause|drowsy|headache|anxious since|dry mouth|feel(ing)? (sick|strange|weird|off|funny|awful|terrible)|vomit|rash|palpitat|racing heart|shaky|shaking|heart (\w+ ){0,4}(skipping|racing|pounding|fluttering|thumping)|irregular heart|groggy|unsteady|off balance|not quite (right|myself)|foggy|spaced out/i,
  },
  {
    category: "clinical_question",
    words:
      /\bdose\b|dosage|how much (should|can) i take|pregnan|breastfeed|alcohol|drink|\bdrive\b|driving|interact|other medication|antidepressant|medicaci|medikament|m[eé]dicament|farmac|safe to (use|take)|still (safe|ok|okay) to|antidep\w*|(other|new|different|heart|blood pressure|gp'?s?|doctor'?s?) (medication|meds|tablets|pills|medicine)|(medication|meds|tablets|pills|medicine) (for|from) (my|the|his|her) (gp|doctor|heart|blood|pressure)|at the same time as|alongside|(baby|bub) (is )?on the way|keep (using|taking) (my|the|it)|should i stop (using|taking)|(have|take|use) (it|my|his|her|the) (oil|capsules|spray|medicine) (with|at the same time|alongside|while)/i,
  },
];

/**
 * Words that might carry risk even when no safety pattern matches. The sample sorter never drafts a reply to a message
 * containing any of them: it goes to a person at low confidence, with the reason "Might need a closer look".
 * Any word with a letter outside plain English (other than the common te reo Maori greetings) is here too: a phrase in
 * another language inside an English message may say something the sample sorter cannot read.
 */
const CONCERN =
  /\bthoughts?\b|\bstupid\b|\baffairs\b|\bletters? to\b|\bnot be around\b|\bwhere i'?m going\b|\bhosp\w*|\badmitted\b|\bicu\b|\bintensive care\b|\ba ?(&|and) ?e\b|\ber\b|\bon the floor\b|\bfloppy\b|\bblue\b|\bgr[ae]y\b|\byellow\b|\bfits?\b|\bturns?\b|\btook some\b|\bmore than (i|prescribed|usual|normal|my|he|she|they|it said)\b|\bstruggl\w*|\bcan'?t cope\b|\bscared\b|\bfrightened\b|\bterrified\b|\bcrying\b|\bdesperate\b|\bpanic\w*|\bunwell\b|\bsick\b|\bill\b|\bpain\b|\bhurt\w*|\bworse\b|\bdying\b|\bdied\b|\bdead\b|\bdeath\b|\bfuneral\b|\bpassed\b|\blost (?:him|her|them)\b|\bclose (?:his|her|their) account\b|\bgp\b|\bdoctor\b|\bnurse\b|\bsurgery\b|\boperation\b|\bpregnan\w*|\bbaby\b|\bkids?\b|\bchild\w*|\bpets?\b|\bdog\b|\bcat\b|\bshaking\b|\bweird\b|\bstrange\b|\bnot doing (?:well|great|good|ok|okay)\b|\bnot (?:ok|okay|coping|myself)\b|\bdepress\w*|\banxi\w*|\bstress\w*|\boverwhelm\w*|\blonely\b|\balone\b|\bpointless\b|\bhopeless\b|\bworthless\b|\btired of\b|\bexhausted\b|\bawful\b|\bhorrible\b|\bnumb\b|\bgiv(?:e|ing) up\b|\bgoodbye\b|\bfor good\b|(?<!\b(?:took|takes|taking|take|wait|waited|waiting|been|ages|like) )\bforever\b|\bsleep\b|\basleep\b|\bnot wake\b|\bwobbly\b|\bgroggy\b|\bunsteady\b|\bpuffy\b|\bswollen\b|\bskipping\b|\bexpecting\b|\bheart\b|\bblood\b|\bbreath\w*|\baccident\b|\bown life\b|(?<!\p{L})(?!(?:ng[aā]|t[eē]n[aā]|m[oō]rena|wh[aā]nau|k[oō]rero|m[aā]ori)(?!\p{L}))\p{L}*[^\p{ASCII}\P{L}]\p{L}*/iu;

/**
 * A message about someone else's account, or about losing someone, is never drafted by the sample sorter: a person
 * checks it, with the orders on hold, in case it reports a death the rules did not catch.
 */
const THIRD_PARTY =
  /\b(?:his|her|their) (?:account|orders?|plan|card|deliveries|subscription)\b|\bon behalf of\b|\b(?:we|i)(?:'ve| have)? lost (?:him|her|them)\b/i;

export type SafetyNetLevel = "urgent" | "clinician" | "concern";

export interface SafetyNetHit {
  level: SafetyNetLevel;
  /** The safety category for an urgent or clinician hit. */
  category?: SafetyCategory;
  phrase: string;
  index: number;
}

/**
 * The deterministic second net: the sample sorter's safety words, usable on their own when no sorter ran. An urgent
 * category (crisis, bereavement, adverse event) is checked before a clinician one, then the "closer look" words and
 * messages about someone else's account. Pure, no AI.
 */
export function safetyNet(text: string): SafetyNetHit | undefined {
  if (!text) return undefined;
  for (const pass of [URGENT_SET, CLINICIAN_SET]) {
    for (const r of MOCK_SAFETY) {
      if (!pass.has(r.category)) continue;
      const m = r.words.exec(text);
      if (m) {
        return { level: pass === URGENT_SET ? "urgent" : "clinician", category: r.category as SafetyCategory, phrase: m[0], index: m.index };
      }
    }
  }
  const m = THIRD_PARTY.exec(text) ?? CONCERN.exec(text);
  return m ? { level: "concern", phrase: m[0], index: m.index } : undefined;
}

/**
 * Checked in order on the latest message, sentence by sentence; the first match wins. All of these go to a person.
 * `unless` skips a sentence that only offers a phone number ("you can ring me on [PHONE] if that is easier").
 */
const MOCK_PERSON: (Rule & { unless?: RegExp })[] = [
  { category: "other", words: /referral|discount code|promo code|voucher|coupon|refer a friend/i },
  {
    category: "privacy_request",
    words:
      /delete (all )?(of )?(the |my |any )?(personal )?(data|information|details|records)|delete my account|personal (data|information)|privacy|\bmy data\b|unsubscribe|marketing|copy of (my|the|all) (data|information|records)|(what|which) (data|information) you hold/i,
  },
  {
    category: "complaint",
    words:
      /complain|unacceptable|disgust|terrible|appalling|\bworst\b|fed up|raging|ridiculous|not good enough|disgrace|shocking|furious|livid|fuming|poor service|useless|so disappointed|really disappointed|on record|shouldn'?t have to|should not have to|chase (it|this|you)? ?twice|round in circles/i,
    unless: /not (complaining|a complaint)|no complaints?/i,
  },
  {
    category: "wants_human",
    words:
      /real person|actual person|speak (to|with) (a|an|someone|somebody)\b|talk (to|with) (a|an|someone|somebody)\b|\b(a|real|actual) human\b|\b(ring|call|phone) me\b|give me a (call|ring|bell)\b|someone (to )?(call|ring|phone)\b|\bcall ?back\b|over the phone/i,
    unless: /if (that is|that's|it is|it's|you) (easier|prefer|need)|feel free|you can (ring|call|phone) me/i,
  },
];

const MOCK_ROUTINE: Rule[] = [
  {
    category: "price_change",
    words: /price|went up|gone up|go up|increase|more expensive|concession|cost more|pension|went down|cheaper|community services card|health care card|different amount/gi,
  },
  {
    category: "delivery_problem",
    words:
      /\blate\b|\blost (?:in the (?:post|mail)|in transit|my (?:order|parcel|package|delivery))\b|\b(?:order|parcel|package|delivery|box) (?:(?:was|is|has|have|been|got|went|seems|must|be|gone) )*lost\b|damaged|wrong (address|item|product)|missed (me|the|my|delivery)|redeliver|not (arrived|here|received)|hasn'?t (arrived|come|turned up)|never (arrived|came|turned up)|still (nothing|nothin|waiting)|no parcel|leak|broken|crack|signature|sign for|depot|card through|parcel locker|safe place|leave (it|them|the (parcel|package|box|order)|my (parcel|package|order)) (at|on|by|in|with)|front door|at the door|authority to leave|redirect|moving (house|to|from)|new address|delivered but|deliver (there|to)/gi,
  },
  {
    category: "order_status",
    words:
      /where('?s| is)( my)? (order|parcel|package|ORD-\d+)|where'?s ORD-\d+|wheres my|tracking|shipped|dispatched|posted|sent out|when('?s| will| is) .{0,40}(arrive|ship|be sent|go out|get (here|to)|gonna get)|order status|on its way|any update|update on my order|dispensing|next order|when (is|does) my (order|parcel|package|delivery|oil|next order)|how long (does|do|will|would|should) (\w+ ){0,3}take|delivery times?|how long (to|until|till|before) (\w+ ){0,2}(arrive|deliver|get)|up to\b|(been|got|was it|it's been) delivered|was that ORD-\d+|\bORD-\d+\b/gi,
  },
  { category: "script_renewal", words: /renew|repeats?|\bscripts?\b|prescription|running out|run out|running low|top.?up/gi },
  {
    category: "billing",
    words: /charged?|charges|refund|receipt|payment|invoice|billed|billing|debit|bank statement|card (declined|expired|details)|declined|paid|tax|pay for|money back/gi,
  },
  {
    category: "plan_change",
    words:
      /pause|cancel|\bsubscri\w*|stop sending|stop (my|the) (plan|subscription|treatment)|change (my|the) plan|switch (plan|to)|product plan|going away|overseas|travel|holiday|\bskip\b|every (2|two|3|three|other) months?|restart|resume|on hold|add (a|another|the) (product|oil|spray|capsules|second)|second (product|box)|as well as my/gi,
  },
  { category: "appointment", words: /appointment|consult|reschedule|book|booking|follow.?up|video call|phone call|clinician call/gi },
  {
    category: "account_access",
    words: /log ?in|password|sign in|locked out|email address|new address for emails|new email|change (the|my) email|email on (my|the) account|my emails|reset link|verification code|sms code|two.?step|account access|can'?t get into/gi,
  },
  {
    category: "product_question",
    words: /in stock|out of stock|packag|\bstor(e|ed|ing|age)\b|fridge|substitut|availab|discreet|plain box|bottle size|dropper|nozzle|cloudy|thick|dispose|disposal|label/gi,
  },
];

/**
 * Sentences that carry no request and no risk: greetings, thanks, sign-offs, placeholders and short courtesies.
 * Any other sentence must match a routine type, or the sample sorter will not draft (see mockSort).
 */
const BENIGN =
  /^(?:hi|hiya|hello|hey|dear|good (?:morning|afternoon|evening|day)|kia ora|tena koe|morena|g'?day|thanks|thank you|many thanks|thanks so much|cheers|regards|kind regards|best|best wishes|warm regards|all the best|ta|sorry|apologies|please|yes|no|ok|okay|hope you'?re well|hope you are well|i hope this finds you well|appreciate it|much appreciated|nga mihi|ngā mihi|diolch|sent from my \w+)\b/i;

/** Neutral context that often surrounds a routine question: time words, channels, places, courtesy. */
const NEUTRAL =
  /\b(?:today|yesterday|tomorrow|this (?:week|month|morning|afternoon)|last (?:week|month|time)|next (?:week|month)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|since|ago|email|emails|app|website|account|bank|card|statement|work|home|address|number|thanks|thank|wondering|wonder|quick question|let me know|help|sorted|sort)\b/i;

/** Up to this many content sentences, a message is read clause by clause (see mockSort, step 4). */
const SHORT_MESSAGE_SENTENCES = 4;

function splitClauses(sentence: string): string[] {
  return sentence
    .split(/,\s+|;\s+|\s+(?:but|and also|also|though|although|because|cos|cause)\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A sentence with real words in it (not a placeholder, a sign-off name or a lone courtesy). */
function isContentSentence(s: string): boolean {
  const cleaned = s.replace(/\[[A-Z_ ]+\]/g, " ").replace(/[^\p{L}\s']/gu, " ").trim();
  const n = cleaned.split(/\s+/).filter(Boolean).length;
  return n > 2 && !BENIGN.test(cleaned);
}

function lexiconHit(s: string): boolean {
  return MOCK_ROUTINE.some((r) => {
    r.words.lastIndex = 0;
    const hit = r.words.test(s);
    r.words.lastIndex = 0;
    return hit;
  });
}

function safetySort(category: Category, reason: string): SortResult {
  const urgent = URGENT_SET.has(category);
  return {
    category,
    risk: urgent ? "urgent" : "clinical",
    route: urgent ? "urgent" : "clinician",
    confidence: 0.9,
    reasons: [reason],
    holdOrders: urgent,
  };
}

function lookCloser(): SortResult {
  return { category: "other", risk: "routine", route: "person", confidence: 0.5, reasons: ["Might need a closer look"], holdOrders: false };
}

/** The first person-handled type (complaint, privacy, a call request, a referral question) the latest message reads as. */
function personType(sentences: string[]): (typeof MOCK_PERSON)[number] | undefined {
  return MOCK_PERSON.find((r) => sentences.some((s) => r.words.test(s) && !(r.unless && r.unless.test(s))));
}

/** A message type mid-sentence, in the words every screen uses: "order status", "wants a person". */
function topicWords(category: Category): string {
  return CATEGORY_LABEL[category].toLowerCase();
}

/** "a" or "an" for the word that follows ("an order status question", "a billing question"). */
function article(phrase: string): string {
  return /^[aeiou]/i.test(phrase) ? "an" : "a";
}

/** "an order status question" */
function questionOf(category: Category): string {
  const t = topicWords(category);
  return `${article(t)} ${t} question`;
}

function personSort(category: Category, extra?: string): SortResult {
  const t = topicWords(category);
  const reason =
    category === "other"
      ? "Does not match a routine message type"
      : category === "wants_human"
        ? "Reads as a request for a person"
        : `Reads as ${article(t)} ${t}, which a person handles`;
  return {
    category,
    risk: "routine",
    route: "person",
    confidence: extra ? 0.6 : 0.9,
    reasons: extra ? [reason, extra] : [reason],
    holdOrders: false,
  };
}

/** Words that make the appointment type win over renewal or order status: "Is my renewal appointment still on?" */
const APPOINTMENT_FIRST = /\b(?:appointments?|consults?|consultation|booked|booking)\b/i;

function mockSort(input: SortInput): SortResult {
  const text = [input.text, ...(input.thread ?? []).filter((t) => t.from === "patient").map((t) => t.body)].join("\n");

  // 1. The real safety rules and the sample sorter's own safety words. An urgent match from either wins, so a
  // clinician-level rule hit ("reaction") is raised to urgent when the words say more ("my lips have gone puffy").
  const ruled = primarySafetyCategory(checkRules(text).hits);
  if (ruled && URGENT_SET.has(ruled)) return safetySort(ruled, `A safety rule matched (${topicWords(ruled)})`);
  const net = safetyNet(text);
  if (net?.level === "urgent" && net.category) {
    return safetySort(net.category, `Mentions something a clinician should see urgently (${topicWords(net.category)})`);
  }
  if (ruled) return safetySort(ruled, `A safety rule matched (${topicWords(ruled)})`);
  if (net?.level === "clinician" && net.category) {
    return safetySort(net.category, `Mentions something a clinician should see (${topicWords(net.category)})`);
  }

  const latest = input.text;
  const sentences = splitSentences(latest);

  // 2. About someone else's account, or losing someone: never drafted, and the orders wait for a person.
  if (THIRD_PARTY.test(text)) {
    return {
      category: "other",
      risk: "routine",
      route: "person",
      confidence: 0.6,
      reasons: ["Written about someone else's account or a loss, so a person checks it first"],
      holdOrders: true,
    };
  }

  // 3. Anything that might carry risk goes to a person, never to a draft (labelled with a person type when one fits).
  if (CONCERN.test(text)) {
    const p = personType(sentences);
    return p ? personSort(p.category, "Might need a closer look") : lookCloser();
  }

  const person = personType(sentences);
  if (person) return personSort(person.category);
  // Score the latest message first; the earlier patient messages break a tie or fill a gap (a short follow-up).
  const earlier = (input.thread ?? []).filter((t) => t.from === "patient").map((t) => t.body).join("\n");
  const scored = MOCK_ROUTINE.map((r) => ({
    r,
    n: (latest.match(r.words)?.length ?? 0) * 2 + (earlier.match(r.words)?.length ?? 0),
  }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  // An appointment, consult or booking named in the message wins over renewal and order status.
  const appt = scored.findIndex((x) => x.r.category === "appointment");
  if (appt > 0 && APPOINTMENT_FIRST.test(latest) && ["script_renewal", "order_status"].includes(scored[0].r.category)) {
    const [x] = scored.splice(appt, 1);
    scored.unshift({ r: x.r, n: scored[0].n + 1 });
  }
  const hits = scored.map((x) => x.r);
  if (hits.length === 0) {
    return {
      category: "other",
      risk: "routine",
      route: "person",
      confidence: 0.5,
      reasons: ["Does not match a routine message type"],
      holdOrders: false,
    };
  }
  const top = hits[0];
  const stopSending = /stop sending|cancel (my|the) (next )?order|don'?t send/i.test(latest);
  // Order status and delivery problem are answered the same way, so a tie between just those two is not unclear.
  const deliveryPair =
    hits.length === 2 && new Set(hits.map((h) => h.category)).size === 2 && hits.every((h) => h.category === "order_status" || h.category === "delivery_problem");
  const clear = hits.length === 1 || scored[0].n > scored[1].n || deliveryPair;

  // 4. A short message with a part the sample sorter cannot explain is not drafted: that part may say something it
  // cannot read ("where is my order, I'm not doing well"). Long letters carry plenty of harmless context, so there
  // the safety rules, the safety words and CONCERN above are the net.
  const content = sentences.filter(isContentSentence);
  const clauses = content.length <= SHORT_MESSAGE_SENTENCES ? content.flatMap(splitClauses).filter(isContentSentence) : [];
  const unexplained = clauses.length > 1 ? clauses.filter((s) => !lexiconHit(s) && !NEUTRAL.test(s)) : [];
  if (unexplained.length > 0) {
    return {
      category: top.category,
      risk: "routine",
      route: "person",
      confidence: 0.6,
      reasons: [`Looks like ${questionOf(top.category)}, but part of it needs a person to read`],
      holdOrders: stopSending,
    };
  }
  return {
    category: top.category,
    risk: "routine",
    route: "draft",
    // A clear winner is confident; a tie between two types is not, so it goes to a person.
    confidence: hits.length === 1 ? 0.9 : clear ? 0.82 : 0.66,
    reasons: clear
      ? [`Looks like ${questionOf(top.category)}`]
      : [`Mixes ${hits.slice(0, 2).map((h) => topicWords(h.category)).join(" and ")}`],
    holdOrders: stopSending,
  };
}

// ---- Sample drafter: short, plain replies built from the fields of the numbered sources ----
//
// Record text is never pasted into a reply: the fields a reply needs (amount, date, status, tracking) are read out
// and written as plain sentences. Policy wording is quoted only from the section that answers the message type, and
// only sentences that read well to a patient.

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
];

/** "18 September 2026" or "18 Sep 2026" -> sortable number 20260918 (0 when it is not a date). */
function dateKey(s: string | undefined): number {
  const m = /(\d{1,2}) ([A-Z][a-z]+) (\d{4})/.exec(s ?? "");
  if (!m) return 0;
  const month = MONTHS_LONG.findIndex((n) => n.slice(0, 3) === m[2].slice(0, 3)) + 1;
  return month ? Number(m[3]) * 10000 + month * 100 + Number(m[1]) : 0;
}

/** One segment of a record's text, for example field(t, "tracking") on "...; tracking CD4829103756; ...". */
function field(text: string, key: string): string | undefined {
  const m = new RegExp(`(?:^|[:;] )${key}:? ([^;]+)`).exec(text);
  return m ? m[1].trim() : undefined;
}

interface Numbered {
  s: SourceRef;
  n: number;
}

// ---- Orders ----

interface OrderFacts {
  id: string;
  status: string;
  placed?: string;
  shipped?: string;
  carrier?: string;
  tracking?: string;
  eta?: string;
  delivered?: string;
  hold?: string;
}

function orderFacts(s: SourceRef): OrderFacts {
  const t = s.text;
  return {
    id: s.id,
    status: field(t, "status") ?? "",
    placed: field(t, "placed"),
    shipped: field(t, "shipped"),
    carrier: field(t, "carrier"),
    tracking: field(t, "tracking"),
    eta: field(t, "estimated delivery"),
    delivered: field(t, "delivered"),
    hold: field(t, "hold reason"),
  };
}

function isOpen(o: OrderFacts): boolean {
  return o.status !== "delivered" && o.status !== "cancelled";
}

/** A hold reason in plain words, from the known reasons only; anything else is left out rather than pasted. */
function holdWords(reason: string | undefined): string {
  if (!reason) return "";
  if (/^payment failed/i.test(reason)) return " because the payment for it did not go through";
  if (/missed the delivery|missed delivery/i.test(reason)) return " because Courierline could not deliver it";
  if (/plan cancelled/i.test(reason)) return " because the plan was cancelled";
  return "";
}

function orderSentence(o: OrderFacts): string {
  switch (o.status) {
    case "delivered":
      return `Your order ${o.id} was delivered${o.delivered ? ` on ${o.delivered}` : ""}`;
    case "shipped": {
      let out = `Your order ${o.id} shipped${o.shipped ? ` on ${o.shipped}` : ""}${o.carrier ? ` with ${o.carrier}` : ""}`;
      if (o.tracking) out += `, and the tracking number is ${o.tracking}`;
      if (o.eta) out += `. It should arrive by ${o.eta}`;
      return out;
    }
    case "on hold":
      return `Your order ${o.id} is on hold at the moment${holdWords(o.hold)}`;
    case "waiting for script approval":
      return `Your order ${o.id}${o.placed ? `, placed on ${o.placed},` : ""} is waiting for your prescription to be approved`;
    case "being dispensed by the pharmacy":
      return `Your order ${o.id}${o.placed ? `, placed on ${o.placed},` : ""} is being prepared by the pharmacy`;
    case "cancelled":
      return `Your order ${o.id} was cancelled`;
    default:
      return `Your order ${o.id}${o.placed ? `, placed on ${o.placed},` : ""} is being processed`;
  }
}

// ---- Charges ----

interface ChargeFacts {
  id: string;
  money: string;
  status: string;
  date?: string;
  kind: string;
  concession: boolean;
  refund: boolean;
  newPriceFrom?: string;
  noticeOn?: string;
  heldForScript: boolean;
  missedConsultFee: boolean;
  shippingFee: boolean;
  cardCheck: boolean;
  orderId?: string;
  amount: number;
}

function chargeFacts(s: SourceRef): ChargeFacts {
  const body = s.text.replace(/^Charge [^:]+: /, "");
  const parts = body.split("; ");
  const desc = parts[0] ?? "";
  const moneyRaw = parts[1] ?? "";
  const refund = moneyRaw.startsWith("refund of ");
  const money = moneyRaw.replace(/^refund of /, "");
  const price = /new price from ([^,)]+), notice emailed ([^)]+)\)/.exec(desc);
  return {
    id: s.id,
    money,
    status: field(s.text, "status") ?? "",
    date: field(s.text, "charged"),
    kind: field(s.text, "type") ?? "",
    concession: /\(concession\)/.test(desc),
    refund,
    newPriceFrom: price?.[1]?.trim(),
    noticeOn: price?.[2]?.trim(),
    heldForScript: /held until the new prescription is approved/i.test(desc),
    missedConsultFee: /missed-consult fee/i.test(desc),
    shippingFee: /shipping fee/i.test(desc),
    cardCheck: /card check/i.test(desc),
    orderId: /\bORD-\d+\b/.exec(desc)?.[0],
    amount: Number((/(\d+(?:\.\d+)?)/.exec(money.replace(/,/g, "")) ?? [])[1] ?? NaN),
  };
}

function chargeWhat(c: ChargeFacts): string {
  if (c.missedConsultFee) return "a missed-consult fee";
  if (c.shippingFee) return c.orderId ? `a one-off shipping fee to send order ${c.orderId} again` : "a one-off shipping fee";
  if (c.kind === "consult") return "a consult";
  if (c.kind === "shipping") return "shipping";
  if (c.kind === "adjustment") return "an adjustment";
  return "your monthly plan";
}

function chargeSentence(c: ChargeFacts): string {
  const on = c.date ? `On ${c.date}` : "Recently";
  if (c.refund) return `${on} we refunded ${c.money} to your card${c.status === "pending" ? ", and it is still on its way" : ""}`;
  if (c.cardCheck) return `${on} a card check of ${c.money} appeared on your account. It is not a charge, and it drops off within 5 business days`;
  const what = chargeWhat(c);
  if (c.status === "failed") return `${on} we tried to take ${c.money} for ${what}, but the payment did not go through`;
  if (c.heldForScript) return `The ${c.money} charge for your monthly plan is on hold until your new prescription is approved`;
  let out = `${on} we charged ${c.money} for ${what}${c.concession ? ", at the concession price" : ""}`;
  if (c.status === "pending") out += ", and it is still pending";
  else if (c.status === "refunded") out += ", and it has since been refunded";
  return out;
}

// ---- Appointments and plan ----

function appointmentSentence(s: SourceRef): string {
  const parts = s.text.replace(/^Appointment [^:]+: /, "").split("; ");
  const kind = parts[0] ?? "consult";
  const when = (parts[1] ?? "").replace(/\s*\(patient's local time\)/, ", your local time");
  const clinician = field(s.text, "clinician");
  const status = field(s.text, "status");
  const withWho = clinician ? ` with ${clinician}` : "";
  if (status === "booked") return `Your ${kind}${withWho} is booked for ${when}`;
  if (status === "completed") return `Your last ${kind}${withWho} was on ${when}`;
  if (status === "missed") return `The ${kind}${withWho} on ${when} is marked as missed`;
  return `The ${kind}${withWho} on ${when} was cancelled`;
}

interface PlanFacts {
  status: string;
  price?: string;
  next?: string;
  concession: boolean;
}

function planFacts(s: SourceRef): PlanFacts {
  return {
    status: field(s.text, "status") ?? "active",
    price: field(s.text, "price")?.replace(/ per month$/, ""),
    next: field(s.text, "next billing date"),
    concession: /concession pricing applied/.test(s.text),
  };
}

function planSentence(p: PlanFacts): string {
  let out = `Your treatment plan is ${p.status}${p.price ? ` at ${p.price} a month` : ""}`;
  if (p.concession) out += ", with concession pricing";
  if (p.next) out += `, and your next billing date is ${p.next}`;
  return out;
}

// ---- Policy sentences ----

/** The handbook sections that answer each routine type. Nothing outside these is ever quoted. */
const POLICY_FOR: Partial<Record<Category, string[]>> = {
  order_status: ["P3.1", "P4.1"],
  delivery_problem: ["P4.2", "P4.1", "P4.3"],
  script_renewal: ["P3.2"],
  billing: ["P5.1", "P5.2", "P5.3"],
  price_change: ["P5.4"],
  plan_change: ["P6.1"],
  appointment: ["P7.1"],
  account_access: ["P8.1"],
  product_question: ["P11.1"],
};

const OTHER_COUNTRY: Record<SortInput["country"], RegExp> = {
  AU: /New Zealand|NZ\$|United Kingdom|\bUK\b|£|Universal Credit|\bNHS\b/,
  NZ: /Australia|A\$|United Kingdom|\bUK\b|£|Universal Credit|\bNHS\b|Medicare/,
  UK: /Australia|A\$|New Zealand|NZ\$|Medicare/,
};

/** Handbook sentences written about the team or the patient in the third person do not read well to a patient. */
const INTERNAL =
  /\b(?:the patient|patients?|patient's|agents?|support|team lead|pharmacist contacts|ask (?:for|the|them)|tell (?:the|them)|open a trace|share the tracking|reassure|they|them|their|nobody)\b/i;

/** Instructions to staff ("Never promise...", "...: reship at no cost") and sentences that lean on the one before. */
const STAFF_OR_DANGLING =
  /^(?:Never|Confirm|Ask|Offer|Tell|Open|Share|Put|Reply|Check|Give|Say|Escalate|Do|Don't|Follow|Work out|Make sure|Before|Support|Use|Treat|Record|Log|Note|They|It|This|These|That|Those|So|Then|Also|Otherwise|If (?:it|they|this|that))\b|[:,]\s*(?:reship|open|share|ask|tell|offer|refund|put|reply|check|confirm|escalate)\b/;

const MOCK_STOPWORDS = new Set(
  "a an and are as at be been but by can could did do does for from had has have hi hello hey how i i'm if in into is it its just me my of on or our please so that the their them then there these they this to up us was we were what when where which who why will with would you your am any get got also still thanks thank order orders plan month months know like want need cheers".split(
    " ",
  ),
);

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\[[A-Z_ ]+\]/g, " ")
    .split(/[^a-z0-9$£]+/)
    .filter((w) => w.length > 2 && !MOCK_STOPWORDS.has(w));
}

/** A policy sentence a patient can read as it is: no staff instruction, no aside, no list, no other country. */
function readable(p: string, country: SortInput["country"]): boolean {
  const wc = p.split(/\s+/).length;
  if (wc < 6 || wc > 40) return false;
  if (/[;()]/.test(p) || /:\s/.test(p) || /:\s*$/.test(p)) return false;
  return !(OTHER_COUNTRY[country].test(p) || INTERNAL.test(p) || STAFF_OR_DANGLING.test(p));
}

function sentencesOf(s: SourceRef): string[] {
  return s.text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** The first sentence of section `id` matching `re`, as written, if that section is among the sources. */
function quote(policy: Numbered[], id: string, re: RegExp): { text: string; n: number } | undefined {
  const x = policy.find((p) => p.s.id === id);
  if (!x) return undefined;
  const found = sentencesOf(x.s).find((p) => re.test(p));
  return found ? { text: found.replace(/[.!?]$/, ""), n: x.n } : undefined;
}

/**
 * Policy sentences scored against the message, from the sections that answer this message type only. A sentence
 * needs at least two words in common with the message (three when the reply already has record lines).
 */
function scoredPolicy(text: string, policy: Numbered[], category: Category, country: SortInput["country"], min: number, max: number): string[] {
  const allowed = POLICY_FOR[category] ?? [];
  const asked = new Set(words(text).map((w) => w.slice(0, 5)));
  const out: { sentence: string; n: number; score: number; order: number }[] = [];
  let order = 0;
  for (const { s, n } of policy) {
    if (!allowed.includes(s.id)) continue;
    for (const p of sentencesOf(s)) {
      order++;
      if (!readable(p, country)) continue;
      const overlap = new Set(words(p).map((w) => w.slice(0, 5)).filter((w) => asked.has(w))).size;
      if (overlap >= min) out.push({ sentence: p.replace(/[.!?]$/, ""), n, score: overlap, order });
    }
  }
  return out
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, max)
    .sort((a, b) => a.order - b.order)
    .map((c) => `${c.sentence} [${c.n}].`);
}

// ---- Per-type answers ----

interface Ctx {
  text: string;
  category: Category;
  country: SortInput["country"];
  orders: (Numbered & { o: OrderFacts })[];
  charges: (Numbered & { c: ChargeFacts })[];
  appointments: Numbered[];
  plan?: Numbered & { p: PlanFacts };
  policy: Numbered[];
}

const line = (sentence: string, ...ns: number[]) => `${sentence} ${[...new Set(ns)].map((n) => `[${n}]`).join("")}.`;

function namedFirst<T extends Numbered>(items: T[], text: string): T[] {
  const named = items.filter((x) => text.includes(x.s.id));
  return [...named, ...items.filter((x) => !named.includes(x))];
}

/** The demo's today as a sortable number, so a reply never says "should arrive by" a date that has passed. */
const TODAY_KEY = Number(DEMO_TODAY.replace(/-/g, ""));

/** Delivery windows for the patient's country, read from P4.1 so they always match the handbook. */
function deliveryWindows(policy: Numbered[], country: SortInput["country"]): { text: string; n: number } | undefined {
  const p = policy.find((x) => x.s.id === "P4.1");
  if (!p) return undefined;
  const t = p.s.text;
  const m =
    country === "AU"
      ? /Australia, metro[^:]*: (\d+ to \d+ business days)\. Australia, regional and remote: (\d+ to \d+ business days)/.exec(t)
      : country === "NZ"
        ? /New Zealand, main centres: (\d+ to \d+ business days); rural delivery: (\d+ to \d+ business days)/.exec(t)
        : /United Kingdom, mainland: (\d+ to \d+ business days); Scottish Highlands and islands, and Northern Ireland: (\d+ to \d+ business days)/.exec(t);
  if (!m) return undefined;
  const where =
    country === "AU"
      ? [`${m[1]} to capital cities and major centres`, `${m[2]} to regional and remote areas`]
      : country === "NZ"
        ? [`${m[1]} to main centres`, `${m[2]} for rural delivery`]
        : [`${m[1]} on the mainland`, `${m[2]} to the Scottish Highlands and islands, and Northern Ireland`];
  return { text: `Delivery takes ${where[0]}, and ${where[1]}, counted from dispatch`, n: p.n };
}

/** Monthly prices for the patient's country, read from P5.4. */
function countryPrices(policy: Numbered[], country: SortInput["country"]): { text: string; n: number } | undefined {
  const p = policy.find((x) => x.s.id === "P5.4");
  if (!p) return undefined;
  const t = p.s.text;
  const m =
    country === "AU"
      ? /Australia: one product (A\$\d+), two products (A\$\d+); concession (A\$\d+) and (A\$\d+)/.exec(t)
      : country === "NZ"
        ? /New Zealand, from [^:]+: one product (NZ\$\d+), two products (NZ\$\d+); concession (NZ\$\d+) and (NZ\$\d+)/.exec(t)
        : /United Kingdom: one product (£\d+), two products (£\d+); concession (£\d+) and (£\d+)/.exec(t);
  if (!m) return undefined;
  return { text: `The monthly price is ${m[1]} for one product and ${m[2]} for two, or ${m[3]} and ${m[4]} at the concession price`, n: p.n };
}

/** Who can get concession pricing in the patient's country, from P5.4. */
function concessionWho(policy: Numbered[], country: SortInput["country"]): { text: string; n: number } | undefined {
  const p = policy.find((x) => x.s.id === "P5.4");
  if (!p) return undefined;
  const t = p.s.text;
  const who =
    country === "AU"
      ? /Pensioner Concession Card or Health Care Card/.test(t) ? "an Australian Pensioner Concession Card or Health Care Card" : ""
      : country === "NZ"
        ? /Community Services Card/.test(t) ? "a New Zealand Community Services Card" : ""
        : /means-tested benefit such as Universal Credit/.test(t) ? "proof of a means-tested benefit such as Universal Credit" : "";
  const upload = /under Billing in their account/.test(t) ? ", and you can upload your card or letter under Billing in your account" : "";
  if (who && /About 20% off/.test(t)) return { text: `Concession pricing is about 20% off for holders of ${who}${upload}`, n: p.n };
  const prices = countryPrices(policy, country);
  if (upload && prices) return { text: `We do offer concession pricing${upload}`, n: p.n };
  return undefined;
}

/** The message without a quoted "Re:" subject line, so an old subject ("Re: arrived damaged") does not steer the reply. */
function latestAsk(text: string): string {
  return text.replace(/^Re:[^\n]*\n+/i, "");
}

/** Delivery topics that apply whichever order type was sorted: address changes, signatures, windows, missed cards. */
function deliveryTopics(ctx: Ctx, ask: string): string[] {
  const out: string[] = [];
  if (/leave it|front door|at the door|authority to leave|safe place|parcel locker|po box/i.test(ask)) {
    const q = quote(ctx.policy, "P4.3", /^Prescription medicines need a signature/);
    if (q) out.push(line(q.text, q.n));
  }
  if (/redirect|work address|to my work|deliver (it )?to (my )?work|new address|moving|change (my|the) address/i.test(ask)) {
    const p = ctx.policy.find((x) => x.s.id === "P4.3");
    if (p) {
      out.push(line("You can change your delivery address in your account or by message, after a quick identity check, and work addresses are fine", p.n));
      const r = quote(ctx.policy, "P4.3", /^After dispatch, we can ask Courierline to redirect the parcel/);
      if (r && ctx.orders.some((x) => x.o.status === "shipped")) out.push(line(r.text, r.n));
    }
  }
  if (/missed|card (through|in|left)|left a card|redeliver|depot|collect/i.test(ask)) {
    const p = ctx.policy.find((x) => x.s.id === "P4.3");
    if (p && /holds the parcel at the local depot for 5 business days/.test(p.s.text)) {
      out.push(line("Courierline holds the parcel at the local depot for 5 business days, and you can book a free redelivery or collect it with photo ID using the tracking link", p.n));
    }
  }
  if (/how long|deliver (there|to)|do you deliver|arrive in|take to (get|arrive)/i.test(ask)) {
    const w = deliveryWindows(ctx.policy, ctx.country);
    if (w) out.push(line(w.text, w.n));
  }
  return out;
}

function answerOrder(ctx: Ctx): string[] {
  const out: string[] = [];
  const ask = latestAsk(ctx.text);
  const orders = namedFirst(ctx.orders, ctx.text);
  const named = orders.find((x) => ctx.text.includes(x.s.id));
  const open = ctx.orders.find((x) => isOpen(x.o));
  const pick = named ?? open ?? orders[0];
  const topics = deliveryTopics(ctx, ask);
  const wrong = /wrong (item|product)|not what i ordered|packed with the wrong/i.test(ask);
  const damaged = /damaged|leak|broken|crack/i.test(ask);
  const aboutCost = /charg|pay|cost|fee/i.test(ask);

  // An address, signature or delivery-time question is answered by the policy; the order line is kept only when named.
  if (pick && (named || topics.length === 0)) {
    const o = pick.o;
    const eta = dateKey(o.eta);
    if (o.status === "shipped" && eta && eta < TODAY_KEY) {
      let s = `Your order ${o.id} shipped${o.shipped ? ` on ${o.shipped}` : ""}${o.carrier ? ` with ${o.carrier}` : ""}`;
      if (o.tracking) s += `, tracking number ${o.tracking}`;
      s += `. It was due by ${o.eta}, so it is running late, and I'm sorry about that`;
      out.push(line(s, pick.n));
      const trace = ctx.policy.find((x) => x.s.id === "P4.2");
      if (trace) out.push(line("The team will ask Courierline to trace it, and if it is lost we send a replacement at no cost", trace.n));
      return [...out, ...topics];
    }
    if (o.status === "shipped" && eta === TODAY_KEY) {
      let s = `Your order ${o.id} shipped${o.shipped ? ` on ${o.shipped}` : ""}${o.carrier ? ` with ${o.carrier}` : ""}`;
      if (o.tracking) s += `, tracking number ${o.tracking}`;
      s += `, and it is due today, ${o.eta}`;
      out.push(line(s, pick.n));
    } else {
      out.push(line(orderSentence(o), pick.n));
    }
  }

  if ((wrong || damaged) && !aboutCost) {
    const p = ctx.policy.find((x) => x.s.id === "P4.2");
    if (p) {
      out.push(
        wrong
          ? line("Please don't use it for now. A pharmacist will contact you within 1 business day, and the right item is sent at no cost", p.n)
          : line("Please don't use the damaged item. If you can, reply with a photo, and once a pharmacist has signed off we send a replacement at no cost", p.n),
      );
    }
    return [...out, ...topics];
  }
  if (/replacement|reship|resend|sent again/i.test(ask) && aboutCost) {
    const q = quote(ctx.policy, "P5.3", /^Replacements for lost, damaged or wrong orders ship free/);
    const p = ctx.policy.find((x) => x.s.id === "P4.2");
    if (q) out.push(line(q.text, q.n));
    else if (p) out.push(line("A replacement for a lost, damaged or wrong order is sent at no cost", p.n));
    return [...out, ...topics];
  }
  if (topics.length > 0) return [...out, ...topics];

  if (pick && pick.o.status === "delivered" && !named) {
    // Nothing on the way: say when the next one goes out.
    if (ctx.plan?.p.next) out.push(line(`Your next billing date is ${ctx.plan.p.next}`, ctx.plan.n));
    const dispatch = quote(ctx.policy, "P3.1", /usually dispatched 1 to 2 business days after the billing date/);
    if (dispatch && ctx.plan?.p.next) out.push(line("Repeat orders are usually dispatched 1 to 2 business days after the billing date", dispatch.n));
    return out;
  }
  if (pick?.o.status === "shipped") {
    const late = quote(ctx.policy, "P4.1", /^An order is not late until the ETA has passed/);
    if (late && ctx.category === "delivery_problem") out.push(line("An order is not late until its estimated delivery date has passed", late.n));
  } else if (pick?.o.status === "waiting for script approval") {
    const q = ctx.policy.find((x) => x.s.id === "P3.1");
    if (q) out.push(line("Approval usually takes up to 2 business days after the consult", q.n));
  } else if (pick?.o.status === "being dispensed by the pharmacy") {
    const q = ctx.policy.find((x) => x.s.id === "P3.1");
    if (q) out.push(line("The pharmacist checks and packs each order, usually within 1 business day", q.n));
  }
  return out;
}

function planCharges(ctx: Ctx) {
  return ctx.charges
    .filter((x) => x.c.kind === "plan" && !x.c.refund)
    .sort((a, b) => dateKey(b.c.date) - dateKey(a.c.date));
}

function answerPrice(ctx: Ctx): string[] {
  const out: string[] = [];
  const ask = latestAsk(ctx.text);
  const [latest, prev] = planCharges(ctx);
  const productChange = /one product|two products?|two.product|drop (the|my)|add (a|another|the)|second product|as well as my|just (the one|one)|only (the one|one)/i.test(ask);
  const concessionAsk = /concession|pension|health care card|community services card|universal credit|benefit|discount|cheaper/i.test(ask);
  const reverify = /re-?verif|checked again|check(ed)? my concession|renew(ed)? (my )?(card|concession)/i.test(ask);

  if (productChange) {
    const prices = countryPrices(ctx.policy, ctx.country);
    if (prices) out.push(line(prices.text, prices.n));
    const q = quote(ctx.policy, "P5.4", /^A change to the products on a plan changes the price from the next billing date/);
    if (q) out.push(line(q.text, q.n));
  }
  if (concessionAsk && ctx.plan && !ctx.plan.p.concession && !reverify) {
    const who = concessionWho(ctx.policy, ctx.country);
    if (who) {
      out.push(line(who.text, who.n));
      const prices = countryPrices(ctx.policy, ctx.country);
      if (prices && !productChange) out.push(line(prices.text, prices.n));
    }
  }
  if (reverify) {
    const p = ctx.policy.find((x) => x.s.id === "P5.4");
    if (p && /re-verified every 12 months/.test(p.s.text)) {
      out.push(line("Concessions are re-verified every 12 months, and you can upload your card or letter under Billing in your account", p.n));
    }
  }
  if (out.length === 0 || /went up|gone up|go up|increase|more expensive|lower|went down|less|different amount|changed?/i.test(ask)) {
    if (latest && prev && latest.c.amount === prev.c.amount) {
      out.push(line(`Your plan price has not changed. We charged ${prev.c.money} on ${prev.c.date} and the same amount on ${latest.c.date}`, prev.n, latest.n));
    } else if (latest && prev) {
      out.push(line(`Your plan charge went from ${prev.c.money} on ${prev.c.date} to ${latest.c.money} on ${latest.c.date}`, prev.n, latest.n));
      if (latest.c.newPriceFrom && latest.c.noticeOn) {
        out.push(line(`The new price applies from ${latest.c.newPriceFrom}, and we emailed notice of the change on ${latest.c.noticeOn}`, latest.n));
      } else if (latest.c.concession && !prev.c.concession) {
        out.push(line("The lower amount is the concession price, which now applies to your plan", latest.n));
      }
    } else if (latest) {
      out.push(line(chargeSentence(latest.c), latest.n));
    }
    if (latest && prev && latest.c.concession && prev.c.concession) out.push(line("Both of these were at the concession price", latest.n));
  }
  if (ctx.plan?.p.next) out.push(line(`Your next billing date is ${ctx.plan.p.next}`, ctx.plan.n));
  const notice = quote(ctx.policy, "P5.4", /^We give at least 30 days' notice\b/);
  if (notice && /email|notice|told|warn|letter/i.test(ask) && !reverify) out.push(line(notice.text, notice.n));
  return out;
}

/** A charge the patient points at: by id first, then by an amount they quote ("the £6.50 fee"). */
function chargeAskedAbout(ctx: Ctx, ask: string): (Numbered & { c: ChargeFacts }) | undefined {
  const byId = ctx.charges.find((x) => ask.includes(x.s.id));
  if (byId) return byId;
  const figures = [...ask.matchAll(/[$£]\s?(\d+(?:\.\d{1,2})?)/g)].map((m) => Number(m[1]));
  return ctx.charges.find((x) => figures.includes(x.c.amount));
}

function answerBilling(ctx: Ctx): string[] {
  const out: string[] = [];
  const ask = latestAsk(ctx.text);
  if (/lower|went down|less than|cheaper|went up|gone up|more than (last|usual)|different amount|price/i.test(ask)) return answerPrice(ctx);
  const byDate = [...ctx.charges].sort((a, b) => dateKey(b.c.date) - dateKey(a.c.date));
  const namedAll = ctx.charges.filter((x) => ask.includes(x.s.id));
  const asked = chargeAskedAbout(ctx, ask);
  const latest = asked ?? byDate.find((x) => !x.c.cardCheck) ?? byDate[0];
  const p51 = ctx.policy.find((x) => x.s.id === "P5.1");

  if (/new card|change (my|the) card|update (my|the) card|card details|card number|different card/i.test(ask)) {
    if (p51) out.push(line("You can update your card in your account under Billing, and for your security we never take card numbers by chat or email", p51.n));
    const failed = byDate.find((x) => x.c.status === "failed");
    if (failed) out.push(line(chargeSentence(failed.c), failed.n));
    return out;
  }
  if (/will i (still )?be (charged|billed)|next (charge|payment|bill)|when (will|do) (i|you) (be )?(charge|bill)|when is my (next )?payment/i.test(ask) && ctx.plan?.p.next) {
    out.push(line(`Your next billing date is ${ctx.plan.p.next}${ctx.plan.p.price ? `, for ${ctx.plan.p.price}` : ""}`, ctx.plan.n));
    return out;
  }
  if (/twice|double|two (charges|payments|lots)|charged 2|second charge/i.test(ask) && latest) {
    const month = (latest.c.date ?? "").replace(/^\d{1,2} /, "");
    const same = byDate.filter((x) => !x.c.refund && x.c.amount === latest.c.amount && (x.c.date ?? "").endsWith(month) && x.c.status !== "failed");
    if (same.length >= 2) {
      out.push(line(`I can see two charges of ${latest.c.money}, on ${same[1].c.date} and ${same[0].c.date}. The team will check them and come back to you`, same[1].n, same[0].n));
    } else {
      out.push(line(`${chargeSentence(latest.c)}, and that is the only charge I can see for it`, latest.n));
      if (p51) out.push(line("If your bank shows a second amount, it may be a card check, which can show as pending for up to 5 business days before it drops off", p51.n));
    }
    return out;
  }
  if (/replacement|reship|resend|sent again/i.test(ask)) {
    const q = quote(ctx.policy, "P5.3", /^Replacements for lost, damaged or wrong orders ship free/);
    if (q) {
      if (asked) out.push(line(chargeSentence(asked.c), asked.n));
      out.push(line(q.text, q.n));
      return out;
    }
  }
  const listed = namedAll.length > 1 ? namedAll.slice(0, 2) : latest ? [latest] : [];
  for (const x of listed) out.push(line(chargeSentence(x.c), x.n));
  if (latest?.c.missedConsultFee) {
    const p71 = ctx.policy.find((x) => x.s.id === "P7.1");
    if (p71) out.push(line("This fee applies to a second missed consult within 6 months", p71.n));
    return out;
  }
  if (latest?.c.status === "failed") {
    const p52 = ctx.policy.find((x) => x.s.id === "P5.2");
    if (p52) out.push(line("We try again 2 days and 5 days after the billing date, and there are no late fees", p52.n));
    return out;
  }
  if (/receipt|invoice/i.test(ask) && p51) {
    out.push(line(`A receipt is emailed after every charge, and I can send you ${listed.length > 1 ? "copies of these" : "a copy of this one"}`, p51.n));
    return out;
  }
  if (/refund|money back/i.test(ask)) {
    const q = quote(ctx.policy, "P5.3", /^Refunds go back to the original card/);
    if (q) out.push(line(q.text, q.n));
  }
  return out;
}

function answerPlanChange(ctx: Ctx): string[] {
  const out: string[] = [];
  const ask = latestAsk(ctx.text);
  if (ctx.plan) {
    const p = ctx.plan.p;
    out.push(line(p.status === "active" ? planSentence(p) : `Your treatment plan is ${p.status}${p.next ? `, and your next billing date is ${p.next}` : ""}`, ctx.plan.n));
  }
  const p61 = ctx.policy.find((x) => x.s.id === "P6.1");
  if (/stop sending|don'?t send|stop (all|my) orders|send (me )?nothing|nothing (more|else) (sent|to be sent)/i.test(ask) && p61) {
    out.push(line("Any order that has not been dispatched is on hold, so nothing more goes out for now", p61.n));
    out.push("Would you like to pause your plan or cancel it?");
  }
  if (/every (2|two|3|three|other) months?|two.?monthly|bi.?monthly|less often/i.test(ask) && p61) {
    out.push(line("Plans are monthly, so there is no two-monthly option, but a pause can space orders out", p61.n));
  }
  if (/pause|skip|holiday|away|overseas|travel/i.test(ask)) {
    const q = quote(ctx.policy, "P6.1", /^A plan can be paused for 1 to 3 months at a time/);
    if (q) out.push(line(q.text, q.n));
    if (q && ctx.plan?.p.next && ctx.plan.p.status === "active") {
      out.push(line(`For the pause to cover your next order, please let us know at least 3 days before your next billing date, ${ctx.plan.p.next}`, q.n, ctx.plan.n));
    }
  }
  if (/cancel/i.test(ask)) {
    const q = quote(ctx.policy, "P6.1", /^A plan can be cancelled at any time with no fee/);
    const r = quote(ctx.policy, "P6.1", /^With at least 3 days' notice before the billing date there are no further charges/);
    if (q) out.push(line(q.text, q.n));
    if (r) out.push(line(r.text, r.n));
  }
  if (/restart|resume|start (up )?again/i.test(ask) && p61) {
    out.push(line("A paused plan can restart early at any time, and the restart date becomes your new billing date", p61.n));
  }
  if (/add|drop|remove|swap|switch to the two|second product|one product|as well as my|two.product/i.test(ask) && p61) {
    out.push(line("Adding, removing or swapping a product needs a clinician's approval, and once approved the change and any new price apply from the next billing date", p61.n));
    const prices = countryPrices(ctx.policy, ctx.country);
    if (prices) out.push(line(prices.text, prices.n));
  }
  return out;
}

function answerAppointment(ctx: Ctx): string[] {
  const out: string[] = [];
  const appt = namedFirst(ctx.appointments, ctx.text)[0];
  if (appt) out.push(line(appointmentSentence(appt.s), appt.n));
  if (/move|moving|reschedul|change|another (day|time)|different (day|time)|cancel/i.test(ctx.text)) {
    const q = quote(ctx.policy, "P7.1", /^Moving or cancelling is free up to 24 hours before the consult/);
    if (q) out.push(line(`${q.text}, and the team can move it for you`, q.n));
  }
  if (/phone|video/i.test(ctx.text)) {
    const q = quote(ctx.policy, "P7.1", /^A booking can switch between phone and video/);
    if (q) out.push(line(q.text, q.n));
  }
  return out;
}

function answerRenewal(ctx: Ctx): string[] {
  const out: string[] = [];
  const pending = ctx.orders.find((x) => x.o.status === "waiting for script approval");
  const booked = ctx.appointments.find((x) => /status booked/.test(x.s.text));
  const p32 = ctx.policy.find((x) => x.s.id === "P3.2");
  if (pending) {
    out.push(line(orderSentence(pending.o), pending.n));
    const p31 = ctx.policy.find((x) => x.s.id === "P3.1");
    if (p31) out.push(line("Approval usually takes up to 2 business days after the consult", p31.n));
    if (p32) out.push(line("We only take the plan charge once the prescription is approved, so you never pay for an order that cannot be sent", p32.n));
    return out;
  }
  if (booked) out.push(line(appointmentSentence(booked.s), booked.n));
  else if (ctx.plan?.p.next) out.push(line(`Your next billing date is ${ctx.plan.p.next}`, ctx.plan.n));
  if (p32) {
    if (!booked) out.push(line("Please book a renewal consult at least 7 days before your next billing date, and it costs nothing extra on an active plan", p32.n));
    else out.push(line("A renewal can be done at a booked follow-up if it falls before the next billing date", p32.n));
    out.push(line("We email a reminder 21 days before the last repeat is used", p32.n));
  }
  return out;
}

function answerAccount(ctx: Ctx): string[] {
  const out: string[] = [];
  const p = ctx.policy.find((x) => x.s.id === "P8.1");
  if (!p) return out;
  if (/password|reset|log ?in|sign in|can'?t get into/i.test(ctx.text)) {
    out.push(line("A reset link lasts 30 minutes, and a new link cancels any older one", p.n));
    out.push(line("If the email does not arrive, please check your spam folder, then check that the email address on your account is right", p.n));
  }
  if (/locked/i.test(ctx.text)) out.push(line("Five wrong passwords lock the account for 30 minutes", p.n));
  if (/code|sms|two.?step/i.test(ctx.text)) {
    out.push(line("Two-step codes are sent by SMS to the phone number on your account, and the team can switch them to email after a quick identity check", p.n));
  }
  if (/email address|new email|change (my|the) email/i.test(ctx.text) && out.length === 0) {
    out.push(line("The team can change the email on your account after a quick identity check", p.n));
  }
  return out;
}

function answerProduct(ctx: Ctx): string[] {
  const out: string[] = [];
  const p = ctx.policy.find((x) => x.s.id === "P11.1");
  if (!p) return out;
  const different = /cloudy|thick|looks? (different|odd)|smells?|tastes?|colour|color|left (it )?(in|somewhere)|hot|not working|blocked|stuck/i.test(ctx.text);
  if (/\bstor(e|ed|ing|age)\b|fridge|keep|heat|hot|cold|cloudy|thick/i.test(ctx.text)) {
    const q = quote(ctx.policy, "P11.1", /^Keep products below 25°C/);
    if (q) out.push(line(q.text, q.n));
    if (/They do not need to go in the fridge unless the label says so/.test(p.s.text)) {
      out.push(line("Your products do not need to go in the fridge unless the label says so, and please don't leave them in a car", p.n));
    }
    if (/cloudy|thick|cold/i.test(ctx.text)) {
      const c = quote(ctx.policy, "P11.1", /^Some oils can thicken or look cloudy when cold/);
      if (c) out.push(line(c.text, c.n));
    }
  }
  if (different) {
    out.push(line("Please don't use it until a pharmacist has checked it. A pharmacist will contact you within 1 business day and arrange a replacement if needed", p.n));
  }
  if (/packag|discreet|plain|label/i.test(ctx.text)) {
    out.push(line("Orders arrive in plain outer packaging, and the label shows only your name and address, not the product", p.n));
  }
  if (/stock|availab|substitut|alternative/i.test(ctx.text)) {
    out.push(line("If a product is out of stock, a clinician or pharmacist decides on any alternative, and you are told before anything changes", p.n));
  }
  return out;
}

const ANSWERS: Partial<Record<Category, (ctx: Ctx) => string[]>> = {
  order_status: answerOrder,
  delivery_problem: answerOrder,
  billing: answerBilling,
  price_change: answerPrice,
  plan_change: answerPlanChange,
  appointment: answerAppointment,
  script_renewal: answerRenewal,
  account_access: answerAccount,
  product_question: answerProduct,
};

const OPENERS: Partial<Record<Category, string>> = {
  order_status: "Thanks for checking in about your order.",
  delivery_problem: "Thanks for letting us know, and I'm sorry about the trouble with your delivery.",
  script_renewal: "Thanks for getting in touch about your renewal.",
  billing: "Thanks for your message about your account.",
  price_change: "Thanks for asking about the price of your plan.",
  plan_change: "Thanks for letting us know about the change to your plan.",
  appointment: "Thanks for getting in touch about your appointment.",
  account_access: "I'm sorry you're having trouble getting into your account.",
  product_question: "Thanks for your question.",
};

/** An address change, with no sign of a problem: the reply thanks the patient rather than apologising. */
const ADDRESS_CHANGE = /moving (?:house|home|to|from|out)|\bmoved\b|new address|change (?:my|the) (?:delivery |postal )?address|update (?:my|the) (?:delivery |postal )?address|redirect|deliver (?:it )?to (?:my )?work/i;
const DELIVERY_TROUBLE =
  /\blate\b|\blost\b|damaged|wrong (?:address|item|product)|missed|not (?:arrived|here|received)|hasn'?t (?:arrived|come|turned up)|never (?:arrived|came|turned up)|broken|leak|crack|still (?:nothing|waiting)/i;

function opener(input: DraftInput): string {
  const ask = latestAsk(input.text);
  const delivery = input.category === "delivery_problem" || input.category === "order_status";
  if (delivery && !DELIVERY_TROUBLE.test(ask)) {
    if (ADDRESS_CHANGE.test(ask)) return "Thanks for letting us know about your new address.";
    // A delivery instruction or question ("can you leave it at the door?") is not a problem to apologise for.
    if (input.category === "delivery_problem") return "Thanks for your message about your delivery.";
  }
  return OPENERS[input.category] ?? "Thanks for getting in touch.";
}

function mockDraft(input: DraftInput): Draft {
  const numbered: Numbered[] = input.sources.map((s, i) => ({ s, n: i + 1 }));
  const ctx: Ctx = {
    text: input.text,
    category: input.category,
    country: input.country,
    orders: numbered.filter((x) => x.s.kind === "order").map((x) => ({ ...x, o: orderFacts(x.s) })),
    charges: numbered.filter((x) => x.s.kind === "charge").map((x) => ({ ...x, c: chargeFacts(x.s) })),
    appointments: numbered.filter((x) => x.s.kind === "appointment"),
    plan: (() => {
      const x = numbered.find((y) => y.s.kind === "plan");
      return x ? { ...x, p: planFacts(x.s) } : undefined;
    })(),
    policy: numbered.filter((x) => x.s.kind === "policy" && !/(tone|voice)/i.test(x.s.label)),
  };

  const answer = ANSWERS[input.category];
  const lines = answer ? answer(ctx) : [];
  // Only when the type's own answer found nothing: a closely matching sentence from the type's own policy section.
  if (lines.length === 0) lines.push(...scoredPolicy(input.text, ctx.policy, input.category, input.country, 2, 2));

  if (lines.length === 0) {
    return { text: "", citations: [], declined: "No record or policy section answers this question." };
  }
  const text = sanitizeDashes(
    [
      "Hi [FIRST_NAME],",
      "",
      opener(input),
      "",
      lines.join(" "),
      "",
      "If anything here does not look right, just reply to this message and the team will look into it for you.",
      "",
      "Kind regards,",
      "[AGENT_NAME]",
    ].join("\n"),
  );
  const citations = extractCitations(text, input.sources);
  return { text, citations: typeof citations === "string" ? [] : citations };
}

function mockUsage(inputChars: number, outputChars: number): Usage {
  return { inputTokens: Math.ceil(inputChars / 4), outputTokens: Math.ceil(outputChars / 4), costUsd: 0 };
}

/**
 * Deterministic stand-in for Claude: keyword sorting and short template replies quoting only the numbered sources.
 * Used in development and as the demo-mode fallback when Claude is unavailable. Never used for published results:
 * npm run precompute refuses to write mock results unless --allow-mock is passed, and npm run eval refuses them too.
 */
export function createMockClient(): LlmClient {
  return {
    async sort(input) {
      const sort = mockSort(input);
      return {
        sort,
        usage: mockUsage(buildSortUserPrompt(input).length + SORT_SYSTEM_PROMPT.length, JSON.stringify(sort).length),
        model: MOCK_MODEL,
      };
    },
    async draft(input) {
      const draft = mockDraft(input);
      return {
        draft,
        usage: mockUsage(buildDraftUserPrompt(input).length + DRAFT_SYSTEM_PROMPT.length, draft.text.length + 40),
        model: MOCK_MODEL,
      };
    },
  };
}

/** True for the categories that must never get an AI reply. */
export function isSafetyCategory(c: Category): boolean {
  return (SAFETY_CATEGORIES as readonly string[]).includes(c);
}

/** True for routine categories. */
export function isRoutineCategory(c: Category): boolean {
  return (ROUTINE_CATEGORIES as readonly string[]).includes(c);
}
