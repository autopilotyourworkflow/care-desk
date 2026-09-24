/**
 * BUILD TIME ONLY. Turns data/*.json and the queue model into the files served from public/data/.
 * Used by scripts/build-public-data.ts and the tests; screens never import this (it pulls in the pipeline helpers).
 * Pure and deterministic: the same inputs always give byte-identical output.
 * Every patient, message and result is fictional demo material.
 */
import type {
  Appointment,
  Baseline,
  Charge,
  EvalReport,
  Order,
  Patient,
  PatientMessage,
  PipelineResult,
  ResultsFile,
  Risk,
  Route,
  SafetyCategory,
  TestLabel,
} from "@/lib/types";
import { SAFETY_CATEGORIES } from "@/lib/types";
import { buildQueue, compareQueueItems, QUEUE_STATUS_LABEL, type QueueItem } from "@/lib/fixtures/queue";
import { headlineHit, isDemoMode, messageText, resultCategory, stoppedAt } from "@/lib/pipeline/run";
import { appointmentSource, chargeSource, orderSource, planSource } from "@/lib/pipeline/retrieve";
import { isMockModel } from "@/lib/pipeline/llm";
import { isLivingPatientReport } from "@/lib/pipeline/death";
import { DEMO_NOW } from "@/lib/format";
import { resolveWelcomeIds } from "@/components/tour/steps";
import {
  PUBLIC_DATA_VERSION,
  type CaseFile,
  type CasePatient,
  type CaseSibling,
  type EvalCaseMeta,
  type Helpline,
  type Persona,
  type PersonasFile,
  type PublicEvalReport,
  type PublicMeta,
  type QueueFile,
  type QueueReason,
  type QueueRow,
  type QueueSeed,
  type StaffMember,
} from "./types";

/** The red-team slice starts here: test inputs only, never in the desk queue. */
export const TEST_ONLY_FROM = "MSG-0901";

export function isTestOnly(messageId: string): boolean {
  const n = Number(messageId.replace(/^MSG-/, ""));
  return Number.isFinite(n) && n >= Number(TEST_ONLY_FROM.replace(/^MSG-/, ""));
}

/** One line, cut at a word near `max` characters, ended with "…" when cut. */
export function previewOf(body: string, max = 140): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  const head = (space > max * 0.6 ? cut.slice(0, space) : flat.slice(0, max)).replace(/[\s,;:.!?]+$/, "");
  return `${head}…`;
}

const ROUTE_RISK: Record<Route, Risk> = { draft: "routine", person: "routine", clinician: "clinical", urgent: "urgent" };

export function riskForRoute(route: Route): Risk {
  return ROUTE_RISK[route];
}

const SAFETY_ORDER: readonly SafetyCategory[] = ["crisis", "bereavement", "adverse_event", "side_effect", "clinical_question"];
const SAFETY_SET = new Set<string>(SAFETY_CATEGORIES);

/** The inputs deriveQueue needs, mirroring what lib/fixtures/queue.ts reads from a result. */
export function seedFor(result: PipelineResult): QueueSeed {
  const found = new Set<string>(result.rules.hits.map((h) => h.category));
  if (result.sort) found.add(result.sort.category);
  const seed: QueueSeed = {
    checkedDraft: result.route === "draft" && Boolean(result.draft?.text) && !result.draft?.declined && result.check?.passed === true,
    safety: SAFETY_ORDER.filter((c) => found.has(c) && SAFETY_SET.has(c)),
  };
  if (isLivingPatientReport(result.rules.hits)) seed.livingPatient = true;
  if (result.draft?.text && (result.draft.declined || result.check?.passed === false)) seed.blockedDraft = true;
  return seed;
}

/** The route's reason in plain words, taken from the trail. */
export function reasonFor(result: PipelineResult): QueueReason {
  const stop = stoppedAt(result);
  const hit = headlineHit(result.rules.hits);
  const decisive =
    result.trail.find((s) => s.status === "stopped") ??
    result.trail.find((s) => s.status === "failed" || s.status === "flagged") ??
    result.trail.find((s) => s.id === "decide");
  const reason: QueueReason = { summary: decisive?.summary ?? "" };
  const category = resultCategory(result);
  if (category) reason.category = category;
  if (hit) {
    reason.phrase = hit.phrase;
    reason.phraseIn = hit.start >= 0 ? "message" : "thread";
  }
  if (stop) reason.stoppedAt = stop;
  return reason;
}

