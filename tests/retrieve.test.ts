import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Category, PatientMessage, Patient, PolicySection, TestLabel } from "@/lib/types";
import { redact } from "@/lib/pipeline/redact";
import { formatMoney } from "@/lib/format";

// Keep these tests independent of the real handbook: the default index reads this small fixture instead.
vi.mock("@/data/policy.json", () => ({
  default: {
    sections: [
      { id: "P9.1", title: "Mocked default section", body: "Refunds are issued within 5 business days.", tags: ["refund"] },
    ],
  },
}));

import {
  createPolicyIndex,
  formatAmount,
  formatDate,
  formatShortDate,
  formatTime,
  getDefaultPolicyIndex,
  policyTextForCountry,
  recordHints,
  searchPolicy,
  selectRecords,
  stem,
  tokenize,
} from "@/lib/pipeline/retrieve";

function patient(over: Partial<Patient> = {}): Patient {
  return {
    id: "PT-1001",
    firstName: "Jane",
    lastName: "Citizen",
    email: "jane@example.com",
    phone: "0491 570 006",
    dob: "1985-03-12",
    address: { line1: "14 Banksia Drive", suburb: "Richmond", region: "VIC", postcode: "3121", country: "AU" },
    country: "AU",
    timezone: "Australia/Melbourne",
    plan: {
      name: "Monthly treatment plan",
      monthlyPrice: 129,
      currency: "AUD",
      status: "active",
      startedAt: "2026-03-03",
      nextBillingDate: "2026-10-01",
    },
    orders: [
      {
        id: "ORD-20401",
        patientId: "PT-1001",
        placedAt: "2026-08-14T09:00:00+10:00",
        status: "delivered",
        items: [{ name: "Oil, 25 mL", qty: 1 }],
        total: 129,
        currency: "AUD",
        carrier: "Courierline",
        tracking: "CD1111111111",
        shippedAt: "2026-08-15T10:00:00+10:00",
        deliveredAt: "2026-08-19T13:00:00+10:00",
      },
      {
        id: "ORD-20481",
        patientId: "PT-1001",
        placedAt: "2026-09-16T08:30:00+10:00",
        status: "shipped",
        items: [{ name: "Oil, 25 mL", qty: 1 }],
        total: 129,
        currency: "AUD",
        carrier: "Courierline",
        tracking: "CD4829103756",
        shippedAt: "2026-09-18T11:05:00+10:00",
        eta: "2026-09-22",
      },
      {
        id: "ORD-20350",
        patientId: "PT-1001",
        placedAt: "2026-07-14T09:00:00+10:00",
        status: "delivered",
        items: [{ name: "Capsules, 30", qty: 2 }],
        total: 158,
        currency: "AUD",
        deliveredAt: "2026-07-18T13:00:00+10:00",
      },
    ],
    charges: [
      { id: "CHG-30001", patientId: "PT-1001", at: "2026-07-01T00:05:00+10:00", amount: 129, currency: "AUD", description: "Monthly treatment plan", kind: "plan", status: "paid" },
      { id: "CHG-30002", patientId: "PT-1001", at: "2026-08-01T00:05:00+10:00", amount: 129, currency: "AUD", description: "Monthly treatment plan", kind: "plan", status: "paid" },
      { id: "CHG-30003", patientId: "PT-1001", at: "2026-09-01T00:05:00+10:00", amount: 129, currency: "AUD", description: "Monthly treatment plan", kind: "plan", status: "paid" },
      { id: "CHG-30004", patientId: "PT-1001", at: "2026-09-05T14:20:00+10:00", amount: -40, currency: "AUD", description: "Refund, late delivery", kind: "refund", status: "refunded" },
    ],
    appointments: [
      { id: "APT-40001", patientId: "PT-1001", at: "2026-03-03T10:00:00+11:00", kind: "initial", status: "completed", clinician: "Dr Hana Whitlock" },
      { id: "APT-40002", patientId: "PT-1001", at: "2026-09-29T15:30:00+10:00", kind: "renewal", status: "booked", clinician: "Dr Hana Whitlock" },
    ],
    ...over,
  };
}

