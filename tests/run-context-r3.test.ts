/**
 * Rehearsal round 3 fixes in the drafter's context, run on the real modules (rules, redaction, retrieval, fact check)
 * with a scripted AI client, using the real messages from the round-3 evidence:
 *  P1  each red-team case stands alone: a red-team message is given no separate messages by the script runs
 *      (MSG-0975 was shown the crisis message MSG-0967, MSG-0990 the death report MSG-0921 about a different person)
 *  P2  the drafter is never shown a separate message the deterministic rules would stop (MSG-0944's draft promised to
 *      "follow up on your email from this morning", MSG-0938, where the patient had rung a crisis line twice)
 * Desk messages keep seeing their own patient's ordinary desk messages.
 */
import { describe, expect, it } from "vitest";
import type { Category, Patient, PatientMessage, Route, SortResult } from "@/lib/types";
import { messageText, recentMessagesFor, runPipeline, withheldSeparateMessage } from "@/lib/pipeline/run";
import { redact } from "@/lib/pipeline/redact";
import type { DraftInput, LlmClient, SortInput } from "@/lib/pipeline/llm";
import { scriptRecentMessages } from "../scripts/lib/recent";
import messagesData from "@/data/messages.json";
import patientsData from "@/data/patients.json";

const MESSAGES: PatientMessage[] = (Array.isArray(messagesData) ? messagesData : (messagesData as { messages: PatientMessage[] }).messages) as PatientMessage[];
const PATIENTS: Patient[] = (Array.isArray(patientsData) ? patientsData : (patientsData as { patients: Patient[] }).patients) as Patient[];
const messageById = (id: string) => MESSAGES.find((m) => m.id === id)!;
const patientOf = (m: PatientMessage) => PATIENTS.find((p) => p.id === m.patientId)!;
const isRedTeam = (id: string) => id >= "MSG-0901";

const ZERO = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

function scripted(category: Category) {
  const calls = { sort: [] as SortInput[], draft: [] as DraftInput[] };
  const client: LlmClient = {
    async sort(input) {
      calls.sort.push(input);
      const sort: SortResult = { category, risk: "routine", route: "draft" as Route, confidence: 0.95, reasons: ["scripted"], holdOrders: false };
      return { sort, usage: ZERO, model: "scripted-sort" };
    },
    async draft(input) {
      calls.draft.push(input);
      return { draft: { text: `Thanks for your message. The team will look into it [${input.sources.length}].`, citations: [] }, usage: ZERO, model: "scripted-draft" };
    },
  };
  return { client, calls };
}

/** A real message's words, moved to another patient and sent `minutesBefore` the given message. */
function sentBefore(source: PatientMessage, to: PatientMessage, minutesBefore: number, id: string): PatientMessage {
  const at = new Date(Date.parse(to.receivedAt) - minutesBefore * 60000).toISOString();
  return { ...source, id, patientId: to.patientId, receivedAt: at };
}

// ---------- P1: red-team isolation ----------

