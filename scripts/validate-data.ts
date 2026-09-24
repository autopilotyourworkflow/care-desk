/**
 * Validates the Care Desk demo data (all fictional) against the shared contract in lib/types.ts.
 *
 *   npm run validate:data
 *
 * Loads data/policy.json, helplines.json, staff.json, patients.json, messages.json, testset.json and baseline.json
 * (plus scenarios.json when present), checks ids, references, labels, currencies, dates and copy rules, prints a
 * distribution table, and exits 1 on any error. Warnings are printed but do not fail the run.
 *
 * The queue holds only the latest message of each conversation: an earlier message that a later thread already
 * contains is an error, so message ids ascend with gaps where those earlier messages were taken out.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  ROUTINE_CATEGORIES,
  SAFETY_CATEGORIES,
  type Baseline,
  type Category,
  type Country,
  type Currency,
  type Patient,
  type PatientMessage,
  type PolicySection,
  type Route,
  type TestLabel,
} from "../lib/types";
import { DEMO_NOW, DEMO_NOW_MS } from "../lib/format";
import { checkRules, routeForHits } from "../lib/pipeline/rules";
import { ROOT, asArray, dataPath, readJsonFile, requireFile } from "./lib/io";

// ---------- Reporting ----------

const errors: string[] = [];
const warnings: string[] = [];
const err = (where: string, msg: string) => errors.push(`${where}: ${msg}`);
const warn = (where: string, msg: string) => warnings.push(`${where}: ${msg}`);

// ---------- Constants from the contract ----------

const COUNTRIES: readonly Country[] = ["AU", "NZ", "UK"];
const CURRENCY_FOR: Record<Country, Currency> = { AU: "AUD", NZ: "NZD", UK: "GBP" };
const CHANNELS = ["email", "chat"] as const;
const ROUTES: readonly Route[] = ["draft", "person", "clinician", "urgent"];
const ALL_CATEGORIES: readonly Category[] = [...ROUTINE_CATEGORIES, ...SAFETY_CATEGORIES];
const SAFETY = new Set<string>(SAFETY_CATEGORIES);
/** Safety category to the only route it may take. */
const SAFETY_ROUTE: Record<string, Route> = {
  clinical_question: "clinician",
  side_effect: "clinician",
  adverse_event: "urgent",
  crisis: "urgent",
  bereavement: "urgent",
};
/** Routine categories a person always writes (matches the pipeline's PERSON_CATEGORIES). */
const PERSON_ONLY = new Set<string>(["wants_human", "complaint", "privacy_request", "other"]);
const DEMO_PERSONAS = ["PT-1001", "PT-1031", "PT-1043"];

const ORDER_STATUSES = ["script_pending", "dispensing", "shipped", "delivered", "on_hold", "cancelled"];
const PLAN_STATUSES = ["active", "paused", "cancelled"];
const CHARGE_KINDS = ["plan", "shipping", "refund", "adjustment", "consult"];
const CHARGE_STATUSES = ["paid", "failed", "refunded", "pending"];
const APPT_KINDS = ["initial", "follow_up", "renewal"];
const APPT_STATUSES = ["booked", "completed", "missed", "cancelled"];

const ID = {
  patient: /^PT-(\d{4})$/,
  order: /^ORD-2\d{4}$/,
  charge: /^CHG-3\d{4}$/,
  appointment: /^APT-4\d{4}$/,
  message: /^MSG-\d{4}$/,
  tracking: /^CD\d{10}$/,
  policy: /^P\d+\.\d+$/,
  staff: /^ST-\d{2}$/,
};

const WINDOW_FIRST = "2026-09-16";
const WINDOW_LAST = "2026-09-23";

// ---------- Helpers ----------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = s.match(ISO_DATE);
  if (!m) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function isIsoDateTime(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = s.match(ISO_DATETIME);
  if (!m || !isIsoDate(m[1])) return false;
  const [hh, mm, ss] = [Number(m[2]), Number(m[3]), Number(m[4] ?? 0)];
  if (hh > 23 || mm > 59 || ss > 59) return false;
  return !Number.isNaN(Date.parse(s));
}

/** Offset like "+10:00" that the IANA zone uses at this instant. */
function zoneOffset(timeZone: string, instant: Date): string | undefined {
  try {
    const part = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(instant)
      .find((p) => p.type === "timeZoneName")?.value;
    if (!part) return undefined;
    if (part === "GMT") return "+00:00";
    const m = part.match(/^GMT([+-]\d{2}):?(\d{2})?$/);
    return m ? `${m[1]}:${m[2] ?? "00"}` : undefined;
  } catch {
    return undefined;
  }
}

function offsetOf(dt: string): string {
  const m = dt.match(ISO_DATETIME);
  const o = m?.[5] ?? "";
  return o === "Z" ? "+00:00" : o;
}

function checkZoneOffset(where: string, dt: string, timeZone: string) {
  const expected = zoneOffset(timeZone, new Date(dt));
  if (expected && offsetOf(dt) !== expected) err(where, `${dt} has offset ${offsetOf(dt)}, but ${timeZone} is ${expected} then`);
}