const HANDBOOK: PolicySection[] = [
  {
    id: "P3.1",
    title: "Delivery times",
    body: "Orders ship within 24 hours of pharmacy approval. Delivery takes 2 to 5 business days in metro areas.",
    tags: ["delivery", "shipping", "tracking", "late"],
    countries: ["AU"],
  },
  {
    id: "P3.2",
    title: "Delivery times in New Zealand",
    body: "Orders to New Zealand arrive in 3 to 7 business days.",
    tags: ["delivery", "shipping"],
    countries: ["NZ"],
  },
  {
    id: "P3.3",
    title: "Lost or damaged parcels",
    body: "If a parcel is lost or arrives damaged, we reship at no cost once the courier confirms.",
    tags: ["delivery", "lost", "damaged", "courier"],
  },
  {
    id: "P4.1",
    title: "Refunds",
    body: "Refunds go back to the original card within 5 business days of approval.",
    tags: ["billing", "refund", "payment"],
  },
  {
    id: "P4.2",
    title: "Price changes",
    body: "We give 30 days notice of any price change. Concession pricing is available with a valid card.",
    tags: ["price", "pricing", "concession"],
  },
  {
    id: "P5.1",
    title: "Pausing or cancelling your plan",
    body: "You can pause your treatment plan for up to 3 months, or cancel at any time before the next billing date.",
    tags: ["plan", "pause", "cancel"],
  },
  {
    id: "P8.1",
    title: "Crisis support",
    body: "If someone is in immediate danger, contact emergency services. A clinician reviews every crisis message.",
    tags: ["crisis", "helpline", "safety", "escalation"],
  },
  {
    id: "P9.2",
    title: "Privacy requests",
    body: "You can ask for a copy of your data or ask us to delete it. We reply within 30 days.",
    tags: ["privacy", "data", "deletion"],
    countries: ["UK"],
  },
];

describe("retrieve: formatting", () => {
  it("formats dates from the local date in the ISO string", () => {
    expect(formatDate("2026-09-18T11:05:00+10:00")).toBe("18 September 2026");
    expect(formatDate("2026-09-01")).toBe("1 September 2026");
    expect(formatDate("2026-09-30T23:30:00-01:00")).toBe("30 September 2026");
    expect(formatShortDate("2026-09-18T11:05:00+10:00")).toBe("18 Sep");
  });

  it("formats amounts in local style with 2 decimals, keeping the code for dollars", () => {
    expect(formatAmount(129, "AUD")).toBe("$129.00 AUD");
    expect(formatAmount(49.9, "GBP")).toBe("£49.90");
    expect(formatAmount(-40, "NZD")).toBe("-$40.00 NZD");
  });

  it("formats times as 12-hour clock", () => {
    expect(formatTime("2026-09-29T15:30:00+10:00")).toBe("3:30 pm");
    expect(formatTime("2026-09-29T00:05:00+10:00")).toBe("12:05 am");
    expect(formatTime("2026-09-29T12:00:00+10:00")).toBe("12:00 pm");
    expect(formatTime("2026-09-29")).toBeNull();
  });
});