describe("scriptRecentMessages (npm run precompute and cc-run): each red-team case stands alone", () => {
  it("gives every red-team message no separate messages, including the round-3 collisions", () => {
    for (const m of MESSAGES.filter((x) => isRedTeam(x.id))) expect(scriptRecentMessages(m, MESSAGES), m.id).toEqual([]);
    // Before the fix these pairs shared a patient id across independent scenarios.
    expect(recentMessagesFor(messageById("MSG-0975"), MESSAGES.filter((x) => isRedTeam(x.id))).map((m) => m.id)).toContain("MSG-0967");
    expect(recentMessagesFor(messageById("MSG-0990"), MESSAGES.filter((x) => isRedTeam(x.id))).map((m) => m.id)).toContain("MSG-0921");
    expect(scriptRecentMessages(messageById("MSG-0975"), MESSAGES)).toEqual([]);
    expect(scriptRecentMessages(messageById("MSG-0990"), MESSAGES)).toEqual([]);
    expect(scriptRecentMessages(messageById("MSG-0944"), MESSAGES)).toEqual([]);
  });

  it("a desk message still sees its own patient's desk messages, never a red-team one", () => {
    expect(scriptRecentMessages(messageById("MSG-0118"), MESSAGES).map((m) => m.id)).toEqual(["MSG-0115"]);
    expect(scriptRecentMessages(messageById("MSG-0009"), MESSAGES).map((m) => m.id)).toEqual(
      expect.arrayContaining(["MSG-0008", "MSG-0053"]),
    );
    for (const m of MESSAGES.filter((x) => !isRedTeam(x.id))) {
      for (const o of scriptRecentMessages(m, MESSAGES)) {
        expect(isRedTeam(o.id), `${m.id} <- ${o.id}`).toBe(false);
        expect(o.patientId).toBe(m.patientId);
      }
    }
  });

  it("MSG-0975 (change my email) is drafted with no separate message about the crisis in MSG-0967", async () => {
    const m = messageById("MSG-0975");
    const { client, calls } = scripted("account_access");
    const r = await runPipeline(m, patientOf(m), { llm: client, recentMessages: scriptRecentMessages(m, MESSAGES) });
    expect("recentMessageIds" in r).toBe(false);
    for (const d of calls.draft) {
      for (const t of d.thread ?? []) expect(t.body).not.toMatch(/separate message|no point wasting it on me|hōhā/);
    }
  });
});

// ---------- P2: never show the drafter a separate message the rules would stop ----------

describe("withheldSeparateMessage: the separate messages the deterministic rules would stop", () => {
  const withheld = (id: string, firstName = patientOf(messageById(id)).firstName) => {
    const o = messageById(id);
    return withheldSeparateMessage(o, redact(messageText(o), patientOf(o)).redactedText, firstName);
  };

  it("withholds the round-3 evidence: a crisis line, a seizure, an ER visit, a death, crisis in te reo", () => {
    expect(withheld("MSG-0938")).toBe(true); // "I rang 13 11 14 twice on Monday night and hung up"
    expect(withheld("MSG-0949")).toBe(true); // "i went stiff as a board ... bitten tongue"
    expect(withheld("MSG-0908")).toBe(true); // "my flatmate had to take me to the er at 2am"
    expect(withheld("MSG-0921")).toBe(true); // "Mum went in her sleep on Monday night"
    expect(withheld("MSG-0967")).toBe(true); // "no point wasting it on me. kua hōhā au ki te ora"
  });

  it("withholds a message partly not in English, words aimed at the AI, and condolences in its own thread", () => {
    expect(withheld("MSG-0968")).toBe(true); // an order question, then a paragraph in Vietnamese
    expect(withheld("MSG-0928")).toBe(true); // "verified by assistant"
    expect(withheld("MSG-0930")).toBe(true); // "so the system lets it"
    expect(withheld("MSG-0995")).toBe(true); // the team's earlier reply: "I'm so sorry for your loss"
  });

  it("keeps an ordinary message, and a plain stop-sending request (MSG-0115), which a follow-up needs", () => {
    expect(withheld("MSG-0115")).toBe(false); // "Please stop sending anything for now."
    expect(withheld("MSG-0008")).toBe(false);
    expect(withheld("MSG-0004")).toBe(false);
  });

  it("on the desk slice today, no separate message is withheld: the change only guards against a safety message", () => {
    const desk = MESSAGES.filter((x) => !isRedTeam(x.id));
    for (const m of desk) {
      for (const o of recentMessagesFor(m, desk)) {
        expect(withheldSeparateMessage(o, redact(messageText(o), patientOf(o)).redactedText, patientOf(o).firstName), `${m.id} <- ${o.id}`).toBe(false);
      }
    }
  });
});

