/**
 * Step 4: find sources. The patient's own records (orders, charges, appointments, plan) and the most relevant
 * sections of the sample support policy. Every SourceRef.text is the exact wording the drafter may quote, and the
 * fact checker verifies the draft against the same text.
 *
 * Runs in Node, the browser and a Cloudflare Worker (no Node-only APIs). The policy JSON is bundled at build time.
 */
import type {
  Appointment,
  AppointmentKind,
  Category,
  Charge,
  Country,
  Currency,
  Order,
  OrderStatus,
  Patient,
  PolicySection,
  SourceRef,
} from "@/lib/types";
import { SAFETY_CATEGORIES } from "@/lib/types";
import policyData from "@/data/policy.json";
import { DEMO_TODAY } from "./check";
import { formatMoney } from "../format";

// ---------- formatting (shared with the UI and the fact checker) ----------

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
];

function isoParts(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

/** "2026-09-18T10:12:00+10:00" -> "18 September 2026". Uses the local date written in the ISO string. */
export function formatDate(iso: string): string {
  const p = isoParts(iso);
  return p ? `${p.d} ${MONTH_NAMES[p.m - 1]} ${p.y}` : iso;
}

const SHORT_MONTH_RE = /\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.? (\d{4})\b/g;

/**
 * Free text copied into a record from the data (a charge description, a hold reason) with the month written in full:
 * "due 1 Sep 2026" -> "due 1 September 2026", as every other record date is written, so a draft that copies dates
 * exactly never mixes "1 Sep 2026" with "8 September 2026" (MSG-0034). Only day-month-year dates change.
 */
export function fullMonthDates(text: string): string {
  return text.replace(SHORT_MONTH_RE, (whole: string, d: string, mon: string, y: string) => {
    const i = MONTH_NAMES.findIndex((n) => n.startsWith(mon.slice(0, 3)));
    return i >= 0 ? `${d} ${MONTH_NAMES[i]} ${y}` : whole;
  });
}

/** "2026-09-18" -> "18 Sep". */
export function formatShortDate(iso: string): string {
  const p = isoParts(iso);
  return p ? `${p.d} ${MONTH_NAMES[p.m - 1].slice(0, 3)}` : iso;
}

/**
 * Dates for source titles: "18 Sep" in the demo's own year, "13 Nov 2025" otherwise, so a past appointment never
 * reads as a future one.
 */
export function formatLabelDate(iso: string): string {
  const p = isoParts(iso);
  const demoYear = Number(DEMO_TODAY.slice(0, 4));
  return p && p.y !== demoYear ? `${formatShortDate(iso)} ${p.y}` : formatShortDate(iso);
}

/** "2026-09-25T15:30:00+10:00" -> "3:30 pm" (the local time written in the ISO string). */
export function formatTime(iso: string): string | null {
  const m = /T(\d{2}):(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  const h = +m[1];
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

/**
 * Local style, so a reply can copy it as written: 129 + "AUD" -> "$129.00 AUD", 89 + "NZD" -> "$89.00 NZD",
 * 49.9 + "GBP" -> "£49.90". Dollar amounts keep the code, because AU and NZ both use "$". Negative amounts keep
 * their sign ("-$40.00 AUD").
 */
export function formatAmount(amount: number, currency: Currency): string {
  const sign = amount < 0 ? "-" : "";
  const figure = Math.abs(amount).toFixed(2);
  return currency === "GBP" ? `${sign}£${figure}` : `${sign}$${figure} ${currency}`;
}

function time(iso: string | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

// ---------- records ----------

const DAY_MS = 24 * 60 * 60 * 1000;

const ORDER_STATUS_TEXT: Record<OrderStatus, string> = {
  script_pending: "waiting for script approval",
  dispensing: "being dispensed by the pharmacy",
  shipped: "shipped",
  delivered: "delivered",
  on_hold: "on hold",
  cancelled: "cancelled",
};
const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  script_pending: "waiting for script",
  dispensing: "being dispensed",
  shipped: "shipped",
  delivered: "delivered",
  on_hold: "on hold",
  cancelled: "cancelled",
};
const APPOINTMENT_KIND_TEXT: Record<AppointmentKind, string> = {
  initial: "initial consult",
  follow_up: "follow-up consult",
  renewal: "renewal consult",
};

export function orderSource(o: Order): SourceRef {
  const parts = [`status ${ORDER_STATUS_TEXT[o.status] ?? o.status}`, `placed ${formatDate(o.placedAt)}`];
  if (o.holdReason) parts.push(`hold reason: ${fullMonthDates(o.holdReason)}`);
  if (o.shippedAt) parts.push(`shipped ${formatDate(o.shippedAt)}`);
  if (o.carrier) parts.push(`carrier ${o.carrier}`);
  if (o.tracking) parts.push(`tracking ${o.tracking}`);
  if (o.eta && o.status !== "delivered") parts.push(`estimated delivery ${formatDate(o.eta)}`);
  if (o.deliveredAt) parts.push(`delivered ${formatDate(o.deliveredAt)}`);
  parts.push(`items: ${o.items.map((i) => `${i.name} x${i.qty}`).join(", ")}`);
  parts.push(`total ${formatAmount(o.total, o.currency)}`);

  let when = `placed ${formatLabelDate(o.placedAt)}`;
  if (o.status === "shipped" && o.shippedAt) when = `shipped ${formatLabelDate(o.shippedAt)}`;
  else if (o.status === "delivered" && o.deliveredAt) when = `delivered ${formatLabelDate(o.deliveredAt)}`;
  else if (o.status !== "shipped" && o.status !== "delivered") when = `${ORDER_STATUS_LABEL[o.status]}, placed ${formatLabelDate(o.placedAt)}`;

  return { id: o.id, kind: "order", label: `Order ${o.id}, ${when}`, text: `Order ${o.id}: ${parts.join("; ")}` };
}


/** Weekdays (Monday to Friday) after `from` up to and including `to`, both local ISO dates. 0 when `to` is not later. */
function weekdaysBetween(from: { y: number; m: number; d: number }, to: { y: number; m: number; d: number }): number {
  const start = Date.UTC(from.y, from.m - 1, from.d);
  const end = Date.UTC(to.y, to.m - 1, to.d);
  let n = 0;
  for (let t = start + DAY_MS; t <= end; t += DAY_MS) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

/**
 * The plain status line for an open order that is past its estimated delivery date on the day a message was sent
 * (`asOf`, the message's receivedAt), worked out here so the drafter can follow P4.2 (1 business day past the ETA:
 * share the tracking and reassure; 2: open a trace) without doing date arithmetic itself (MSG-0066). Undefined when the
 * ETA is the message's own day or later, and for any order not recorded as shipped: a parcel with the courier is what
 * P4.2 is about, and an order on hold or still with the pharmacy (ORD-20029, on hold since before its ETA) must not
 * read as a parcel to trace.
 *
 * Written as "1 business day past its estimated delivery date" ("N business days" otherwise), so a draft that says so
 * finds the fact, word for word, in the order it cites (MSG-0066). No new date. The fact checker reads a figure
 * followed by "past" as lateness, which supports only a lateness figure in a draft: this line never makes "arrives in
 * 1 business day" pass. Local dates as written in the ISO strings are compared; weekends are skipped, public holidays
 * are not known.
 */
export function lateOrderNote(o: Order, asOf: string | undefined): string | undefined {
  if (!asOf || !o.eta || o.status !== "shipped") return undefined;
  const eta = isoParts(o.eta);
  const now = isoParts(asOf);
  if (!eta || !now) return undefined;
  const late = Date.UTC(now.y, now.m - 1, now.d) > Date.UTC(eta.y, eta.m - 1, eta.d);
  if (!late) return undefined;
  return lateNoteText(weekdaysBetween(eta, now));
}

/** The past-ETA status line for an order that is `weekdays` business days past its ETA (see lateOrderNote). */
export function lateNoteText(weekdays: number): string {
  return `${weekdays} business ${weekdays === 1 ? "day" : "days"} past its estimated delivery date as of this message (weekends not counted)`;
}

/** How far back a delivery still gets a days-since-delivery line (deliveredNote). */
const DELIVERED_NOTE_MAX_DAYS = 30;

/**
 * The plain line for an order delivered shortly before the message was sent (`asOf`): "6 days since delivery as of
 * this message (calendar days)", worked out here so a reply about a damaged parcel can say the 7-day photo window in
 * P4.2 was met without doing date arithmetic itself (MSG-0950). Undefined for any order not recorded as delivered, a
 * delivery on or after the message's own day, and a delivery more than 30 days before it. Local dates as written in
 * the ISO strings are compared.
 */
export function deliveredNote(o: Order, asOf: string | undefined): string | undefined {
  if (!asOf || !o.deliveredAt || o.status !== "delivered") return undefined;
  const at = isoParts(o.deliveredAt);
  const now = isoParts(asOf);
  if (!at || !now) return undefined;
  const days = Math.round((Date.UTC(now.y, now.m - 1, now.d) - Date.UTC(at.y, at.m - 1, at.d)) / DAY_MS);
  if (days < 1 || days > DELIVERED_NOTE_MAX_DAYS) return undefined;
  return `${days} ${days === 1 ? "day" : "days"} since delivery as of this message (calendar days)`;
}

/** An order record with the past-ETA line (lateOrderNote) or the days-since-delivery line (deliveredNote) appended. */
function withLateNote(ref: SourceRef, p: Patient, asOf: string | undefined): SourceRef {
  if (!asOf || ref.kind !== "order") return ref;
  const o = p.orders?.find((x) => x.id === ref.id);
  const note = o ? (lateOrderNote(o, asOf) ?? deliveredNote(o, asOf)) : undefined;
  return note ? { ...ref, text: `${ref.text}; ${note}` } : ref;
}

export function chargeSource(c: Charge): SourceRef {
  const money = c.amount < 0 ? `refund of ${formatAmount(-c.amount, c.currency)}` : formatAmount(c.amount, c.currency);
  const text = `Charge ${c.id}: ${fullMonthDates(c.description)}; ${money}; status ${c.status}; charged ${formatDate(c.at)}; type ${c.kind}`;
  // The title uses the desk's explicit money format ("A$214.00"); the text keeps the local style the drafter copies.
  const label = `${c.amount < 0 ? "Refund" : "Charge"} ${c.id}, ${formatLabelDate(c.at)}, ${formatMoney(Math.abs(c.amount), c.currency, { explicit: true })}`;
  return { id: c.id, kind: "charge", label, text };
}

export function appointmentSource(a: Appointment): SourceRef {
  const t = formatTime(a.at);
  const when = `${formatDate(a.at)}${t ? ` at ${t} (patient's local time)` : ""}`;
  const text = `Appointment ${a.id}: ${APPOINTMENT_KIND_TEXT[a.kind] ?? a.kind}; ${when}; clinician ${a.clinician}; status ${a.status}`;
  return { id: a.id, kind: "appointment", label: `Appointment ${a.id}, ${formatLabelDate(a.at)}, ${a.status}`, text };
}

export function planSource(p: Patient): SourceRef {
  const plan = p.plan;
  const parts = [`status ${plan.status}`, `price ${formatAmount(plan.monthlyPrice, plan.currency)} per month`];
  if (plan.concession) parts.push("concession pricing applied");
  parts.push(`started ${formatDate(plan.startedAt)}`);
  if (plan.nextBillingDate) parts.push(`next billing date ${formatDate(plan.nextBillingDate)}`);
  return { id: "PLAN", kind: "plan", label: `Plan: ${plan.name}, ${plan.status}`, text: `Plan: ${plan.name}; ${parts.join("; ")}` };
}

/**
 * Everything in a patient's record as sources, for a "what's in the record" list: the plan, then orders, charges and
 * appointments, each newest first.
 */
export function recordSourcesNewestFirst(p: Patient): SourceRef[] {
  const newest = <T,>(xs: T[] | undefined, at: (x: T) => string) => [...(xs ?? [])].sort((a, b) => time(at(b)) - time(at(a)));
  return [
    planSource(p),
    ...newest(p.orders, (o) => o.placedAt).map(orderSource),
    ...newest(p.charges, (c) => c.at).map(chargeSource),
    ...newest(p.appointments, (a) => a.at).map(appointmentSource),
  ];
}

const OPEN_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>(["script_pending", "dispensing", "shipped", "on_hold"]);

function ordersNewestFirst(p: Patient): Order[] {
  return [...(p.orders ?? [])].sort((a, b) => time(b.placedAt) - time(a.placedAt));
}

/** Non-delivered orders (up to 3, newest first) plus the most recent order. */
function relevantOrders(p: Patient): Order[] {
  const all = ordersNewestFirst(p);
  const picked = all.filter((o) => OPEN_STATUSES.has(o.status)).slice(0, 3);
  if (all[0] && !picked.includes(all[0])) picked.push(all[0]);
  return picked.sort((a, b) => time(b.placedAt) - time(a.placedAt));
}

/** The order that ships next: the newest open order, or else the newest order. */
function nextOrder(p: Patient): Order | undefined {
  const all = ordersNewestFirst(p);
  return all.find((o) => OPEN_STATUSES.has(o.status)) ?? all[0];
}

function lastCharges(p: Patient, n: number): Charge[] {
  return [...(p.charges ?? [])].sort((a, b) => time(b.at) - time(a.at)).slice(0, n);
}

/** Booked appointments (soonest first) plus the most recent past one, at most 3. */
function relevantAppointments(p: Patient): Appointment[] {
  const all = p.appointments ?? [];
  const booked = all.filter((a) => a.status === "booked").sort((a, b) => time(a.at) - time(b.at));
  const past = all.filter((a) => a.status !== "booked").sort((a, b) => time(b.at) - time(a.at));
  return [...booked.slice(0, 2), ...past.slice(0, 1)].slice(0, 3);
}

const RECORD_ID_RE = /\b(?:ORD|CHG|APT)-\d+\b/gi;

/** Record ids written in a piece of text, upper-cased, in order of first mention. */
function idsIn(text: string | undefined): string[] {
  const out: string[] = [];
  for (const m of (text ?? "").matchAll(RECORD_ID_RE)) {
    const id = m[0].toUpperCase();
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** The patient's own records with these ids (ids that are not the patient's are ignored). */
function recordsById(p: Patient, ids: string[]): SourceRef[] {
  const out: SourceRef[] = [];
  for (const id of ids) {
    const o = p.orders?.find((x) => x.id.toUpperCase() === id);
    if (o) {
      out.push(orderSource(o));
      continue;
    }
    const c = p.charges?.find((x) => x.id.toUpperCase() === id);
    if (c) {
      out.push(chargeSource(c));
      continue;
    }
    const a = p.appointments?.find((x) => x.id.toUpperCase() === id);
    if (a) out.push(appointmentSource(a));
  }
  return out;
}

/** Missed appointments first (newest first, up to 2), then the usual booked and recent ones, at most 3. */
function consultAppointments(p: Patient): Appointment[] {
  const missed = (p.appointments ?? []).filter((a) => a.status === "missed").sort((a, b) => time(b.at) - time(a.at)).slice(0, 2);
  const out = [...missed];
  for (const a of relevantAppointments(p)) if (!out.includes(a)) out.push(a);
  return out.slice(0, 3);
}

function isConsultCharge(c: Charge): boolean {
  return c.kind === "consult" || /\bconsult/i.test(c.description ?? "");
}

/** Orders a failed or pending payment holds up: on hold, or waiting for a script (newest first, up to 3). */
function heldOrders(p: Patient): Order[] {
  return ordersNewestFirst(p)
    .filter((o) => o.status === "on_hold" || o.status === "script_pending")
    .slice(0, 3);
}

/** The most recent completed appointment: the consult that changed or renewed a script. */
function lastCompletedAppointment(p: Patient): Appointment | undefined {
  return [...(p.appointments ?? [])].filter((a) => a.status === "completed").sort((a, b) => time(b.at) - time(a.at))[0];
}

/** Consult or missed-consult charges from the 30 days up to `today` (ISO date), newest first. */
function recentConsultCharges(p: Patient, today: string): Charge[] {
  const end = Date.parse(`${today.slice(0, 10)}T23:59:59Z`);
  const from = end - 31 * DAY_MS;
  return [...(p.charges ?? [])]
    .filter((c) => isConsultCharge(c) && time(c.at) >= from && time(c.at) <= end)
    .sort((a, b) => time(b.at) - time(a.at));
}

/** Charges plus what they refer to: an order or charge their description names, and appointments for a consult fee. */
function chargesWithContext(p: Patient, charges: Charge[]): SourceRef[] {
  const refs = charges.map(chargeSource);
  const named = charges.flatMap((c) => idsIn(c.description));
  refs.push(...recordsById(p, named));
  if (charges.some(isConsultCharge)) refs.push(...consultAppointments(p).map(appointmentSource));
  return refs;
}

/** Keep the first source with each id. */
function dedupe(refs: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

/**
 * Choose the patient facts relevant to the message type. Always includes a PLAN source.
 *  any category                     first, every order, charge or appointment of this patient that the message names
 *                                   by id ("ORD-20019"), so a reply is never about the wrong record
 *  order_status, delivery_problem   open orders plus the most recent order, then the plan; when an order status
 *                                   question has an order waiting for a script, also the last charge (payment is often
 *                                   the question) and the most recent completed consult (the one that changed the script)
 *  billing, price_change            the last 3 charges, any order or charge they name, the appointments behind a
 *                                   consult fee, and the plan; when one of those charges failed or is pending, also the
 *                                   orders it holds up (on hold or waiting for a script)
 *  plan_change                      the plan and the next order
 *  appointment, script_renewal      appointments, the plan and the last order; for appointment, also consult and
 *                                   missed-consult charges from the last 30 days ("was that $49 charge for this?");
 *                                   for script_renewal with an order waiting for a script, also that order and the
 *                                   last charge ("have I been charged for it yet?")
 *  safety categories                open orders (the ones a hold affects), latest appointment, the plan
 *  complaint, product_question, other   the most recent order and the plan
 *  account_access, privacy_request, wants_human   the plan only
 *
 * Pass the (redacted) message text as `text` so named records are included. Ids survive redaction. `opts.today`
 * (ISO date, default DEMO_TODAY) sets the 30-day window for consult charges; it is passed in, never read from a clock.
 * `opts.asOf` (the message's receivedAt) adds a status line to each open order that is past its estimated delivery
 * date on that day (lateOrderNote); without it the records are exactly as before.
 */
export function selectRecords(
  patient: Patient,
  category: Category,
  text?: string,
  opts: { today?: string; asOf?: string } = {},
): SourceRef[] {
  const named = recordsById(patient, idsIn(text));
  const namedCharges = named.flatMap((r) => (r.kind === "charge" ? (patient.charges ?? []).filter((c) => c.id === r.id) : []));
  // Context for a charge the patient names: the order it mentions, or the appointments behind a consult fee.
  const namedContext = chargesWithContext(patient, namedCharges);
  const refs = dedupe([...named, ...namedContext, ...byCategory(patient, category, opts.today ?? DEMO_TODAY)]);
  return opts.asOf ? refs.map((r) => withLateNote(r, patient, opts.asOf)) : refs;
}

function byCategory(patient: Patient, category: Category, today: string): SourceRef[] {
  const plan = planSource(patient);
  const lastOrder = ordersNewestFirst(patient)[0];
  switch (category) {
    case "order_status":
    case "delivery_problem": {
      const orders = relevantOrders(patient);
      const waiting = category === "order_status" && orders.some((o) => o.status === "script_pending");
      const charge = waiting ? lastCharges(patient, 1) : [];
      const consult = waiting ? lastCompletedAppointment(patient) : undefined;
      return [...orders.map(orderSource), ...charge.map(chargeSource), ...(consult ? [appointmentSource(consult)] : []), plan];
    }
    case "billing":
    case "price_change": {
      const charges = lastCharges(patient, 3);
      // "Does this mean my order won't come?": a failed or pending payment holds an order, so the draft can say so.
      const unpaid = charges.some((c) => c.status === "failed" || c.status === "pending");
      const held = unpaid ? heldOrders(patient).map(orderSource) : [];
      return [...chargesWithContext(patient, charges), ...held, plan];
    }
    case "plan_change": {
      const next = nextOrder(patient);
      return [plan, ...(next ? [orderSource(next)] : [])];
    }
    case "appointment":
    case "script_renewal": {
      // "I'm guessing that's what the $49 charge was for": a recent consult or missed-consult fee, with its appointments.
      const fees = category === "appointment" ? chargesWithContext(patient, recentConsultCharges(patient, today)) : [];
      // "Have I been charged for it yet?" on an order waiting for a script (MSG-0155, MSG-0182): the waiting order and
      // the last charge, as for an order status question, so the draft answers from the record.
      const waiting = category === "script_renewal" ? relevantOrders(patient).filter((o) => o.status === "script_pending") : [];
      const charge = waiting.length > 0 ? lastCharges(patient, 1) : [];
      return [
        ...relevantAppointments(patient).map(appointmentSource),
        ...fees,
        ...waiting.map(orderSource),
        ...charge.map(chargeSource),
        plan,
        ...(lastOrder ? [orderSource(lastOrder)] : []),
      ];
    }
    case "clinical_question":
    case "side_effect":
    case "adverse_event":
    case "crisis":
    case "bereavement": {
      const open = ordersNewestFirst(patient).filter((o) => OPEN_STATUSES.has(o.status)).slice(0, 3);
      const orders = open.length > 0 ? open : lastOrder ? [lastOrder] : [];
      const appt = relevantAppointments(patient)[0];
      return [...orders.map(orderSource), ...(appt ? [appointmentSource(appt)] : []), plan];
    }
    case "complaint":
    case "product_question":
    case "other":
      return [...(lastOrder ? [orderSource(lastOrder)] : []), plan];
    case "account_access":
    case "privacy_request":
    case "wants_human":
    default:
      return [plan];
  }
}

// ---------- policy search (BM25 with a category prior) ----------

const STOPWORDS = new Set(
  (
    "a an and are as at be been but by can could did do does for from had has have hi hello hey how i i'm im if in into " +
    "is it its just me my of on or our please so than thank thanks that the their them then there these they this to " +
    "up us was we were what when where which who why will with would you your yours am any get got also still yet " +
    "cheers regards dear kind very really real " +
    // Everyday filler that says nothing about the topic ("just want to know", "heading away", "when's my next one
    // coming"). Left in, these outweighed the words that matter and pulled in unrelated sections.
    "want wanna know need needed here out before after away next coming come back something else anything around " +
    "last one ok okay thing things wondering wonder hope well let tell sure soon going gonna should might maybe bit " +
    "lot quick quickly again already now today tomorrow yesterday"
  ).split(" "),
);

/**
 * Plain phrases patients use for ideas the handbook names, rewritten into the handbook's own words before the query
 * is tokenised: "get here" is an arrival, "sent out" is a dispatch. Applied to the query only, never to the sections.
 */
const QUERY_PHRASES: [RegExp, string][] = [
  [/\b(?:get|gets|getting|got) (?:here|to me|to you|to my place|through)\b|\bturn(?:s|ed|ing)? up\b|\bshow(?:s|ed)? up\b/gi, " arrive "],
  [/\b(?:sen[dt]|sends|sending|go|goes|going|went|gone|head|heads|headed|heading) out\b|\bposted\b|\bon (?:its|it's|the) way\b/gi, " dispatch "],
  [/\bnext (?:order|delivery|box|parcel|lot|one|repeat|shipment)\b|\bwhen(?:'s|’s| is| will| does)? my next\b/gi, " repeat order dispatch "],
  [/\bsorry we missed you\b|\bcard (?:in|through) the door\b/gi, " missed delivery card "],
  [
    /\b(?:hasn't|hasnt|has not|haven't|havent|have not|still not|not yet|never|didn't|didnt|did not) (?:\w+ )?(?:arrived|turned up|shown up|come|got here|been delivered|received)\b|\bstill (?:nothing|no sign|waiting)\b/gi,
    " not arrived late ",
  ],
  [/\b(?:switch|swap|move|change|upgrade|downgrade)(?:e?d|ing|s)? (?:\w+ )?(?:to|plans?|over)\b/gi, " change plan "],
  // A refund to a card other than the one charged: the handbook says refunds go back to the original card (MSG-0930).
  [/\b(?:new|different|other|another|replaced|replacement|old|cancelled|canceled|expired) card\b/gi, " refund original card "],
];

/**
 * Order and delivery questions only. Words that mean "what if nobody is there to take the parcel" point at the
 * missed-deliveries and signatures section (P4.3): "will it just sit at the depot until I'm back" (MSG-0951), "make
 * sure someone's home to sign for it", "can I collect it". Scoped to these two types, and to the parcel sense of each
 * word: an order "held until the new prescription is approved" is a script hold, "no sign of it" is not a signature,
 * and "sign in" is an account question.
 */
const MISSED_DELIVERY_TERMS = " missed depot signature ";
const DELIVERY_QUERY_PHRASES: [RegExp, string][] = [
  [
    /\b(?:not|nobody|no ?one|no-one|noone|won['’]?t|wont|isn['’]?t|aren['’]?t|nobody['’]?s)\b[^.?!\n]{0,24}\bhome\b|\b(?:someone|somebody|anyone|anybody)(?:['’]s| is| will be| to be)? (?:at )?home\b|\b(?:stay|stays|staying) in\b|\b(?:be|stay|stays|staying) (?:at )?home\b|\bwork(?:s|ing)? from home\b/gi,
    MISSED_DELIVERY_TERMS,
  ],
  // Sending a parcel somewhere else needs an identity check first (P4.3 points to P8.1), so keep that section in reach
  // when the timing and missed-delivery words above crowd the results (MSG-0923).
  [
    /\bredirect(?:s|ed|ing)?\b|\b(?:send|sent|deliver|post|forward) (?:it|them|the parcel|my parcel|the order|my order|my capsules|my oil) to\b|\b(?:change|changing|update|updating|new) (?:my |of |the |delivery )*address\b/gi,
    " address identity check ",
  ],
  [/\bsignature\b|(?<!\bno )(?<!\bany )\bsign(?:s|ed|ing)?\b(?![- ](?:in|into|on to|onto|up|out|off|of)\b)/gi, MISSED_DELIVERY_TERMS],
  [/\bdepot\b|\bcard (?:left|in the letterbox|in my letterbox|under the door)\b/gi, MISSED_DELIVERY_TERMS],
  [/\bheld (?:at|there|for collection)\b|\bheld by (?:the )?(?:courier|courierline|depot|post office)\b/gi, MISSED_DELIVERY_TERMS],
  [
    /\bcollect(?:s|ed|ing|ion)?\b|\bpick(?:s|ed|ing)? (?:it |them |the parcel |the package |my parcel |my order )?up\b/gi,
    `${MISSED_DELIVERY_TERMS}collect `,
  ],
];

/**
 * Order and delivery questions only. "When will it get here", "how long", "still goes out on the 7th", "heading away
 * from Friday": a question about timing needs the delivery windows (P4.1), which give every country's figures (MSG-0097,
 * a UK patient, was told there was no UK window). A past fact ("it was delivered on 16 September") is not a timing
 * question.
 */
const DELIVERY_TIMING_RE = new RegExp(
  [
    String.raw`\bhow (?:long|soon|many (?:business )?days)\b`,
    String.raw`\bwhen (?:will|would|does|do|is|should|can|might|could)\b`,
    String.raw`\bwhen['’]s\b`,
    String.raw`\b(?:arrive|arrives|arriving|arrival|here|there|delivery) (?:by|before|in time)\b`,
    String.raw`\bin time\b`,
    String.raw`\b(?:eta|due)\b`,
    String.raw`\b(?:go|goes|going|sent|send|ships?|dispatch(?:ed|es)?) out (?:on|by|before)\b`,
    String.raw`\b(?:holiday|holidays|vacation|trip|travell?ing)\b`,
    String.raw`(?<!\bpass(?:ed|es)? )\baway (?:from|on|for|until|till|next|this)\b`,
  ].join("|"),
  "i",
);
const DELIVERY_TIMING_TERMS = " delivery how long arrival ";

const DELIVERY_CATEGORIES: ReadonlySet<Category> = new Set<Category>(["order_status", "delivery_problem"]);

function expandQuery(query: string, category?: Category): string {
  let q = query;
  for (const [re, add] of QUERY_PHRASES) q = q.replace(re, (m) => `${m}${add}`);
  if (category && DELIVERY_CATEGORIES.has(category)) {
    for (const [re, add] of DELIVERY_QUERY_PHRASES) q = q.replace(re, (m) => `${m}${add}`);
    if (DELIVERY_TIMING_RE.test(query)) q = `${q}${DELIVERY_TIMING_TERMS}`;
  }
  return q;
}

/** Very light stemmer: enough to join "deliveries" / "delivery", "charged" / "charge", "cancelling" / "cancel". */
export function stem(word: string): string {
  let t = word;
  if (t.length <= 3 || /^\d+$/.test(t)) return t;
  if (t.endsWith("ies") && t.length > 4) t = t.slice(0, -3) + "y";
  else if (t.endsWith("ing") && t.length > 5) t = undouble(t.slice(0, -3));
  else if (t.endsWith("ied") && t.length > 4) t = t.slice(0, -3) + "y";
  else if (t.endsWith("ed") && t.length > 4) t = undouble(t.slice(0, -2));
  else if (/(?:ch|sh|x|ss|z)es$/.test(t)) t = t.slice(0, -2);
  else if (t.endsWith("s") && !/(?:ss|us|is)$/.test(t)) t = t.slice(0, -1);
  if ((t.endsWith("e") || t.endsWith("y")) && t.length > 4) t = t.slice(0, -1);
  return t;
}
/** "shipp" -> "ship", "stopp" -> "stop"; a three-letter root keeps its double letter ("adding" -> "add", as "add"). */
function undouble(t: string): string {
  return t.length > 3 && /([bdgklmnprt])\1$/.test(t) ? t.slice(0, -1) : t;
}

export function tokenize(text: string): string[] {
  return (text ?? "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

/** Retrieval hints per message type, matched against section tags (after tokenising and stemming). */
export const CATEGORY_TAGS: Record<Category, string[]> = {
  order_status: ["order", "status", "shipping", "dispatch", "tracking", "dispensing", "delivery times"],
  delivery_problem: ["delivery", "delay", "late", "lost", "damaged", "courier", "missed", "address"],
  script_renewal: ["renewal", "script", "prescription", "repeat"],
  billing: ["billing", "payment", "charge", "refund", "receipt", "invoice"],
  price_change: ["price", "pricing", "concession"],
  // A plan change moves the price too ("once approved, the new price applies"), so the price section is a hint.
  plan_change: ["plan", "pause", "cancel", "cancellation", "subscription", "price change"],
  appointment: ["appointment", "consult", "reschedule", "booking"],
  account_access: ["account", "login", "password", "access"],
  product_question: ["product", "storage", "availability", "substitution", "packaging"],
  privacy_request: ["privacy", "data", "deletion", "marketing", "opt out"],
  complaint: ["complaint", "feedback"],
  wants_human: ["human", "person", "contact", "callback", "phone"],
  other: [],
  clinical_question: ["clinical", "clinician", "medical", "escalation"],
  side_effect: ["side effect", "clinical", "clinician", "escalation"],
  adverse_event: ["adverse event", "emergency", "escalation", "hold", "urgent"],
  crisis: ["crisis", "helpline", "emergency", "safety"],
  bereavement: ["bereavement", "deceased", "death", "hold"],
};

const SAFETY_SET: ReadonlySet<Category> = new Set<Category>(SAFETY_CATEGORIES);
/** Sections that describe the handbook itself or how to write, rather than facts a reply can cite. */
const META_SECTION_IDS: ReadonlySet<string> = new Set(["P1.1", "P1.2"]);
const META_TERMS: ReadonlySet<string> = new Set(tokenize("tone voice style handbook"));
/** Clinical and urgent safety protocols (section 10 of the handbook). */
function isSafetySection(s: PolicySection): boolean {
  return /^P10\./.test(s.id);
}

const K1 = 1.2;
const B = 0.75;
const TITLE_WEIGHT = 2;
const TAG_WEIGHT = 2;
/** Added to a section's score when its tags match the message type. Enough to surface it when the words are thin. */
const PRIOR_BOOST = 1.5;
const PRIOR_STEP = 0.5;
const PRIOR_MAX = 4;

interface IndexedDoc {
  section: PolicySection;
  tf: Map<string, number>;
  len: number;
  tagTokens: Set<string>;
}

export interface PolicyIndex {
  readonly sections: readonly PolicySection[];
  search(query: string, category: Category, country: Country, k?: number): SourceRef[];
}

export function createPolicyIndex(sections: readonly PolicySection[]): PolicyIndex {
  const docs: IndexedDoc[] = sections.map((section) => {
    const tf = new Map<string, number>();
    const add = (tokens: string[], w: number) => {
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + w);
    };
    const tagTokens = tokenize((section.tags ?? []).join(" "));
    const titleTokens = tokenize(section.title);
    const bodyTokens = tokenize(section.body);
    add(titleTokens, TITLE_WEIGHT);
    add(tagTokens, TAG_WEIGHT);
    add(bodyTokens, 1);
    const len = titleTokens.length * TITLE_WEIGHT + tagTokens.length * TAG_WEIGHT + bodyTokens.length;
    return { section, tf, len, tagTokens: new Set(tagTokens) };
  });
  const N = docs.length;
  const avgLen = N > 0 ? docs.reduce((n, d) => n + d.len, 0) / N : 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => {
    const n = df.get(t) ?? 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  };

  return {
    sections,
    search(query, category, country, k = 3) {
      // Redaction placeholders ("[NAME]", "[PHONE]") carry no meaning for retrieval; "[ADDRESS]" does (address changes).
      const cleaned = (query ?? "").replace(/\[(?!ADDRESS\])[A-Z][A-Z _]*\]/g, " ");
      const qTerms = [...new Set(tokenize(expandQuery(cleaned, category)))];
      const prior = new Set(tokenize((CATEGORY_TAGS[category] ?? []).join(" ")));
      const routine = !SAFETY_SET.has(category);
      const wantsMeta = qTerms.some((t) => META_TERMS.has(t));
      const scored: { doc: IndexedDoc; score: number; order: number }[] = [];
      docs.forEach((doc, order) => {
        const countries = doc.section.countries;
        if (countries && countries.length > 0 && !countries.includes(country)) return;
        // The urgent and clinical protocols are never a source for a routine reply ("heading away from Friday" must
        // not pull in the bereavement protocol through its "passed away" tag).
        if (routine && isSafetySection(doc.section)) return;
        // The handbook note and the tone guide are not facts for a reply; the tone guide goes to the drafter
        // separately. They are only returned when asked for by name ("tone guide").
        if (!wantsMeta && META_SECTION_IDS.has(doc.section.id)) return;
        let score = 0;
        for (const t of qTerms) {
          const f = doc.tf.get(t);
          if (!f) continue;
          score += (idf(t) * (f * (K1 + 1))) / (f + K1 * (1 - B + (B * doc.len) / avgLen));
        }
        let overlap = 0;
        for (const t of prior) if (doc.tagTokens.has(t)) overlap++;
        if (overlap > 0) score += Math.min(PRIOR_MAX, PRIOR_BOOST + PRIOR_STEP * (overlap - 1));
        if (score > 0) scored.push({ doc, score, order });
      });
      scored.sort((a, b) => b.score - a.score || a.order - b.order);
      return scored.slice(0, Math.max(0, k)).map(({ doc, score }) => ({
        id: doc.section.id,
        kind: "policy" as const,
        label: `Policy ${doc.section.id}: ${doc.section.title}`,
        // Only the patient's country's figures, so a draft cannot quote another country's price or delivery window.
        text: doc.section.countries?.length === 1 ? doc.section.body : policyTextForCountry(doc.section.body, country),
        score: Math.round(score * 1000) / 1000,
      }));
    },
  };
}

// ---------- country trimming ----------

/**
 * Country names, plus "Australian" when it starts a proper name ("an Australian Pensioner Concession Card"), so the
 * concession-eligibility sentence in P5.4 is kept for Australian patients (MSG-0969, MSG-0010). A bare adjective is
 * not a marker: "Use Australian or British spelling" is a style rule for everyone, and must not be dropped for a New
 * Zealand patient.
 */
const COUNTRY_MARKERS: Record<Country, RegExp> = {
  AU: /\b(?:Australia|AEST|AEDT)\b|\bAustralian(?=\s+[A-Z])/,
  NZ: /\bNew Zealand\b/,
  UK: /\b(?:United Kingdom|UK|Britain|England|Scotland|Scottish|Wales|Northern Ireland)\b/,
};
const ALL_COUNTRIES: Country[] = ["AU", "NZ", "UK"];

function countriesIn(text: string): Set<Country> {
  return new Set(ALL_COUNTRIES.filter((c) => COUNTRY_MARKERS[c].test(text)));
}

/** A sentence that names other countries only is dropped; one that names several is trimmed clause by clause. */
function trimSentence(sentence: string, country: Country): string {
  const named = countriesIn(sentence);
  if (named.size === 0) return sentence;
  if (!named.has(country)) return "";
  if (named.size === 1) return sentence;
  // "Australia (Privacy Act 1988), within 30 days; New Zealand (...), within 20 working days; ...". A clause that
  // names no country belongs to the country named before it ("rural delivery: 3 to 5 business days").
  let current: Set<Country> | null = null;
  const kept: string[] = [];
  // A lead-in on a dropped first clause ("Response times follow the law in each country: Australia (...)") is kept
  // for the clause that survives.
  let leadIn = "";
  for (const clause of sentence.split(/;\s+/)) {
    const c = countriesIn(clause);
    if (c.size > 0) current = c;
    if (!current || current.has(country)) {
      kept.push(kept.length === 0 && leadIn ? `${leadIn} ${clause}` : clause);
    } else if (kept.length === 0 && !leadIn) {
      const lead = /^(.*?:)\s/.exec(clause);
      if (lead && countriesIn(lead[1]).size === 0) leadIn = lead[1];
    }
  }
  const out = kept.join("; ").trim();
  return out && !/[.!?:]$/.test(out) ? `${out.replace(/[,;]$/, "")}.` : out;
}

/**
 * The parts of a policy section that apply in one country. Sentences that name only other countries are removed
 * ("New Zealand, main centres: 1 to 3 business days"), sentences that name several countries keep only this
 * country's clauses, and sentences that name no country stay as written. Paragraph breaks are kept.
 */
export function policyTextForCountry(body: string, country: Country): string {
  const lines = (body ?? "").split("\n").map((line) => {
    if (!line.trim()) return line;
    const sentences = line.split(/(?<=[.!?])\s+(?=[A-Z0-9(])/);
    return sentences
      .map((s) => trimSentence(s, country))
      .filter((s) => s.length > 0)
      .join(" ");
  });
  const out = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out || body;
}

// ---------- record hints ----------

/**
 * Words from the patient's records that say what the message is really about when the patient does not: a hold
 * reason ("Payment failed"), or a charge that is not a routine plan payment ("Missed-consult fee"). Ids, dates and
 * figures are left out, because they only add noise to the search.
 */
export function recordHints(records: readonly SourceRef[] | undefined): string {
  const hints: string[] = [];
  for (const r of records ?? []) {
    if (r.kind === "order") {
      const hold = /hold reason: ([^;]+)/i.exec(r.text ?? "");
      if (hold) hints.push(hold[1]);
    } else if (r.kind === "charge") {
      const m = /^Charge [^:]+: (.*?); .*?status (\w+); .*?type (\w+)\s*$/i.exec(r.text ?? "");
      if (!m) continue;
      const [, description, status, kind] = m;
      if (kind !== "plan" || status !== "paid") hints.push(description, status === "failed" ? "failed payment" : "");
    }
  }
  return hints
    .join(" ")
    .replace(/\b(?:ORD|CHG|APT|PT)-\d+\b/gi, " ")
    // Dates are noise too: the month names go with the figures ("due 1 September 2026").
    .replace(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/g, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Accepts either a bare array of sections or { sections: [...] }. */
function sectionsFrom(data: unknown): PolicySection[] {
  if (Array.isArray(data)) return data as PolicySection[];
  const s = (data as { sections?: unknown } | null)?.sections;
  return Array.isArray(s) ? (s as PolicySection[]) : [];
}

let defaultIndex: PolicyIndex | null = null;
const injectedIndexes = new WeakMap<readonly PolicySection[], PolicyIndex>();

/** The index over data/policy.json, built once on first use. */
export function getDefaultPolicyIndex(): PolicyIndex {
  if (!defaultIndex) defaultIndex = createPolicyIndex(sectionsFrom(policyData));
  return defaultIndex;
}

export interface PolicySearchOptions {
  /** Search this handbook instead of data/policy.json (tests do this). */
  sections?: readonly PolicySection[];
  /**
   * The patient records selected for the reply (selectRecords). A hold reason or an unusual charge adds its words to
   * the search, so "wheres my september order??" on an order held for a failed payment finds the failed-payment
   * section, and "what is this $49 charge" on a missed-consult fee finds the appointments section.
   */
  records?: readonly SourceRef[];
  /**
   * The patient's other words the drafter sees: the earlier thread and separate recent messages (redacted). Used only
   * to decide whether the product-change section must be included (asksProductChange); never added to the search.
   */
  otherMessages?: readonly string[];
}

/** The section that says a product change needs a clinician's approval and when a new price applies. */
export const PRODUCT_CHANGE_SECTION_ID = "P6.1";

/** The section that says what to do at each business day past the ETA (1: share the tracking and reassure). */
export const LATE_ORDERS_SECTION_ID = "P4.2";

/** True when a selected order record carries the past-ETA line (lateOrderNote). */
function hasLateOrder(records: readonly SourceRef[] | undefined): boolean {
  return (records ?? []).some((r) => r.kind === "order" && /\bpast its estimated delivery date\b/.test(r.text ?? ""));
}

const PRODUCT_WORD = String.raw`(?:oils?|capsules?|caps|sprays?|gumm(?:y|ies)|tinctures?|flower|products?|vapes?|cartridges?)`;
const PRODUCT_CHANGE_RE = new RegExp(
  [
    // "drop the capsules", "add the spray", "swap the oil for capsules", "switch to the capsules", "take the caps off".
    String.raw`\b(?:add(?:s|ed|ing)?|remov(?:e|es|ed|ing)|drop(?:s|ped|ping)?|swap(?:s|ped|ping)?|switch(?:es|ed|ing)?|replac(?:e|es|ed|ing)|chang(?:e|es|ed|ing)|tak(?:e|es|ing) off|cut(?:ting)? out)\s+(?:(?:to|over to|from|the|my|a|an|your|our|another|a second|second|new|extra|both|one of the|one|just the)\s+){0,3}(?:(?:box|bottle|pack|packet|tub|jar)(?:e?s)?\s+of\s+(?:the\s+)?)?${PRODUCT_WORD}\b`,
    // "go down to one product", "just the one product", "a second product".
    String.raw`\b(?:(?:down|up|back) to|just|only)\s+(?:the\s+)?(?:one|two|a single|single|one more|a second)\s+products?\b|\b(?:another|a second|an extra|extra|second)\s+product\b`,
    // "the capsules off my plan", "add the spray onto my plan".
    String.raw`\b${PRODUCT_WORD}\s+(?:off|from|to|onto|on to|into|out of)\s+(?:my|the|our|his|her)\s+plan\b`,
  ].join("|"),
  "i",
);

/**
 * True when the text asks to add, remove or swap a product ("I'll keep the oil and drop the capsules", "go down to one
 * product"). Such a change needs a clinician's approval (P6.1), whatever the message was sorted as: MSG-0041 (sorted
 * billing) and MSG-0027 (a billing-date question after MSG-0011 asked to drop the capsules) were drafted without P6.1
 * and quoted the new price "from the next billing date" as if the change were agreed.
 */
export function asksProductChange(text: string | undefined): boolean {
  return PRODUCT_CHANGE_RE.test(text ?? "");
}

/**
 * Top k policy sections for a (redacted) message: BM25 over title, tags and body, plus a boost when a section's tags
 * match the message type, filtered to sections that apply in the patient's country. Each section's text keeps only
 * the patient's country's figures. The fifth argument is an injected handbook (an array of sections) or options.
 *
 * When the message, or one of `otherMessages`, asks to add, remove or swap a product, the product-change section (P6.1)
 * is always among the results, whatever the category: added after the top k when the search did not already rank it.
 * Likewise the late-orders section (P4.2) whenever a selected order record is past its estimated delivery date, so the
 * draft can follow the step for that day count (MSG-0077 was drafted from P4.3, P3.1 and P5.1 without it).
 */
export function searchPolicy(
  query: string,
  category: Category,
  country: Country,
  k = 3,
  sectionsOrOptions?: readonly PolicySection[] | PolicySearchOptions,
): SourceRef[] {
  const opts: PolicySearchOptions = Array.isArray(sectionsOrOptions)
    ? { sections: sectionsOrOptions as readonly PolicySection[] }
    : ((sectionsOrOptions as PolicySearchOptions | undefined) ?? {});
  const sections = opts.sections;
  let index: PolicyIndex;
  if (sections) {
    index = injectedIndexes.get(sections) ?? createPolicyIndex(sections);
    injectedIndexes.set(sections, index);
  } else {
    index = getDefaultPolicyIndex();
  }
  const hints = recordHints(opts.records);
  const results = index.search(hints ? `${query ?? ""}\n${hints}` : query, category, country, k);
  const required: string[] = [];
  if (k > 0 && hasLateOrder(opts.records)) required.push(LATE_ORDERS_SECTION_ID);
  if (k > 0 && [query, ...(opts.otherMessages ?? [])].some(asksProductChange)) required.push(PRODUCT_CHANGE_SECTION_ID);
  const out = [...results];
  for (const id of required) {
    if (out.some((r) => r.id === id)) continue;
    const section = index.sections.find((s) => s.id === id);
    if (!section) continue;
    const countries = section.countries;
    if (countries && countries.length > 0 && !countries.includes(country)) continue;
    out.push({
      id: section.id,
      kind: "policy" as const,
      label: `Policy ${section.id}: ${section.title}`,
      text: countries?.length === 1 ? section.body : policyTextForCountry(section.body, country),
      score: 0,
    });
  }
  return out;
}