describe("retrieve: selectRecords", () => {
  it("builds the exact order fact text the drafter may quote", () => {
    const refs = selectRecords(patient(), "order_status");
    const order = refs.find((r) => r.id === "ORD-20481");
    expect(order).toEqual({
      id: "ORD-20481",
      kind: "order",
      label: "Order ORD-20481, shipped 18 Sep",
      text:
        "Order ORD-20481: status shipped; placed 16 September 2026; shipped 18 September 2026; carrier Courierline; " +
        "tracking CD4829103756; estimated delivery 22 September 2026; items: Oil, 25 mL x1; total $129.00 AUD",
    });
  });

  it("order_status: open orders plus the most recent, then the plan", () => {
    const ids = selectRecords(patient(), "order_status").map((r) => r.id);
    expect(ids).toEqual(["ORD-20481", "PLAN"]);
  });

  it("delivery_problem: falls back to the most recent order when everything is delivered", () => {
    const p = patient();
    p.orders = p.orders.filter((o) => o.status === "delivered");
    const refs = selectRecords(p, "delivery_problem");
    expect(refs.map((r) => r.id)).toEqual(["ORD-20401", "PLAN"]);
    expect(refs[0].label).toBe("Order ORD-20401, delivered 19 Aug");
    expect(refs[0].text).toContain("delivered 19 August 2026");
    expect(refs[0].text).not.toContain("estimated delivery");
  });

  it("includes several open orders, newest first", () => {
    const p = patient();
    p.orders.push({
      id: "ORD-20490",
      patientId: "PT-1001",
      placedAt: "2026-09-21T08:30:00+10:00",
      status: "on_hold",
      holdReason: "script expired",
      items: [{ name: "Oral spray, 20 mL", qty: 1 }],
      total: 99,
      currency: "AUD",
    });
    const refs = selectRecords(p, "order_status");
    expect(refs.map((r) => r.id)).toEqual(["ORD-20490", "ORD-20481", "PLAN"]);
    expect(refs[0].label).toBe("Order ORD-20490, on hold, placed 21 Sep");
    expect(refs[0].text).toContain("status on hold; placed 21 September 2026; hold reason: script expired");
  });

  it("billing and price_change: the last 3 charges and the plan", () => {
    for (const cat of ["billing", "price_change"] as const) {
      const refs = selectRecords(patient(), cat);
      expect(refs.map((r) => r.id)).toEqual(["CHG-30004", "CHG-30003", "CHG-30002", "PLAN"]);
    }
    const refund = selectRecords(patient(), "billing")[0];
    expect(refund.kind).toBe("charge");
    // Labels use the explicit currency the shared desk shows (formatMoney with explicit: true).
    expect(refund.label).toBe(`Refund CHG-30004, 5 Sep, ${formatMoney(40, "AUD", { explicit: true })}`);
    expect(refund.label).toBe("Refund CHG-30004, 5 Sep, A$40.00");
    expect(refund.text).toBe(
      "Charge CHG-30004: Refund, late delivery; refund of $40.00 AUD; status refunded; charged 5 September 2026; type refund",
    );
  });

  it("plan_change: the plan and the next order", () => {
    const refs = selectRecords(patient(), "plan_change");
    expect(refs.map((r) => r.id)).toEqual(["PLAN", "ORD-20481"]);
  });

  it("appointment and script_renewal: appointments, plan and the last order", () => {
    for (const cat of ["appointment", "script_renewal"] as const) {
      const refs = selectRecords(patient(), cat);
      expect(refs.map((r) => r.id)).toEqual(["APT-40002", "APT-40001", "PLAN", "ORD-20481"]);
    }
    const appt = selectRecords(patient(), "appointment")[0];
    expect(appt.text).toBe(
      "Appointment APT-40002: renewal consult; 29 September 2026 at 3:30 pm (patient's local time); clinician Dr Hana Whitlock; status booked",
    );
    expect(appt.label).toBe("Appointment APT-40002, 29 Sep, booked");
  });

  it("always includes a PLAN source with name, status, price and next billing date", () => {
    const cats = [
      "order_status", "delivery_problem", "script_renewal", "billing", "price_change", "plan_change", "appointment",
      "account_access", "product_question", "privacy_request", "complaint", "wants_human", "other",
      "clinical_question", "side_effect", "adverse_event", "crisis", "bereavement",
    ] as const;
    for (const c of cats) {
      const plan = selectRecords(patient(), c).find((r) => r.id === "PLAN");
      expect(plan, c).toBeDefined();
      expect(plan!.kind).toBe("plan");
      expect(plan!.text).toBe(
        "Plan: Monthly treatment plan; status active; price $129.00 AUD per month; started 3 March 2026; next billing date 1 October 2026",
      );
    }
  });

  it("notes concession pricing and handles a paused plan without a billing date", () => {
    const p = patient();
    p.plan = { ...p.plan, status: "paused", concession: true, nextBillingDate: undefined };
    const plan = selectRecords(p, "billing").find((r) => r.id === "PLAN")!;
    expect(plan.label).toBe("Plan: Monthly treatment plan, paused");
    expect(plan.text).toBe("Plan: Monthly treatment plan; status paused; price $129.00 AUD per month; concession pricing applied; started 3 March 2026");
  });

  it("safety categories: the open orders a hold would affect, the next appointment and the plan", () => {
    const ids = selectRecords(patient(), "adverse_event").map((r) => r.id);
    expect(ids).toEqual(["ORD-20481", "APT-40002", "PLAN"]);
  });

  it("account and privacy messages get the plan only", () => {
    expect(selectRecords(patient(), "account_access").map((r) => r.id)).toEqual(["PLAN"]);
    expect(selectRecords(patient(), "privacy_request").map((r) => r.id)).toEqual(["PLAN"]);
  });

  it("copes with a patient who has no orders, charges or appointments", () => {
    const p = patient({ orders: [], charges: [], appointments: [] });
    expect(selectRecords(p, "order_status").map((r) => r.id)).toEqual(["PLAN"]);
    expect(selectRecords(p, "billing").map((r) => r.id)).toEqual(["PLAN"]);
    expect(selectRecords(p, "plan_change").map((r) => r.id)).toEqual(["PLAN"]);
    expect(selectRecords(p, "appointment").map((r) => r.id)).toEqual(["PLAN"]);
  });

  it("formats NZD and GBP orders", () => {
    const p = patient({ country: "UK" });
    p.orders = [{ ...p.orders[1], currency: "GBP", total: 49.99 }];
    expect(selectRecords(p, "order_status")[0].text).toContain("total £49.99");
  });
});