export function toQueueRow(item: QueueItem, patient: Patient | undefined): QueueRow {
  const { message: m, result: r } = item;
  const row: QueueRow = {
    messageId: m.id,
    patientId: m.patientId,
    firstName: patient?.firstName ?? "",
    country: patient?.country ?? "AU",
    channel: m.channel,
    receivedAt: m.receivedAt,
    preview: previewOf(m.body),
    route: item.route,
    risk: riskForRoute(item.route),
    holdOrders: r.holdOrders,
    status: item.status,
    statusLabel: QUEUE_STATUS_LABEL[item.status],
    patientAlerts: item.patientAlerts,
    sendable: item.sendable,
    reason: reasonFor(r),
    threadLength: m.thread?.length ?? 0,
    sample: isDemoMode(r),
    falseAlarmKeepsAlert: item.falseAlarmKeepsAlert,
    seed: seedFor(r),
  };
  if (m.subject) row.subject = m.subject;
  const category = resultCategory(r);
  if (category) row.category = category;
  if (item.lock) row.lock = item.lock;
  if (r.sort) row.confidence = r.sort.confidence;
  return row;
}

const newestFirst = (a: string, b: string) => Date.parse(b) - Date.parse(a) || (a < b ? 1 : a > b ? -1 : 0);

export function toCasePatient(p: Patient): CasePatient {
  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    phone: p.phone,
    country: p.country,
    timezone: p.timezone,
    suburb: p.address.suburb,
    region: p.address.region,
    postcode: p.address.postcode,
    plan: p.plan,
    orders: [...(p.orders ?? [])].sort((a: Order, b: Order) => newestFirst(a.placedAt, b.placedAt)),
    charges: [...(p.charges ?? [])].sort((a: Charge, b: Charge) => newestFirst(a.at, b.at)),
    appointments: [...(p.appointments ?? [])].sort((a: Appointment, b: Appointment) => newestFirst(a.at, b.at)),
  };
}

export function toPersona(p: Patient): Persona {
  // Drop the author note: it is for demo authors and never rendered.
  const { authorNote: _note, ...patient } = p;
  void _note;
  return {
    patient,
    sources: [
      planSource(p),
      ...(p.orders ?? []).map(orderSource),
      ...(p.charges ?? []).map(chargeSource),
      ...(p.appointments ?? []).map(appointmentSource),
    ],
  };
}

export interface PublicDataInput {
  results: ResultsFile;
  messages: PatientMessage[];
  patients: Patient[];
  testset: TestLabel[];
  evalReport: EvalReport;
  baseline: Baseline;
  helplines: Helpline[];
  staff: StaffMember[];
}

/** Every public file, keyed by its path under public/data/. */
export interface PublicDataOutput {
  queue: QueueFile;
  cases: Record<string, CaseFile>;
  evalReport: PublicEvalReport;
  baseline: Baseline;
  helplines: Helpline[];
  staff: StaffMember[];
  personas: PersonasFile;
  meta: PublicMeta;
}

/** The desk queue: every non test-only result, patient-level locks derived, in display order. */
export function deskQueueItems(results: readonly PipelineResult[], messages: readonly PatientMessage[]): QueueItem[] {
  const desk = results.filter((r) => !isTestOnly(r.messageId));
  const deskMessages = messages.filter((m) => !isTestOnly(m.id));
  return buildQueue(desk, deskMessages).sort(compareQueueItems);
}