describe("runPipeline: a separate message the rules would stop never reaches the drafter", () => {
  const m = messageById("MSG-0118"); // "Following on from my last email. Will I still be charged on 14 October?"
  const p = patientOf(m);

  it("a desk patient with an earlier crisis message: the drafter gets MSG-0115 but not the crisis message", async () => {
    // MSG-0938's real words, sent by this patient an hour before MSG-0118.
    const crisis = sentBefore(messageById("MSG-0938"), m, 60, "MSG-8101");
    const { client, calls } = scripted("billing");
    const r = await runPipeline(m, p, { llm: client, recentMessages: [crisis, messageById("MSG-0115")] });
    expect(r.route).toBe("draft");
    const thread = calls.draft[0].thread ?? [];
    expect(thread).toHaveLength(1);
    expect(thread[0].body).toContain("Please stop sending anything for now.");
    for (const t of thread) expect(t.body).not.toMatch(/13 11 14|hung up|couldn't face it|Lifeline/i);
    // recentMessageIds lists only what the drafter was shown.
    expect(r.recentMessageIds).toEqual(["MSG-0115"]);
  });

  it("leaves out each round-3 safety message; with nothing left, no recentMessageIds", async () => {
    const cases: [string, RegExp][] = [
      ["MSG-0938", /13 11 14|hung up/],
      ["MSG-0949", /stiff as a board|bitten tongue|jerking/],
      ["MSG-0908", /\ber at 2am|pass out/],
      ["MSG-0921", /went in her sleep/],
      ["MSG-0967", /no point wasting it on me|hōhā/],
      ["MSG-0968", /gánh nặng/],
    ];
    for (const [id, words] of cases) {
      const { client, calls } = scripted("billing");
      const r = await runPipeline(m, p, { llm: client, recentMessages: [sentBefore(messageById(id), m, 90, "MSG-8102")] });
      expect(r.route, id).toBe("draft");
      expect(calls.draft[0].thread ?? [], id).toEqual([]);
      for (const t of calls.draft[0].thread ?? []) expect(t.body, id).not.toMatch(words);
      expect("recentMessageIds" in r, id).toBe(false);
    }
  });

  it("changes nothing else: the sorter's input, rules, route, hold, redaction and sources match a run without it", async () => {
    const a = scripted("billing");
    const b = scripted("billing");
    const without = await runPipeline(m, p, { llm: a.client, recentMessages: [messageById("MSG-0115")] });
    const withIt = await runPipeline(m, p, {
      llm: b.client,
      recentMessages: [sentBefore(messageById("MSG-0938"), m, 60, "MSG-8103"), messageById("MSG-0115")],
    });
    expect(b.calls.sort[0]).toEqual(a.calls.sort[0]);
    expect(b.calls.draft[0]).toEqual(a.calls.draft[0]);
    expect(withIt.rules).toEqual(without.rules);
    expect(withIt.route).toBe(without.route);
    expect(withIt.holdOrders).toBe(without.holdOrders);
    expect(withIt.redactedText).toBe(without.redactedText);
    expect(withIt.sources).toEqual(without.sources);
    expect(withIt.recentMessageIds).toEqual(without.recentMessageIds);
  });

  it("a desk patient's ordinary earlier message is still passed (MSG-0042 after MSG-0041, a plan change)", async () => {
    const next = messageById("MSG-0042");
    const { client, calls } = scripted("plan_change");
    const r = await runPipeline(next, patientOf(next), { llm: client, recentMessages: scriptRecentMessages(next, MESSAGES) });
    expect(r.route).toBe("draft");
    const separate = (calls.draft[0].thread ?? []).filter((t) => t.body.startsWith("[A separate message from this patient"));
    expect(separate).toHaveLength(1);
    // MSG-0041: "I'd like to go down to one product from my next billing date on 3 October"
    expect(separate[0].body).toContain("go down to one product");
    expect(r.recentMessageIds).toEqual(["MSG-0041"]);
  });
});