describe("retrieve: tokenising", () => {
  it("stems common inflections to the same root", () => {
    expect(stem("deliveries")).toBe(stem("delivery"));
    expect(stem("delivered")).toBe(stem("delivery"));
    expect(stem("charged")).toBe(stem("charges"));
    expect(stem("cancelling")).toBe(stem("cancel"));
    expect(stem("cancelled")).toBe(stem("cancel"));
    expect(stem("shipping")).toBe(stem("shipped"));
    expect(stem("refunds")).toBe("refund");
    expect(stem("status")).toBe("status");
  });

  it("drops stop words, punctuation and apostrophes", () => {
    expect(tokenize("Where's my order?!")).toEqual([stem("wheres"), "order"]);
    expect(tokenize("Hi, can you help with the DELIVERY")).toEqual(["help", stem("delivery")]);
    expect(tokenize("")).toEqual([]);
  });
});

describe("retrieve: searchPolicy", () => {
  it("returns policy sources with id, label, body text and a score", () => {
    const refs = searchPolicy("My delivery is running late, how long do delivery times usually take?", "delivery_problem", "AU", 3, HANDBOOK);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs[0]).toMatchObject({ id: "P3.1", kind: "policy", label: "Policy P3.1: Delivery times", text: HANDBOOK[0].body });
    expect(typeof refs[0].score).toBe("number");
    expect(refs[0].score!).toBeGreaterThan(0);
  });

  it("ranks by relevance and returns at most k (default 3)", () => {
    const refs = searchPolicy("The box arrived damaged and the courier lost the other one", "delivery_problem", "AU", undefined, HANDBOOK);
    expect(refs.length).toBeLessThanOrEqual(3);
    expect(refs[0].id).toBe("P3.3");
    for (let i = 1; i < refs.length; i++) expect(refs[i - 1].score!).toBeGreaterThanOrEqual(refs[i].score!);
    expect(searchPolicy("delivery", "order_status", "AU", 1, HANDBOOK)).toHaveLength(1);
    expect(searchPolicy("delivery", "order_status", "AU", 0, HANDBOOK)).toHaveLength(0);
  });

  it("filters by country; sections without countries apply everywhere", () => {
    const nz = searchPolicy("how long does delivery take", "order_status", "NZ", 5, HANDBOOK).map((r) => r.id);
    expect(nz).toContain("P3.2");
    expect(nz).not.toContain("P3.1");
    const au = searchPolicy("how long does delivery take", "order_status", "AU", 5, HANDBOOK).map((r) => r.id);
    expect(au).toContain("P3.1");
    expect(au).not.toContain("P3.2");
    expect(au).toContain("P3.3");
    expect(searchPolicy("delete my data", "privacy_request", "AU", 5, HANDBOOK).map((r) => r.id)).not.toContain("P9.2");
    expect(searchPolicy("delete my data", "privacy_request", "UK", 5, HANDBOOK)[0].id).toBe("P9.2");
  });

  it("uses the category prior when the words are thin", () => {
    const refs = searchPolicy("[NAME] here, hi", "price_change", "AU", 3, HANDBOOK);
    expect(refs[0].id).toBe("P4.2");
    expect(searchPolicy("hi", "plan_change", "UK", 3, HANDBOOK)[0].id).toBe("P5.1");
  });

  it("ignores redaction placeholders such as [NAME] and [PHONE] in the query", () => {
    const withPlaceholders = searchPolicy("[NAME] here, call [PHONE]. Refund please", "billing", "AU", 3, HANDBOOK);
    const plain = searchPolicy("here, call. Refund please", "billing", "AU", 3, HANDBOOK);
    expect(withPlaceholders).toEqual(plain);
  });

  it("the category prior breaks a tie between equally worded sections", () => {
    const refs = searchPolicy("business days", "billing", "AU", 3, HANDBOOK);
    expect(refs[0].id).toBe("P4.1");
  });

  it("returns nothing when neither words nor tags match", () => {
    expect(searchPolicy("zebra xylophone", "other", "AU", 3, HANDBOOK)).toEqual([]);
    expect(searchPolicy("", "other", "AU", 3, HANDBOOK)).toEqual([]);
  });

  it("works with an index built once by createPolicyIndex", () => {
    const index = createPolicyIndex(HANDBOOK);
    expect(index.sections).toBe(HANDBOOK);
    expect(index.search("refund to my card", "billing", "NZ")[0].id).toBe("P4.1");
    expect(createPolicyIndex([]).search("anything", "billing", "AU")).toEqual([]);
  });

  it("uses data/policy.json by default (accepts { sections } or a bare array)", () => {
    expect(getDefaultPolicyIndex().sections.map((s) => s.id)).toEqual(["P9.1"]);
    expect(searchPolicy("refund", "billing", "AU")[0]).toMatchObject({ id: "P9.1", kind: "policy" });
  });
});