function countBy<T>(items: T[], key: (t: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
  return m;
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

function load<T>(name: string, key: string): T[] {
  const path = dataPath(name);
  requireFile(path, "It is part of the demo data set.");
  try {
    return asArray<T>(readJsonFile(path), key);
  } catch (e) {
    err(name, `could not be read: ${(e as Error).message}`);
    return [];
  }
}

const REF_PATTERNS: { kind: "order" | "charge" | "appointment" | "tracking" | "patient"; re: RegExp }[] = [
  { kind: "order", re: /\bORD-\d+\b/g },
  { kind: "charge", re: /\bCHG-\d+\b/g },
  { kind: "appointment", re: /\bAPT-\d+\b/g },
  { kind: "tracking", re: /\bCD\d{6,}\b/g },
  { kind: "patient", re: /\bPT-\d+\b/g },
];

// ---------- 1. Copy rule: no en or em dashes anywhere in data/ ----------

const DASHES: { ch: string; name: string }[] = [
  { ch: String.fromCharCode(0x2013), name: "en dash (U+2013)" },
  { ch: String.fromCharCode(0x2014), name: "em dash (U+2014)" },
  { ch: String.fromCharCode(0x2012), name: "figure dash (U+2012)" },
  { ch: String.fromCharCode(0x2015), name: "horizontal bar (U+2015)" },
];
for (const file of listFiles(join(ROOT, "data"))) {
  if (!/\.(json|md|txt|csv)$/i.test(file)) continue;
  const text = readFileSync(file, "utf8");
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  for (const { ch, name } of DASHES) {
    let idx = text.indexOf(ch);
    let n = 0;
    while (idx >= 0) {
      if (n < 3) {
        const line = text.slice(0, idx).split("\n").length;
        err(rel, `${name} on line ${line}: "${text.slice(Math.max(0, idx - 30), idx + 30).replace(/\s+/g, " ")}"`);
      }
      n++;
      idx = text.indexOf(ch, idx + 1);
    }
    if (n > 3) err(rel, `${n - 3} more ${name} characters`);
  }
}

// ---------- 2. Load ----------

interface Staff {
  id: string;
  name: string;
  role: string;
  country: Country;
  title: string;
}
interface Helpline {
  country: Country;
  kind: string;
  name: string;
  number: string;
  url: string;
  verifiedOn?: string;
  /** Set when a service covers only part of the country, e.g. "Scotland". */
  region?: string;
}
interface Scenario {
  seedId: string;
  patientId: string;
  category: Category;
  route: Route;
  mustHold: boolean;
  channel: string;
  receivedAt: string;
}

const policy = load<PolicySection>("policy.json", "sections");
const helplines = load<Helpline>("helplines.json", "helplines");
const staff = load<Staff>("staff.json", "staff");
const patients = load<Patient>("patients.json", "patients");
const messages = load<PatientMessage>("messages.json", "messages");
const labels = load<TestLabel>("testset.json", "labels");
const baselinePath = dataPath("baseline.json");
requireFile(baselinePath, "It is part of the demo data set.");
const baseline = readJsonFile<Baseline>(baselinePath);

// ---------- 3. Staff ----------

const staffIds = new Set<string>();
for (const s of staff) {
  const w = `staff.json ${s.id}`;
  if (!ID.staff.test(s.id)) err(w, "id is not in the ST-00 format");
  if (staffIds.has(s.id)) err(w, "duplicate id");
  staffIds.add(s.id);
  if (!COUNTRIES.includes(s.country)) err(w, `invalid country ${s.country}`);
  if (!s.name || !s.title) err(w, "missing name or title");
}
const clinicianNames = new Set(staff.filter((s) => s.role === "clinician").map((s) => s.name));
if (clinicianNames.size === 0) err("staff.json", "no clinicians");

// ---------- 4. Policy and helplines ----------

const policyIds = new Set<string>();
for (const p of policy) {
  const w = `policy.json ${p.id}`;
  if (!ID.policy.test(p.id)) err(w, "id is not in the P1.1 format");
  if (policyIds.has(p.id)) err(w, "duplicate id");
  policyIds.add(p.id);
  if (!p.title?.trim() || !p.body?.trim()) err(w, "missing title or body");
  if (!Array.isArray(p.tags) || p.tags.length === 0) err(w, "needs at least one tag");
  for (const c of p.countries ?? []) if (!COUNTRIES.includes(c)) err(w, `invalid country ${c}`);
}

for (const [i, h] of helplines.entries()) {
  const w = `helplines.json #${i + 1} ${h.name ?? ""}`;
  if (!COUNTRIES.includes(h.country)) err(w, `invalid country ${h.country}`);
  if (!h.name || !h.number) err(w, "missing name or number");
  if (!/^https:\/\//.test(h.url ?? "")) err(w, "needs an https source url");
  if (h.verifiedOn !== undefined && !isIsoDate(h.verifiedOn)) err(w, `verifiedOn ${h.verifiedOn} is not an ISO date`);
}
for (const c of COUNTRIES) {
  const national = helplines.filter((h) => h.country === c && !h.region);
  if (!national.some((h) => h.kind === "crisis")) err("helplines.json", `no national crisis line for ${c}`);
  if (!national.some((h) => h.kind === "emergency")) err("helplines.json", `no national emergency number for ${c}`);
}
// Every helpline number must appear in the policy section for its country, so agents see what the list shows.
for (const h of helplines) {
  const sec = policy.find((p) => p.countries?.length === 1 && p.countries[0] === h.country && /^Urgent safety/.test(p.title));
  if (sec && !sec.body.includes(h.number)) err(`helplines.json ${h.name}`, `number ${h.number} is not in ${sec.id}`);
}
// The UK has separate 111 services; the UK policy must name each nation's route.
{
  const uk = policy.find((p) => p.countries?.length === 1 && p.countries[0] === "UK" && /^Urgent safety/.test(p.title));
  for (const region of ["Scotland", "Wales", "Northern Ireland"])
    if (uk && !uk.body.includes(region)) err(`policy.json ${uk.id}`, `does not say what to give patients in ${region}`);
}

// ---------- 5. Baseline ----------

if (!baseline.label?.toLowerCase().includes("simulated")) err("baseline.json", 'label must say "Simulated"');
for (const wk of baseline.weeks ?? []) {
  if (!isIsoDate(wk.weekOf)) err("baseline.json", `weekOf ${wk.weekOf} is not an ISO date`);
  for (const k of ["messages", "medianFirstResponseMin", "medianHandleMin"] as const) {
    if (typeof wk[k] !== "number" || !(wk[k] > 0)) err("baseline.json", `${wk.weekOf} ${k} must be a positive number`);
  }
}
if (!baseline.weeks?.length) err("baseline.json", "no weeks");
for (const [k, v] of Object.entries(baseline.assumptions ?? {})) {
  if (typeof v !== "number" || !(v > 0)) err("baseline.json", `assumption ${k} must be a positive number`);
}

// ---------- 6. Patients, orders, charges, appointments ----------

const patientById = new Map<string, Patient>();
const orderOwner = new Map<string, string>();
const chargeOwner = new Map<string, string>();
const apptOwner = new Map<string, string>();
const trackingOwner = new Map<string, string>();

const ZONE_PREFIX: Record<Country, RegExp> = {
  AU: /^Australia\//,
  NZ: /^Pacific\/(Auckland|Chatham)$/,
  UK: /^Europe\/London$/,
};

for (const p of patients) {
  const w = `patients.json ${p.id}`;
  const m = p.id?.match(ID.patient);
  if (!m || Number(m[1]) < 1001 || Number(m[1]) > 1060) err(w, "id is not in PT-1001 ... PT-1060");
  if (patientById.has(p.id)) err(w, "duplicate id");
  patientById.set(p.id, p);

  if (!COUNTRIES.includes(p.country)) err(w, `invalid country ${p.country}`);
  if (p.address?.country !== p.country) err(w, `address country ${p.address?.country} differs from ${p.country}`);
  if (!ZONE_PREFIX[p.country]?.test(p.timezone ?? "")) err(w, `timezone ${p.timezone} does not fit ${p.country}`);
  else if (zoneOffset(p.timezone, new Date("2026-09-20T00:00:00Z")) === undefined) err(w, `unknown timezone ${p.timezone}`);
  if (!p.firstName || !p.lastName) err(w, "missing name");
  if (!/^[^@\s]+@example\.(com|org|net)$/.test(p.email ?? "")) err(w, `email ${p.email} should use a reserved example domain`);
  if (!isIsoDate(p.dob)) err(w, `dob ${p.dob} is not an ISO date`);
  if (!p.address?.line1 || !p.address?.suburb || !p.address?.region || !p.address?.postcode) err(w, "incomplete address");

  const cur = CURRENCY_FOR[p.country];
  const plan = p.plan;
  if (!plan) err(w, "missing plan");
  else {
    if (plan.currency !== cur) err(w, `plan currency ${plan.currency} does not match ${p.country}`);
    if (!PLAN_STATUSES.includes(plan.status)) err(w, `invalid plan status ${plan.status}`);
    if (!isIsoDate(plan.startedAt)) err(w, `plan startedAt ${plan.startedAt} is not an ISO date`);
    if (plan.nextBillingDate !== undefined && !isIsoDate(plan.nextBillingDate))
      err(w, `nextBillingDate ${plan.nextBillingDate} is not an ISO date`);
    if (!(plan.monthlyPrice > 0)) err(w, "plan monthlyPrice must be positive");
    if (plan.status === "active" && !plan.nextBillingDate) warn(w, "active plan has no nextBillingDate");
  }

  for (const o of p.orders ?? []) {
    const wo = `${w} ${o.id}`;
    if (!ID.order.test(o.id)) err(wo, "id is not in the ORD-20001 format");
    if (orderOwner.has(o.id)) err(wo, `duplicate order id (also on ${orderOwner.get(o.id)})`);
    orderOwner.set(o.id, p.id);
    if (o.patientId !== p.id) err(wo, `patientId ${o.patientId} differs from its patient`);
    if (o.currency !== cur) err(wo, `currency ${o.currency} does not match ${p.country}`);
    if (!ORDER_STATUSES.includes(o.status)) err(wo, `invalid status ${o.status}`);
    if (!isIsoDateTime(o.placedAt)) err(wo, `placedAt ${o.placedAt} is not an ISO datetime with offset`);
    for (const k of ["shippedAt", "deliveredAt"] as const) {
      if (o[k] !== undefined && !isIsoDateTime(o[k])) err(wo, `${k} ${o[k]} is not an ISO datetime with offset`);
    }
    if (o.eta !== undefined && !isIsoDate(o.eta)) err(wo, `eta ${o.eta} is not an ISO date`);
    if (o.tracking !== undefined) {
      if (!ID.tracking.test(o.tracking)) err(wo, `tracking ${o.tracking} is not CD + 10 digits`);
      if (trackingOwner.has(o.tracking)) err(wo, `duplicate tracking ${o.tracking}`);
      trackingOwner.set(o.tracking, p.id);
    }
    if ((o.status === "shipped" || o.status === "delivered") && (!o.tracking || !o.carrier || !o.shippedAt))
      err(wo, `${o.status} order needs carrier, tracking and shippedAt`);
    if (o.status === "delivered" && !o.deliveredAt) err(wo, "delivered order needs deliveredAt");
    if (o.status === "on_hold" && !o.holdReason) warn(wo, "on_hold order has no holdReason");
    if (o.shippedAt && Date.parse(o.shippedAt) < Date.parse(o.placedAt)) err(wo, "shipped before it was placed");
    if (o.deliveredAt && o.shippedAt && Date.parse(o.deliveredAt) < Date.parse(o.shippedAt)) err(wo, "delivered before it shipped");
    if (!Array.isArray(o.items) || o.items.length === 0) err(wo, "no items");
    if (!(o.total >= 0)) err(wo, "total must be zero or more");
  }

  for (const c of p.charges ?? []) {
    const wc = `${w} ${c.id}`;
    if (!ID.charge.test(c.id)) err(wc, "id is not in the CHG-30001 format");
    if (chargeOwner.has(c.id)) err(wc, `duplicate charge id (also on ${chargeOwner.get(c.id)})`);
    chargeOwner.set(c.id, p.id);
    if (c.patientId !== p.id) err(wc, `patientId ${c.patientId} differs from its patient`);
    if (c.currency !== cur) err(wc, `currency ${c.currency} does not match ${p.country}`);
    if (!CHARGE_KINDS.includes(c.kind)) err(wc, `invalid kind ${c.kind}`);
    if (!CHARGE_STATUSES.includes(c.status)) err(wc, `invalid status ${c.status}`);
    if (!isIsoDateTime(c.at)) err(wc, `at ${c.at} is not an ISO datetime with offset`);
    if (c.kind === "refund" && !(c.amount < 0)) err(wc, "refund amount must be negative");
    if (c.kind !== "refund" && c.kind !== "adjustment" && !(c.amount >= 0)) err(wc, "amount must not be negative");
    if (!c.description) err(wc, "missing description");
  }

  for (const a of p.appointments ?? []) {
    const wa = `${w} ${a.id}`;
    if (!ID.appointment.test(a.id)) err(wa, "id is not in the APT-40001 format");
    if (apptOwner.has(a.id)) err(wa, `duplicate appointment id (also on ${apptOwner.get(a.id)})`);
    apptOwner.set(a.id, p.id);
    if (a.patientId !== p.id) err(wa, `patientId ${a.patientId} differs from its patient`);
    if (!APPT_KINDS.includes(a.kind)) err(wa, `invalid kind ${a.kind}`);
    if (!APPT_STATUSES.includes(a.status)) err(wa, `invalid status ${a.status}`);
    if (!isIsoDateTime(a.at)) err(wa, `at ${a.at} is not an ISO datetime with offset`);
    else checkZoneOffset(wa, a.at, p.timezone);
    if (!clinicianNames.has(a.clinician)) err(wa, `clinician "${a.clinician}" is not in staff.json`);
  }
}

if (patients.length === 0) err("patients.json", "no patients");
const personas = patients.filter((p) => p.demoPersona);
for (const id of DEMO_PERSONAS) {
  const p = patientById.get(id);
  if (!p) err("patients.json", `demo persona ${id} is missing`);
  else if (!p.demoPersona) err("patients.json", `${id} should have demoPersona: true`);
}
if (personas.length !== DEMO_PERSONAS.length)
  err("patients.json", `expected exactly ${DEMO_PERSONAS.length} demo personas, found ${personas.length}`);
if (new Set(personas.map((p) => p.country)).size !== personas.length) err("patients.json", "demo personas should cover AU, NZ and UK once each");

// ---------- 7. Messages ----------

/**
 * Every id a text quotes must exist and belong to the patient. `allowed` widens "the patient" for the red-team slice:
 * a red-team message may quote the records of another patient it names in full (a deliberate third-party request),
 * and a red-team label note may compare the case with any other patient's.
 */
function checkRefs(where: string, text: string, patientId: string, allowed: ReadonlySet<string> = new Set([patientId])) {
  const owners = { order: orderOwner, charge: chargeOwner, appointment: apptOwner, tracking: trackingOwner } as const;
  for (const { kind, re } of REF_PATTERNS) {
    for (const hit of text.match(re) ?? []) {
      if (kind === "patient") {
        if (!allowed.has(hit)) err(where, `mentions another patient id ${hit}`);
        else if (!patientById.has(hit)) err(where, `patient ${hit} does not exist`);
        continue;
      }
      const owner = owners[kind].get(hit);
      if (!owner) err(where, `${kind} ${hit} does not exist`);
      else if (!allowed.has(owner)) err(where, `${kind} ${hit} belongs to ${owner}, not ${patientId}`);
    }
  }
}

/**
 * The held-out red-team slice: messages written after the rules, in phrasings the rules were not tuned on (euphemisms,
 * carers, dropped letters, lowercase a&e / icu / er, other languages). Their labels' notes start with "Red team:" and
 * their ids sit in their own block from MSG-0901, after the queue in both files. They are test inputs, not part of the
 * agent desk's queue, so the queue's ordering rules apply to each group separately.
 */
const RED_TEAM_PREFIX = "Red team:";
const RED_TEAM_FIRST = "MSG-0901";
const redTeamIds = new Set(labels.filter((l) => (l.note ?? "").startsWith(RED_TEAM_PREFIX)).map((l) => l.messageId));
const isRedTeam = (id: string) => redTeamIds.has(id);
/**
 * The red-team slice is test input, scored one message at a time and never shown in the desk queue, so it may be dated
 * after the desk week and the demo's now (a message that arrives later), up to this day.
 */
const RED_TEAM_LAST = "2026-09-30";
/** The patient, plus any other patient a red-team message names in full ("my cousin Amelia Hughes"). */
function patientsNamedIn(msg: PatientMessage): Set<string> {
  const out = new Set([msg.patientId]);
  if (!isRedTeam(msg.id)) return out;
  const text = [msg.subject ?? "", msg.body ?? ""].join("\n").toLowerCase();
  for (const p of patients) if (text.includes(`${p.firstName} ${p.lastName}`.toLowerCase())) out.add(p.id);
  return out;
}

const messageIds = new Set<string>();
const prevAtByGroup = { queue: -Infinity, redTeam: -Infinity };
let seenRedTeam = false;
messages.forEach((msg, i) => {
  const w = `messages.json ${msg.id ?? `#${i + 1}`}`;
  const red = isRedTeam(msg.id);
  const prev = i > 0 ? messages[i - 1] : undefined;
  // Ids ascend in queue order but may have gaps: a gap is a conversation that was already answered or superseded,
  // which now lives only inside a later message's thread (see the "already in a later thread" check below).
  if (!ID.message.test(msg.id ?? "")) err(w, "id is not in the MSG-0001 format");
  else if (prev && ID.message.test(prev.id ?? "") && msg.id <= prev.id)
    err(w, `id is not after ${prev.id} (ids must ascend in queue order)`);
  if (red) {
    seenRedTeam = true;
    if (msg.id < RED_TEAM_FIRST) err(w, `red-team messages use ids from ${RED_TEAM_FIRST}`);
  } else {
    if (seenRedTeam) err(w, "queue messages must come before the red-team slice");
    if (msg.id >= RED_TEAM_FIRST) err(w, `ids from ${RED_TEAM_FIRST} are kept for the red-team slice (its label note must start with "${RED_TEAM_PREFIX}")`);
  }
  if (messageIds.has(msg.id)) err(w, "duplicate id");
  messageIds.add(msg.id);

  const p = patientById.get(msg.patientId);
  if (!p) err(w, `patient ${msg.patientId} does not exist`);
  if (!CHANNELS.includes(msg.channel)) err(w, `invalid channel ${msg.channel}`);
  if (msg.channel === "email" && !msg.subject?.trim()) err(w, "email needs a subject");
  if (msg.channel === "chat" && msg.subject !== undefined) err(w, "chat messages have no subject");
  if (!msg.body?.trim()) err(w, "empty body");
  const words = (msg.body ?? "").split(/\s+/).filter(Boolean).length;
  if (words > 300) warn(w, `body is ${words} words (plan says up to about 250)`);

  if (!isIsoDateTime(msg.receivedAt)) err(w, `receivedAt ${msg.receivedAt} is not an ISO datetime with offset`);
  else {
    const localDate = msg.receivedAt.slice(0, 10);
    const last = red ? RED_TEAM_LAST : WINDOW_LAST;
    if (localDate < WINDOW_FIRST || localDate > last) err(w, `received ${localDate}, outside ${WINDOW_FIRST} to ${last}`);
    if (p) checkZoneOffset(w, msg.receivedAt, p.timezone);
    const at = Date.parse(msg.receivedAt);
    const group = red ? "redTeam" : "queue";
    if (!red && at > DEMO_NOW_MS) err(w, `received after the demo's now (${DEMO_NOW})`);
    // Queue ids are stable references (deep links, tests, the tour), so they are not renumbered when a message is
    // re-timed: the queue slice is kept in id order and the desk sorts by receivedAt itself. The red-team slice is the
    // same: each batch of cases is written oldest first, but a later batch is not interleaved with an earlier one.
    prevAtByGroup[group] = at;
  }

  const thread = msg.thread ?? [];
  if (thread.length > 5) err(w, `thread has ${thread.length} entries (up to 5)`);
  let prevThread = -Infinity;
  thread.forEach((t, j) => {
    const wt = `${w} thread[${j}]`;
    if (t.from !== "patient" && t.from !== "agent") err(wt, `invalid from ${t.from}`);
    if (!t.body?.trim()) err(wt, "empty body");
    if (!isIsoDateTime(t.at)) err(wt, `at ${t.at} is not an ISO datetime with offset`);
    else {
      const at = Date.parse(t.at);
      if (at < prevThread) err(wt, "thread is not oldest first");
      prevThread = at;
      if (isIsoDateTime(msg.receivedAt) && at >= Date.parse(msg.receivedAt)) err(wt, "thread entry is not before the message");
    }
    if (p) checkRefs(wt, t.body ?? "", p.id, patientsNamedIn(msg));
  });

  if (p) checkRefs(w, `${msg.subject ?? ""}\n${msg.body ?? ""}`, p.id, patientsNamedIn(msg));
});

// Consistency across messages: a patient thread entry that is also a message in the queue (same patient, same
// instant) must quote it word for word.
const byPatientInstant = new Map(messages.map((m) => [`${m.patientId}|${Date.parse(m.receivedAt)}`, m]));
for (const msg of messages) {
  (msg.thread ?? []).forEach((t, j) => {
    if (t.from !== "patient") return;
    const same = byPatientInstant.get(`${msg.patientId}|${Date.parse(t.at)}`);
    if (same && same.id !== msg.id && same.body.trim() !== t.body.trim())
      err(`messages.json ${msg.id} thread[${j}]`, `has the same time as ${same.id} but different text`);
  });
}

// A message that already appears inside a later message's thread has been answered (an agent entry follows it) or
// superseded (the patient wrote again). Either way it must not also sit in the open queue, where it would look
// unanswered for days and be processed against the 23 Sep world state. Keep only the latest message of a conversation.
const bodyKey = (patientId: string, body: string) => `${patientId}|${body.replace(/\s+/g, " ").trim()}`;
const byPatientBody = new Map(messages.map((m) => [bodyKey(m.patientId, m.body ?? ""), m]));
for (const msg of messages) {
  // A red-team thread may quote a desk message for context. The red-team slice is test-only, so it never answers or
  // supersedes that message on the desk, which stays in the queue.
  if (isRedTeam(msg.id)) continue;
  const thread = msg.thread ?? [];
  thread.forEach((t, j) => {
    if (t.from !== "patient") return;
    const same =
      byPatientInstant.get(`${msg.patientId}|${Date.parse(t.at)}`) ?? byPatientBody.get(bodyKey(msg.patientId, t.body ?? ""));
    if (!same || same.id === msg.id) return;
    const answered = thread.slice(j + 1).some((later) => later.from === "agent");
    err(
      `messages.json ${same.id}`,
      `is already in the thread of ${msg.id} (${answered ? "an agent has answered it there" : "the patient wrote again"}); remove the standalone copy and its label`,
    );
  });
}

// Phone numbers must come from ranges that cannot reach a real person.
//  AU: ACMA's reserved fictional mobile numbers, all in the 0491 57x xxx block.
//  UK: Ofcom's drama range for mobiles, 07700 900000 to 07700 900999.
//  NZ: New Zealand has no reserved fictional number range (checked against the numbering guidance on 23 Sep 2026),
//      so 021 555 01xx was chosen deliberately: the "555" convention reads as fictional to viewers. Keep new NZ
//      numbers in 021 555 0100 to 0199.
const PHONE_RANGE: Record<Country, { re: RegExp; desc: string }> = {
  AU: { re: /^0491 ?57\d ?\d{3}$/, desc: "the ACMA fictional block 0491 57x xxx" },
  UK: { re: /^07700 ?900 ?\d{3}$/, desc: "the Ofcom drama range 07700 900xxx" },
  NZ: { re: /^021 ?555 ?01\d{2}$/, desc: "the chosen NZ range 021 555 01xx" },
};
for (const p of patients) {
  const rule = PHONE_RANGE[p.country];
  if (rule && !rule.re.test((p.phone ?? "").trim())) err(`patients.json ${p.id}`, `phone ${p.phone} is not in ${rule.desc}`);
}
const MOBILE_LIKE = /(?<!\d)(?:0491|07700|021)(?: ?\d){6,7}(?!\d)/g;
for (const msg of messages) {
  const p = patientById.get(msg.patientId);
  const texts = [msg.subject ?? "", msg.body ?? "", ...(msg.thread ?? []).map((t) => t.body ?? "")];
  const hits = texts.flatMap((text) => text.match(MOBILE_LIKE) ?? []);
  const own = (p?.phone ?? "").replace(/\D/g, "");
  // A patient may quote a new number next to the one on record (a phone change); a lone different number is suspicious.
  const quotesOwn = hits.some((h) => h.replace(/\D/g, "") === own);
  for (const hit of hits) {
    const ok = Object.values(PHONE_RANGE).some((r) => r.re.test(hit.trim()));
    if (!ok) err(`messages.json ${msg.id}`, `phone ${hit} is not in a fictional range`);
    else if (p && !quotesOwn) warn(`messages.json ${msg.id}`, `quotes phone ${hit}, but ${p.id}'s record has ${p.phone}`);
  }
}

// Personal details quoted in a message must match the patient record (the redaction step relies on them).
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const digits = (s: string) => s.replace(/\D/g, "");
for (const msg of messages) {
  const p = patientById.get(msg.patientId);
  if (!p) continue;
  const w = `messages.json ${msg.id}`;
  const text = `${msg.subject ?? ""}\n${msg.body}`;
  // A date from the last 15 years ("valid from 18/09/2026") is not an adult patient's birth date. A red-team message may
  // quote the birth date of another patient it names in full (a third-party request).
  const dobsQuotable = new Set([...patientsNamedIn(msg)].map((id) => patientById.get(id)?.dob));
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(19\d{2}|20\d{2})\b/g)) {
    const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    if (Number(m[3]) > Number(WINDOW_FIRST.slice(0, 4)) - 15) continue;
    if (!dobsQuotable.has(iso)) err(w, `quotes a date of birth ${m[0]}, but ${p.id} was born ${p.dob}`);
  }
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)? (January|February|March|April|May|June|July|August|September|October|November|December) (19\d{2}|200\d)\b/gi)) {
    const iso = `${m[3]}-${String(MONTHS.indexOf(m[2].toLowerCase()) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    if (iso !== p.dob) err(w, `quotes a date of birth "${m[0]}", but ${p.id} was born ${p.dob}`);
  }
  const ids = p.identifiers ?? {};
  for (const m of text.matchAll(/\bNHS(?: number)?(?: is)?:? (\d{3} ?\d{3} ?\d{4})\b/gi))
    if (digits(m[1]) !== digits(ids.nhs ?? "")) err(w, `quotes NHS number ${m[1]}, record has ${ids.nhs ?? "none"}`);
  for (const m of text.matchAll(/\bNHI(?: number)?(?: is)?:? ([A-Z]{3}\d{4})\b/g))
    if (m[1] !== ids.nhi) err(w, `quotes NHI ${m[1]}, record has ${ids.nhi ?? "none"}`);
  for (const m of text.matchAll(/\bMedicare(?: number)?(?: is)?:? (\d{4} ?\d{5} ?\d)\b/gi))
    if (digits(m[1]) !== digits(ids.medicare ?? "")) err(w, `quotes Medicare number ${m[1]}, record has ${ids.medicare ?? "none"}`);
}

// ---------- 8. Labels ----------

const labelIds = new Set<string>();
const messageById = new Map(messages.map((m) => [m.id, m]));
labels.forEach((l, i) => {
  const w = `testset.json ${l.messageId ?? `#${i + 1}`}`;
  if (labelIds.has(l.messageId)) err(w, "more than one label for this message");
  labelIds.add(l.messageId);
  const msg = messageById.get(l.messageId);
  if (!msg) err(w, "no message with this id");
  else if (messages[i]?.id !== l.messageId) err(w, `label order differs from messages.json at position ${i + 1}`);

  const cat = l.expectedCategory;
  if (!ALL_CATEGORIES.includes(cat)) err(w, `invalid category ${cat}`);
  if (!ROUTES.includes(l.expectedRoute)) err(w, `invalid route ${l.expectedRoute}`);
  if (typeof l.mustHold !== "boolean") err(w, "mustHold must be true or false");
  if (l.tricky !== undefined && typeof l.tricky !== "boolean") err(w, "tricky must be true or false");
  if (l.tricky && !l.note?.trim()) err(w, "tricky cases need a note");
  if (isRedTeam(l.messageId) && l.tricky !== true) err(w, "red-team cases are tricky by definition (tricky: true)");

  if (SAFETY.has(cat)) {
    if (l.expectedRoute !== SAFETY_ROUTE[cat]) err(w, `${cat} must route to ${SAFETY_ROUTE[cat]}, not ${l.expectedRoute}`);
  } else if (ALL_CATEGORIES.includes(cat)) {
    if (l.expectedRoute === "clinician" || l.expectedRoute === "urgent")
      err(w, `routine category ${cat} cannot route to ${l.expectedRoute} (label it with the safety category)`);
    if (PERSON_ONLY.has(cat) && l.expectedRoute !== "person") err(w, `${cat} must route to person, not ${l.expectedRoute}`);
  }
  if (l.expectedRoute === "urgent" && l.mustHold !== true) err(w, "urgent labels must have mustHold true");

  if (msg && l.note) {
    const p = patientById.get(msg.patientId);
    // A red-team note may compare the case with other patients' messages and records; each id must still exist.
    if (p) checkRefs(`${w} note`, l.note, p.id, isRedTeam(l.messageId) ? new Set(patientById.keys()) : new Set([p.id]));
  }
});
for (const m of messages) if (!labelIds.has(m.id)) err(`testset.json`, `no label for ${m.id}`);

// ---------- 8b. Safety storylines ----------

// A death reported for a patient who earlier reported a side effect, a serious reaction or a crisis reads as the product
// causing it, which the demo must never suggest. Every death in the data is unrelated to treatment, so a bereavement
// goes only to a patient with no such message (a clinical question on its own is fine), and each patient dies once.
const labelById = new Map(labels.map((l) => [l.messageId, l]));
const LINKED_TO_TREATMENT = new Set<string>(["side_effect", "adverse_event", "crisis"]);
const deathReports = new Map<string, string>();
// The red-team slice borrows desk patients and is scored one message at a time, so a red-team death is checked against
// the desk storyline only, and a clash is a warning (reassign the patient) rather than an error. Red-team messages
// never count as a desk patient's history.
for (const m of messages) {
  if (labelById.get(m.id)?.expectedCategory !== "bereavement") continue;
  const w = `messages.json ${m.id}`;
  const red = isRedTeam(m.id);
  const flag = red ? warn : err;
  const earlier = deathReports.get(m.patientId);
  if (earlier) flag(w, `reports the death of ${m.patientId}, already reported in ${earlier}`);
  if (!red) deathReports.set(m.patientId, m.id);
  for (const other of messages) {
    if (other.patientId !== m.patientId || other.id === m.id || isRedTeam(other.id)) continue;
    const cat = labelById.get(other.id)?.expectedCategory;
    if (cat && LINKED_TO_TREATMENT.has(cat))
      flag(w, `reports the death of ${m.patientId}, who also sent a ${cat.replace("_", " ")} message (${other.id}); give the death report to a patient with no safety history`);
  }
}

// The agent desk shows the queue only; the red-team slice is test-only. Keep its week believable for a support lead.
const DESK_LIMITS: Partial<Record<Category, number>> = { bereavement: 4, crisis: 3, adverse_event: 8 };
for (const [cat, max] of Object.entries(DESK_LIMITS) as [Category, number][]) {
  const n = messages.filter((m) => !isRedTeam(m.id) && labelById.get(m.id)?.expectedCategory === cat).length;
  if (n > max) warn("messages.json", `the desk queue has ${n} ${cat.replace("_", " ")} messages in one week (keep it to ${max} or fewer)`);
}

// ---------- 9. Scenarios (authoring seeds, optional) ----------

let scenarios: Scenario[] = [];
try {
  scenarios = asArray<Scenario>(readJsonFile(dataPath("scenarios.json")), "scenarios");
} catch {
  scenarios = [];
}
const seedIds = new Set<string>();
for (const s of scenarios) {
  const w = `scenarios.json ${s.seedId}`;
  if (seedIds.has(s.seedId)) err(w, "duplicate seedId");
  seedIds.add(s.seedId);
  if (!patientById.has(s.patientId)) err(w, `patient ${s.patientId} does not exist`);
  if (!ALL_CATEGORIES.includes(s.category)) err(w, `invalid category ${s.category}`);
  if (!ROUTES.includes(s.route)) err(w, `invalid route ${s.route}`);
  if (s.receivedAt !== undefined && !isIsoDateTime(s.receivedAt)) err(w, `receivedAt ${s.receivedAt} is not an ISO datetime`);
}

// ---------- 10. Distribution ----------

function table(title: string, rows: Map<string, number>, total: number) {
  console.log(`\n${title}`);
  const width = Math.max(...[...rows.keys()].map((k) => k.length), 8);
  for (const [k, v] of [...rows.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`  ${k.padEnd(width)}  ${String(v).padStart(4)}  ${((v / Math.max(total, 1)) * 100).toFixed(1).padStart(5)}%`);
  }
}

const labelled = labels.filter((l) => messageById.has(l.messageId));
const countryOf = (l: TestLabel) => patientById.get(messageById.get(l.messageId)!.patientId)?.country ?? "?";
console.log(`Care Desk data (fictional): ${patients.length} patients, ${messages.length} messages, ${labels.length} labels, ${policy.length} policy sections, ${helplines.length} helplines, ${staff.length} staff`);

console.log("\nBy category and route");
const cats = [...ALL_CATEGORIES];
const header = `  ${"category".padEnd(18)} ${ROUTES.map((r) => r.padStart(10)).join("")}  ${"total".padStart(6)}  ${"hold".padStart(5)}  ${"tricky".padStart(6)}`;
console.log(header);
for (const c of cats) {
  const rows = labelled.filter((l) => l.expectedCategory === c);
  if (!rows.length) {
    console.log(`  ${c.padEnd(18)} ${ROUTES.map(() => "-".padStart(10)).join("")}  ${"0".padStart(6)}   (none)`);
    continue;
  }
  const cells = ROUTES.map((r) => String(rows.filter((l) => l.expectedRoute === r).length || "-").padStart(10)).join("");
  console.log(
    `  ${c.padEnd(18)} ${cells}  ${String(rows.length).padStart(6)}  ${String(rows.filter((l) => l.mustHold).length).padStart(5)}  ${String(rows.filter((l) => l.tricky).length).padStart(6)}`,
  );
}
const totalCells = ROUTES.map((r) => String(labelled.filter((l) => l.expectedRoute === r).length).padStart(10)).join("");
console.log(
  `  ${"TOTAL".padEnd(18)} ${totalCells}  ${String(labelled.length).padStart(6)}  ${String(labelled.filter((l) => l.mustHold).length).padStart(5)}  ${String(labelled.filter((l) => l.tricky).length).padStart(6)}`,
);

table("By route", countBy(labelled, (l) => l.expectedRoute), labelled.length);
table("By country", countBy(labelled, countryOf), labelled.length);
table("By channel", countBy(messages, (m) => m.channel), messages.length);
table("Tricky", countBy(labelled, (l) => (l.tricky ? "tricky" : "standard")), labelled.length);
table(
  "Safety vs routine",
  countBy(labelled, (l) => (SAFETY.has(l.expectedCategory) ? "safety" : "routine")),
  labelled.length,
);
table("By day received (local)", countBy(messages, (m) => m.receivedAt.slice(0, 10)), messages.length);
// Red-team slice: a rules-only look (no sorter, no AI) at how the safety rules do on phrasings they were not written
// for. Informational: npm run eval is the release gate and scores the full pipeline.
{
  const slice = labelled.filter((l) => isRedTeam(l.messageId));
  if (slice.length) {
    const misses: string[] = [];
    let caughtByRules = 0;
    for (const l of slice) {
      const msg = messageById.get(l.messageId)!;
      const text = msg.subject ? `${msg.subject}

${msg.body}` : msg.body;
      const verdict = routeForHits(checkRules(text).hits);
      const expectSafety = l.expectedRoute === "clinician" || l.expectedRoute === "urgent";
      const ok = expectSafety
        ? !!verdict && (l.expectedRoute !== "urgent" || verdict.route === "urgent") && (!l.mustHold || verdict.holdOrders)
        : !verdict;
      if (ok) caughtByRules++;
      else misses.push(`${l.messageId} expected ${l.expectedRoute} (${l.expectedCategory}), rules gave ${verdict ? verdict.route : "no safety hit"}`);
    }
    console.log(`
Red-team slice (held out, ${slice.length} cases): rules alone route ${caughtByRules} of ${slice.length} correctly`);
    for (const m of misses) console.log(`  - ${m}`);
  }
  const desk = labelled.filter((l) => !isRedTeam(l.messageId));
  const deskCount = (cat: Category) => desk.filter((l) => l.expectedCategory === cat).length;
  console.log(
    `Desk queue (red-team slice is test-only): ${desk.length} messages, ${deskCount("bereavement")} bereavements, ${deskCount("crisis")} crisis, ${deskCount("adverse_event")} adverse events`,
  );
}

const missingCats = ALL_CATEGORIES.filter((c) => !labelled.some((l) => l.expectedCategory === c));
if (missingCats.length) warn("testset.json", `no examples of ${missingCats.join(", ")}`);

// ---------- 11. Result ----------

if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  ! ${w}`);
}
if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  for (const e of errors.slice(0, 200)) console.error(`  x ${e}`);
  if (errors.length > 200) console.error(`  ... and ${errors.length - 200} more`);
  process.exit(1);
}
console.log("\nAll data checks passed.");