export function buildPublicData(input: PublicDataInput): PublicDataOutput {
  const { results: resultsFile, messages, patients, testset, evalReport, baseline, helplines, staff } = input;
  const results = resultsFile.results;
  const patientById = new Map(patients.map((p) => [p.id, p]));
  const resultById = new Map(results.map((r) => [r.messageId, r]));
  const labelById = new Map(testset.map((l) => [l.messageId, l]));

  const items = deskQueueItems(results, messages);
  const rows = items.map((it) => toQueueRow(it, patientById.get(it.patientId)));
  const rowById = new Map(rows.map((r) => [r.messageId, r]));

  // Messages grouped by patient, oldest first (ties by id), for "other messages from this patient".
  const byPatient = new Map<string, PatientMessage[]>();
  for (const m of messages) {
    const list = byPatient.get(m.patientId) ?? [];
    list.push(m);
    byPatient.set(m.patientId, list);
  }
  for (const list of byPatient.values()) {
    list.sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt) || (a.id < b.id ? -1 : 1));
  }

  const cases: Record<string, CaseFile> = {};
  const sortedMessages = [...messages].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const m of sortedMessages) {
    const result = resultById.get(m.id);
    const patient = patientById.get(m.patientId);
    if (!result || !patient) continue;
    const row = rowById.get(m.id);
    const testOnly = isTestOnly(m.id);
    const siblings: CaseSibling[] = (byPatient.get(m.patientId) ?? [])
      .filter((o) => o.id !== m.id && resultById.has(o.id))
      .map((o) => {
        const oRow = rowById.get(o.id);
        const s: CaseSibling = {
          messageId: o.id,
          receivedAt: o.receivedAt,
          channel: o.channel,
          preview: previewOf(o.body, 100),
          route: resultById.get(o.id)!.route,
          testOnly: isTestOnly(o.id),
        };
        if (o.subject) s.subject = o.subject;
        if (oRow) {
          s.status = oRow.status;
          s.statusLabel = oRow.statusLabel;
        }
        return s;
      })
      // A desk ticket lists only desk messages; a test-only case may also list the desk messages it relates to.
      .filter((s) => testOnly || !s.testOnly);
    const c: CaseFile = {
      version: PUBLIC_DATA_VERSION,
      messageId: m.id,
      message: m,
      text: messageText(m),
      thread: m.thread ?? [],
      result,
      patient: toCasePatient(patient),
      patientAlerts: row?.patientAlerts ?? [],
      siblings,
      testOnly,
    };
    if (row) c.row = row;
    if (row?.lock) c.lock = row.lock;
    const label = labelById.get(m.id);
    if (label) c.label = label;
    cases[m.id] = c;
  }

  const caseMeta: Record<string, EvalCaseMeta> = {};
  for (const ec of evalReport.cases) {
    const m = messages.find((x) => x.id === ec.messageId);
    const p = m ? patientById.get(m.patientId) : undefined;
    if (!m || !p) continue;
    const meta: EvalCaseMeta = {
      firstName: p.firstName,
      country: p.country,
      channel: m.channel,
      preview: previewOf(m.body),
      testOnly: isTestOnly(m.id),
    };
    if (m.subject) meta.subject = m.subject;
    caseMeta[ec.messageId] = meta;
  }

  const personas: PersonasFile = {
    version: PUBLIC_DATA_VERSION,
    personas: patients
      .filter((p) => p.demoPersona)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map(toPersona),
  };

  const meta: PublicMeta = {
    version: PUBLIC_DATA_VERSION,
    generatedAt: resultsFile.generatedAt,
    evalGeneratedAt: evalReport.generatedAt,
    versions: resultsFile.versions,
    models: resultsFile.models,
    isMock: isMockModel(resultsFile.models.sort) || isMockModel(resultsFile.models.draft) || results.some(isDemoMode),
    demoNow: DEMO_NOW,
    counts: {
      queue: rows.length,
      cases: Object.keys(cases).length,
      testOnly: Object.values(cases).filter((c) => c.testOnly).length,
    },
    testOnlyFrom: TEST_ONLY_FROM,
    welcome: {
      ...resolveWelcomeIds(rows),
      totals: {
        cases: evalReport.totals.cases,
        safetyCases: evalReport.totals.safetyCases,
        safetyCaught: evalReport.totals.safetyCaught,
        holdsExpected: evalReport.totals.holdsExpected,
        holdsPlaced: evalReport.totals.holdsPlaced,
      },
    },
  };

  return {
    queue: { version: PUBLIC_DATA_VERSION, items: rows },
    cases,
    evalReport: { ...evalReport, caseMeta },
    baseline,
    helplines,
    staff,
    personas,
    meta,
  };
}