describe("retrieve: records the message names", () => {
  function withDamaged(): Patient {
    const p = patient();
    p.orders.push(
      {
        id: "ORD-20019",
        patientId: "PT-1001",
        placedAt: "2026-09-02T09:00:00+10:00",
        status: "delivered",
        items: [{ name: "Oil, 25 mL", qty: 1 }],
        total: 129,
        currency: "AUD",
        deliveredAt: "2026-09-06T13:00:00+10:00",
      },
      {
        id: "ORD-20123",
        patientId: "PT-1001",
        placedAt: "2026-08-20T09:00:00+10:00",
        status: "delivered",
        items: [{ name: "Capsules, 30", qty: 1 }],
        total: 79,
        currency: "AUD",
        deliveredAt: "2026-08-27T13:00:00+10:00",
      },
    );
    p.charges.push(
      {
        id: "CHG-30050",
        patientId: "PT-1001",
        at: "2026-09-10T09:00:00+10:00",
        amount: 12.5,
        currency: "AUD",
        description: "One-off shipping fee: resend of a parcel returned after a missed delivery (order ORD-20123)",
        kind: "shipping",
        status: "paid",
      },
      {
        id: "CHG-30099",
        patientId: "PT-1001",
        at: "2026-09-18T09:00:00+10:00",
        amount: 49,
        currency: "AUD",
        description: "Missed-consult fee: second missed consult within 6 months (17 Sep 2026)",
        kind: "consult",
        status: "paid",
      },
    );
    p.appointments.push(
      { id: "APT-40117", patientId: "PT-1001", at: "2026-06-10T10:00:00+10:00", kind: "follow_up", status: "missed", clinician: "Dr Hana Whitlock" },
      { id: "APT-40118", patientId: "PT-1001", at: "2026-09-17T10:00:00+10:00", kind: "follow_up", status: "missed", clinician: "Dr Hana Whitlock" },
    );
    return p;
  }

  it("includes an order the message names, even when the category would not pick it", () => {
    const text = "The bottle in ORD-20019 arrived broken, can you replace it?";
    const ids = selectRecords(withDamaged(), "delivery_problem", text).map((r) => r.id);
    expect(ids[0]).toBe("ORD-20019");
    expect(ids).toContain("PLAN");
    // Without the text, the old behaviour is unchanged.
    expect(selectRecords(withDamaged(), "delivery_problem").map((r) => r.id)).not.toContain("ORD-20019");
  });

  it("matches ids in any case and ignores ids that are not this patient's", () => {
    const ids = selectRecords(withDamaged(), "complaint", "about ord-20019 and ORD-99999").map((r) => r.id);
    expect(ids).toContain("ORD-20019");
    expect(ids).not.toContain("ORD-99999");
  });

  it("billing: adds the order a charge description names", () => {
    const ids = selectRecords(withDamaged(), "billing", "Why was I charged a shipping fee?").map((r) => r.id);
    expect(ids).toContain("CHG-30050");
    expect(ids).toContain("ORD-20123");
  });

  it("billing: adds the missed appointments behind a consult fee", () => {
    const ids = selectRecords(withDamaged(), "billing", "What is the NZ$49 charge for?").map((r) => r.id);
    expect(ids).toContain("CHG-30099");
    expect(ids).toContain("APT-40118");
    expect(ids).toContain("APT-40117");
  });

  it("a named charge brings its context with it in any category", () => {
    const ids = selectRecords(withDamaged(), "complaint", "Please refund CHG-30050").map((r) => r.id);
    expect(ids.slice(0, 2)).toEqual(["CHG-30050", "ORD-20123"]);
  });

  it("order_status: adds the last charge when an order is waiting for a script", () => {
    const p = patient();
    p.orders.push({
      id: "ORD-20500",
      patientId: "PT-1001",
      placedAt: "2026-09-22T08:30:00+10:00",
      status: "script_pending",
      items: [{ name: "Oil, 25 mL", qty: 1 }],
      total: 129,
      currency: "AUD",
    });
    const ids = selectRecords(p, "order_status", "Have I been charged yet?").map((r) => r.id);
    expect(ids).toContain("ORD-20500");
    expect(ids).toContain("CHG-30004");
    // No charge when nothing is waiting for a script.
    expect(selectRecords(patient(), "order_status").some((r) => r.kind === "charge")).toBe(false);
  });

  it("never lists the same record twice", () => {
    const refs = selectRecords(withDamaged(), "order_status", "ORD-20481 ORD-20481 please");
    expect(new Set(refs.map((r) => r.id)).size).toBe(refs.length);
  });
});

describe("retrieve: safety and meta sections stay out of routine replies", () => {
  const SAFETY_HANDBOOK: PolicySection[] = [
    { id: "P1.1", title: "About this handbook", body: "This handbook is sample material for the demo.", tags: ["handbook", "about"] },
    { id: "P1.2", title: "Tone and writing guide", body: "Write warmly and plainly.", tags: ["tone", "voice", "style", "reply"] },
    { id: "P3.1", title: "Dispatch", body: "Orders ship within 24 hours of approval.", tags: ["order", "status", "shipping", "shipped"] },
    {
      id: "P10.2",
      title: "Urgent safety: crisis and bereavement",
      body: "Call 000 in an emergency. Lifeline 13 11 14.",
      tags: ["crisis", "bereavement", "passed away", "not want to be here", "died", "hold", "order"],
      countries: ["AU"],
    },
  ];

  it("does not return P10.x for a routine message that shares a word with a crisis tag", () => {
    const ids = searchPolicy("heading away from friday, has my order shipped", "order_status", "AU", 3, SAFETY_HANDBOOK).map((r) => r.id);
    expect(ids).toContain("P3.1");
    expect(ids.some((id) => id.startsWith("P10."))).toBe(false);
  });

  it("still returns P10.x for safety categories", () => {
    const ids = searchPolicy("my mum passed away", "bereavement", "AU", 3, SAFETY_HANDBOOK).map((r) => r.id);
    expect(ids[0]).toBe("P10.2");
  });

  it("keeps the handbook note and tone guide out of ranked results unless asked for by name", () => {
    const ids = searchPolicy("please reply about my order", "order_status", "AU", 5, SAFETY_HANDBOOK).map((r) => r.id);
    expect(ids).not.toContain("P1.1");
    expect(ids).not.toContain("P1.2");
    const tone = searchPolicy("tone guide voice style writing replies", "order_status", "AU", 5, SAFETY_HANDBOOK);
    expect(tone.map((r) => r.id)).toContain("P1.2");
  });
});

// ---------------- round 2: the real handbook and the test set ----------------

// The default index is mocked above, so the real data is read from disk and passed in as an injected handbook.
function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), "utf8")) as T;
}
const REAL_POLICY = readJson<{ sections: PolicySection[] } | PolicySection[]>("data/policy.json");
const REAL_SECTIONS: PolicySection[] = Array.isArray(REAL_POLICY) ? REAL_POLICY : REAL_POLICY.sections;
const REAL_PATIENTS = readJson<Patient[]>("data/patients.json");
const REAL_MESSAGES = readJson<PatientMessage[]>("data/messages.json");
const REAL_LABELS = readJson<TestLabel[]>("data/testset.json");
const section = (id: string) => REAL_SECTIONS.find((s) => s.id === id)!;

/** What the pipeline searches with: the redacted subject and body, plus the records chosen for the reply. */
function realSearch(messageId: string, category?: Category, withRecords = true) {
  const m = REAL_MESSAGES.find((x) => x.id === messageId)!;
  const p = REAL_PATIENTS.find((x) => x.id === m.patientId)!;
  const label = REAL_LABELS.find((l) => l.messageId === messageId)!;
  const cat = category ?? label.expectedCategory;
  const { redactedText } = redact(m.subject ? `${m.subject}\n${m.body}` : m.body, p);
  const records = selectRecords(p, cat, redactedText);
  return searchPolicy(redactedText, cat, p.country, 3, { sections: REAL_SECTIONS, records: withRecords ? records : undefined });
}

describe("retrieve: policy text keeps only the patient's country", () => {
  it("delivery times: each country sees its own window only", () => {
    const au = policyTextForCountry(section("P4.1").body, "AU");
    expect(au).toContain("Australia, metro");
    expect(au).toContain("1 to 3 business days");
    expect(au).not.toMatch(/New Zealand|United Kingdom|1 to 2 business days/);
    const uk = policyTextForCountry(section("P4.1").body, "UK");
    expect(uk).toContain("United Kingdom, mainland: 1 to 2 business days");
    expect(uk).toContain("Northern Ireland: 2 to 4 business days");
    expect(uk).not.toMatch(/Australia|New Zealand/);
    // The shared sentences stay.
    for (const text of [au, uk]) expect(text).toContain("The ETA shown on an order is the last day of this window.");
  });

  it("prices: an Australian patient never sees pounds or NZ dollars", () => {
    const au = policyTextForCountry(section("P5.4").body, "AU");
    expect(au).toContain("one product A$148, two products A$214");
    expect(au).not.toMatch(/£|NZ\$|The New Zealand change/);
    const nz = policyTextForCountry(section("P5.4").body, "NZ");
    expect(nz).toContain("NZ$162");
    expect(nz).toContain("The New Zealand change on 1 September 2026");
    expect(nz).not.toMatch(/£|A\$148/);
  });

  it("keeps the lead-in of a clause list and leaves country-free text alone", () => {
    expect(policyTextForCountry(section("P9.1").body, "NZ")).toContain(
      "Response times follow the law in each country: New Zealand (Privacy Act 2020), within 20 working days.",
    );
    // "Use Australian or British spelling" is a rule for everyone.
    expect(policyTextForCountry(section("P1.2").body, "NZ")).toBe(section("P1.2").body);
    expect(policyTextForCountry("No countries here. Just text.", "UK")).toBe("No countries here. Just text.");
  });

  it("returns the trimmed text from searchPolicy, and single-country sections unchanged", () => {
    const refs = searchPolicy("how long does delivery take", "order_status", "AU", 5, REAL_SECTIONS);
    const p41 = refs.find((r) => r.id === "P4.1");
    expect(p41?.text).toBe(policyTextForCountry(section("P4.1").body, "AU"));
    const urgent = searchPolicy("my mum passed away", "bereavement", "AU", 3, REAL_SECTIONS).find((r) => r.id === "P10.2");
    expect(urgent?.text).toBe(section("P10.2").body);
  });
});

describe("retrieve: record hints", () => {
  it("reads hold reasons and unusual charges, and ignores routine plan payments", () => {
    const hints = recordHints([
      { id: "ORD-1", kind: "order", label: "", text: "Order ORD-1: status on hold; placed 1 September 2026; hold reason: Payment failed. Retried on 14 Sep 2026.; total $129.00 AUD" },
      { id: "CHG-1", kind: "charge", label: "", text: "Charge CHG-1: Missed-consult fee: second missed consult within 6 months (17 Sep 2026); $49.00 NZD; status paid; charged 18 September 2026; type consult" },
      { id: "CHG-2", kind: "charge", label: "", text: "Charge CHG-2: Monthly treatment plan, September 2026; $129.00 AUD; status paid; charged 1 September 2026; type plan" },
    ]);
    expect(hints).toMatch(/Payment failed/);
    expect(hints).toMatch(/Missed-consult fee/);
    expect(hints).not.toMatch(/Monthly treatment plan|\d/);
    expect(recordHints(undefined)).toBe("");
  });

  it("still accepts a bare array of sections as the fifth argument", () => {
    expect(searchPolicy("refund", "billing", "AU", 3, HANDBOOK)[0].id).toBe("P4.1");
    expect(searchPolicy("refund", "billing", "AU", 3, { sections: HANDBOOK })[0].id).toBe("P4.1");
  });
});

describe("retrieve: the test set's named policy sections come back in the top 3", () => {
  it("MSG-0152 (the flagship routine case): delivery and dispatch, not pausing or contact hours", () => {
    const ids = realSearch("MSG-0152").map((r) => r.id);
    expect(ids).toContain("P4.1");
    expect(ids).toContain("P3.1");
    expect(ids).not.toContain("P6.1");
    expect(ids).not.toContain("P2.1");
  });

  it("\"when's my next order\" finds the dispatch section (MSG-0029, MSG-0173, MSG-0097)", () => {
    for (const id of ["MSG-0029", "MSG-0173", "MSG-0097"]) expect(realSearch(id).map((r) => r.id)).toContain("P3.1");
  });

  it("a missed-consult fee finds the appointments section, and a payment hold the failed-payment section", () => {
    expect(realSearch("MSG-0068").map((r) => r.id)).toContain("P7.1");
    expect(realSearch("MSG-0095").map((r) => r.id)).toContain("P5.2");
  });

  // Every routine label whose note names the sections a correct reply draws on.
  const cases = REAL_LABELS.filter((l) => l.expectedRoute === "draft")
    .map((l) => ({
      id: l.messageId,
      want: [...new Set((l.note ?? "").match(/\bP\d+\.\d+\b/g) ?? [])].filter((s) => !/^P1\.|^P10\./.test(s)),
    }))
    .filter((c) => c.want.length > 0);

  it("covers the routine labels that name a section", () => {
    expect(cases.length).toBeGreaterThanOrEqual(80);
  });

  for (const c of cases) {
    it(`${c.id}: at least one of ${c.want.join(", ")}`, () => {
      const ids = realSearch(c.id).map((r) => r.id);
      expect(c.want.some((w) => ids.includes(w)), `got ${ids.join(", ")}`).toBe(true);
    });
  }
});

// ---------------- round 3: record slices the labelled drafts need ----------------

describe("retrieve: record slices for the labelled drafts (review round 3)", () => {
  function realRecords(messageId: string, category?: Category) {
    const m = REAL_MESSAGES.find((x) => x.id === messageId)!;
    const p = REAL_PATIENTS.find((x) => x.id === m.patientId)!;
    const cat = category ?? REAL_LABELS.find((l) => l.messageId === messageId)!.expectedCategory;
    const { redactedText } = redact(m.subject ? `${m.subject}\n${m.body}` : m.body, p);
    return selectRecords(p, cat, redactedText);
  }

  it("MSG-0075 and MSG-0102: a failed payment brings in the order it holds up", () => {
    const a = realRecords("MSG-0075");
    expect(a.map((r) => r.id)).toEqual(expect.arrayContaining(["CHG-30011", "CHG-30012", "CHG-30013", "ORD-20011", "PLAN"]));
    expect(a.find((r) => r.id === "ORD-20011")?.text).toContain("status on hold");
    const b = realRecords("MSG-0102");
    expect(b.map((r) => r.id)).toEqual(expect.arrayContaining(["CHG-30090", "ORD-20085", "PLAN"]));
  });

  it("does not add orders to a billing reply when every charge was paid", () => {
    const paid = patient({
      charges: [
        { id: "CHG-1", patientId: "PT-1001", at: "2026-09-01T09:00:00+10:00", amount: 129, currency: "AUD", description: "Plan", kind: "plan", status: "paid" },
      ],
      orders: [
        { id: "ORD-9", patientId: "PT-1001", placedAt: "2026-09-01T09:00:00+10:00", status: "on_hold", items: [], total: 129, currency: "AUD" },
      ],
    });
    expect(selectRecords(paid, "billing").map((r) => r.id)).toEqual(["CHG-1", "PLAN"]);
  });

  it("MSG-0069: an appointment reply sees the recent missed-consult fee and the missed consult", () => {
    const ids = realRecords("MSG-0069").map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["APT-40118", "CHG-30099", "PLAN"]));
  });

  it("leaves out a consult fee older than 30 days", () => {
    const m = REAL_MESSAGES.find((x) => x.id === "MSG-0069")!;
    const p = REAL_PATIENTS.find((x) => x.id === m.patientId)!;
    expect(selectRecords(p, "appointment", "", { today: "2026-11-30" }).map((r) => r.id)).not.toContain("CHG-30099");
  });

  it("MSG-0182: a script-pending order brings in the consult that changed the script", () => {
    // Sorted as an order question (the label was order_status until rehearsal round 2, P9 a).
    const refs = realRecords("MSG-0182", "order_status");
    const ids = refs.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["ORD-20136", "CHG-30142", "APT-40177", "PLAN"]));
    expect(refs.find((r) => r.id === "APT-40177")?.text).toContain("21 September 2026");
    // Sorted as a script renewal (its label since round 2): the stuck order and the consult that changed the script
    // are still both there.
    const renewal = realRecords("MSG-0182");
    expect(renewal.map((r) => r.id)).toEqual(expect.arrayContaining(["ORD-20136", "APT-40177", "PLAN"]));
    expect(renewal.find((r) => r.id === "APT-40177")?.text).toContain("21 September 2026");
  });
});
